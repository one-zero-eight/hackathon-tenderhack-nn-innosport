import asyncio
import datetime as dtm
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import format_datetime, make_msgid
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from markdown_it import MarkdownIt
from pydantic import ValidationError
from pymongo.errors import DuplicateKeyError, PyMongoError

from src.config_schema import AuditEmailSettings, Settings
from src.logging_ import logger
from src.modules.audit import (
    AuditDialog,
    AuditEmailResponse,
    AuditFeedback,
    AuditMessage,
    AuditRequest,
    AuditResponse,
    analyze_dialogs,
)
from src.storages.mongo.conversation import Conversation


def render_email_html(body: str) -> str:
    # Treat model output as untrusted Markdown: escape raw HTML and omit remote images.
    renderer = MarkdownIt("commonmark", {"html": False}).enable("table").disable("image")
    styles = {
        "heading_open": "color:#172554;line-height:1.3;margin:24px 0 12px",
        "paragraph_open": "margin:0 0 16px",
        "bullet_list_open": "margin:0 0 16px;padding-left:24px",
        "ordered_list_open": "margin:0 0 16px;padding-left:24px",
        "list_item_open": "margin-bottom:8px",
        "table_open": "border-collapse:collapse;width:100%;margin:16px 0",
        "th_open": "border:1px solid #cbd5e1;padding:10px;text-align:left;background:#f1f5f9",
        "td_open": "border:1px solid #cbd5e1;padding:10px;text-align:left;vertical-align:top",
        "blockquote_open": "border-left:3px solid #cbd5e1;margin:16px 0;padding-left:16px;color:#475569",
    }
    tokens = renderer.parse(body)
    for token in tokens:
        if style := styles.get(token.type):
            token.attrJoin("style", style)
    content = renderer.renderer.render(tokens, renderer.options, {})
    return (
        '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        "<title>Аудит поддержки</title></head>"
        '<body style="margin:0;padding:24px;background:#f1f5f9;color:#0f172a;'
        'font-family:Arial,sans-serif;font-size:16px;line-height:1.6">'
        '<div style="max-width:800px;margin:0 auto;padding:24px;background:#ffffff;'
        'border:1px solid #e2e8f0;border-radius:12px;overflow-wrap:anywhere">'
        f"{content}</div></body></html>"
    )


def deliver_email(config: AuditEmailSettings, subject: str, body: str) -> None:
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = str(config.sender)
    message["To"] = str(config.recipient)
    message["Date"] = format_datetime(dtm.datetime.now(dtm.UTC))
    message["Message-ID"] = make_msgid()
    html = render_email_html(body)
    message.set_content(body)
    message.add_alternative(html, subtype="html")
    message.add_attachment(html, subtype="html", filename="audit.html")
    context = ssl.create_default_context()
    client = (
        smtplib.SMTP_SSL(config.host, config.port, timeout=30, context=context)
        if config.security == "ssl"
        else smtplib.SMTP(config.host, config.port, timeout=30)
    )
    with client:
        if config.security == "starttls":
            client.starttls(context=context)
        client.login(config.username, config.password.get_secret_value())
        client.send_message(message)


class AuditEmailService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.lock = asyncio.Lock()

    async def send_now(self) -> AuditEmailResponse:
        if not self.settings.audit.email.configured:
            raise HTTPException(503, "Заполните SMTP-настройки и адрес получателя в audit.email в settings.yaml.")
        if self.lock.locked():
            raise HTTPException(409, "Почтовый отчёт уже формируется. Дождитесь окончания отправки.")
        async with self.lock:
            return await self._send(dtm.datetime.now(dtm.UTC))

    async def _analyze_period(self, start: dtm.datetime, end: dtm.datetime) -> list[AuditResponse]:
        reports: list[AuditResponse] = []
        batch: list[AuditDialog] = []
        size = 0
        # Query feedback timestamps directly, not the newest 500 dialogs from the UI.
        documents = Conversation.find({"feedback.submitted_at": {"$gte": start, "$lt": end}}).sort(
            "feedback.submitted_at", "_id"
        )
        async for document in documents:
            if document.feedback is None:
                continue
            try:
                dialog = AuditDialog(
                    id=str(document.id),
                    feedback=AuditFeedback(rating=document.feedback.rating, comment=document.feedback.comment),
                    messages=[
                        AuditMessage(role=message.role, content=message.content)
                        for message in document.messages
                        if message.role in {"user", "assistant"}
                    ],
                )
            except ValidationError as exc:
                raise HTTPException(
                    422, f"Обращение {document.id} не подходит для аудита. Отчёт не отправлен; переписка не обрезана."
                ) from exc
            dialog_size = sum(len(message.content) for message in dialog.messages) + len(dialog.feedback.comment)
            if dialog_size > 200_000:
                raise HTTPException(413, f"Обращение {document.id} превышает лимит аудита. Отчёт не отправлен.")
            if batch and (len(batch) == 100 or size + dialog_size > 200_000):
                reports.extend(await self._analyze_batch(batch))
                batch = []
                size = 0
            batch.append(dialog)
            size += dialog_size
        if batch:
            reports.extend(await self._analyze_batch(batch))
        return reports

    async def _analyze_batch(self, dialogs: list[AuditDialog]) -> list[AuditResponse]:
        try:
            return [await analyze_dialogs(AuditRequest(dialogs=dialogs), self.settings)]
        except HTTPException as exc:
            # Only split a confirmed context overflow, never truncate transcripts or hide model failures.
            if exc.status_code != 413 or len(dialogs) == 1:
                raise
            middle = len(dialogs) // 2
            return await self._analyze_batch(dialogs[:middle]) + await self._analyze_batch(dialogs[middle:])

    async def _send(self, end: dtm.datetime) -> AuditEmailResponse:
        start = end - dtm.timedelta(hours=24)
        reports = await self._analyze_period(start, end)
        count = sum(len(report.dialog_ids) for report in reports)
        timezone = ZoneInfo(self.settings.audit.email.timezone)
        local_start = start.astimezone(timezone).strftime("%d.%m.%Y %H:%M:%S %Z")
        local_end = end.astimezone(timezone).strftime("%d.%m.%Y %H:%M:%S %Z")
        parts = [
            "# Аудит поддержки за последние 24 часа",
            f"Период по дате сохранения оценки: {local_start} — {local_end} (конец не включён).",
            f"Оценённых обращений: {count}.",
        ]
        if not reports:
            parts.append("За этот период нет обращений с сохранёнными оценками. LLM-анализ не выполнялся.")
        else:
            parts.append(
                f"Полный ответ: {sum(report.ratings.complete for report in reports)} · "
                f"Частичный: {sum(report.ratings.partial for report in reports)} · "
                f"Нерелевантный: {sum(report.ratings.irrelevant for report in reports)}."
            )
            if len(reports) > 1:
                parts.append(
                    "Обращения проанализированы отдельными группами. Выводы каждой части относятся только к ней."
                )
            for index, report in enumerate(reports, start=1):
                parts.extend(
                    [
                        f"## Анализ — часть {index} из {len(reports)}",
                        report.analysis,
                        "ID обращений: " + ", ".join(report.dialog_ids),
                    ]
                )
            parts.append("Выводы LLM требуют проверки. Неоценённые обращения в анализ не входят.")
        try:
            await asyncio.to_thread(
                deliver_email,
                self.settings.audit.email,
                f"Аудит поддержки за 24 часа — {end.astimezone(timezone):%d.%m.%Y}",
                "\n\n".join(parts),
            )
        except (OSError, smtplib.SMTPException) as exc:
            logger.warning("Audit email SMTP failure: %s", type(exc).__name__)
            raise HTTPException(
                502, "Не удалось отправить письмо. Проверьте SMTP-настройки и доступность почтового сервера."
            ) from exc
        return AuditEmailResponse(
            period_start=start, period_end=end, dialog_count=count, sent_at=dtm.datetime.now(dtm.UTC)
        )

    async def run_daily(self) -> None:
        config = self.settings.audit.email
        timezone = ZoneInfo(config.timezone)
        jobs = Conversation.get_motor_collection().database.get_collection("audit_email_jobs")
        while True:
            now = dtm.datetime.now(timezone)
            scheduled = dtm.datetime.combine(now.date(), config.send_at, tzinfo=timezone)
            if now >= scheduled:
                # Unique MongoDB ID prevents duplicate daily mail from multiple workers or restarts.
                job_id = f"{config.timezone}:{scheduled.isoformat()}"
                try:
                    await jobs.insert_one({"_id": job_id, "status": "started", "started_at": dtm.datetime.now(dtm.UTC)})
                except DuplicateKeyError:
                    pass
                except PyMongoError:
                    logger.exception("Cannot claim daily audit email job")
                    await asyncio.sleep(60)
                    continue
                else:
                    try:
                        async with self.lock:
                            result = await self._send(dtm.datetime.now(dtm.UTC))
                    except (HTTPException, PyMongoError, ValidationError) as exc:
                        logger.error("Daily audit email failed: %s", type(exc).__name__)
                        status = {"status": "failed", "error_type": type(exc).__name__}
                    else:
                        status = {"status": "sent", "sent_at": result.sent_at, "dialog_count": result.dialog_count}
                        logger.info("Daily audit email accepted by SMTP; dialogs: %s", result.dialog_count)
                    try:
                        await jobs.update_one({"_id": job_id}, {"$set": status})
                    except PyMongoError:
                        logger.exception("Cannot save daily audit email status")
                    # Do not automatically retry an ambiguous SMTP delivery; manual sending remains available.
                scheduled = dtm.datetime.combine(now.date() + dtm.timedelta(days=1), config.send_at, tzinfo=timezone)
            delay = (scheduled.astimezone(dtm.UTC) - dtm.datetime.now(dtm.UTC)).total_seconds()
            await asyncio.sleep(max(delay, 1))
