from src.modules.dialog.llama import NullLlamaClient
from src.modules.dialog.models import Chunk, KnowledgeBase, Topic
from src.modules.dialog.schemas import DialogStatus, SupportLine
from tests.modules.dialog.conftest import make_service


async def _ask(service, text: str):
    dialog = await service.create()
    return await service.add_message(dialog.id, text)


async def test_faq_answered_with_citations() -> None:
    service = make_service()
    response = await _ask(service, "Как зарегистрироваться поставщику на портале?")
    assert response.status == DialogStatus.ANSWERED
    assert response.closed is False
    assert response.topic is not None
    assert response.topic.id == "t-001"
    assert response.line is None
    assert response.citations
    assert "регистрац" in response.reply.lower()
    assert all(item.path.startswith("docs/") for item in response.citations)


async def test_missing_knowledge_offers_specialist_without_invention() -> None:
    service = make_service()
    response = await _ask(service, "Нужна консультацияуотест уоуникальнаятема")
    assert response.status == DialogStatus.ESCALATE
    assert response.line is None
    assert response.closed is False
    assert response.citations == []
    assert "нет достаточной информации" in response.reply.lower()
    assert "борщ" not in response.reply.lower()

    escalated = await service.request_specialist(response.id)
    assert escalated.status == DialogStatus.ESCALATE
    assert escalated.line == SupportLine.L1
    assert escalated.closed is True


async def test_mat_closes_abuse() -> None:
    service = make_service()
    response = await _ask(service, "пошёл нахуй с вашей регистрацией")
    assert response.status == DialogStatus.CLOSED_ABUSE
    assert response.closed is True
    assert response.reason == "abuse"
    assert "завершено" in response.reply.lower()


async def test_rudeness_without_mat_is_not_closed_abuse() -> None:
    service = make_service()
    response = await _ask(service, "вы идиоты, как зарегистрироваться на портале?")
    assert response.status != DialogStatus.CLOSED_ABUSE
    assert response.closed is False
    assert response.status in {DialogStatus.ANSWERED, DialogStatus.CLARIFYING, DialogStatus.ESCALATE}


async def test_incident_gets_l2_only_after_specialist_selection() -> None:
    service = make_service()
    response = await _ask(service, "Уже не помогло, закупка 1234567890 не открывается")
    assert response.line is None
    assert response.closed is False
    assert response.citations == []

    escalated = await service.request_specialist(response.id)
    assert escalated.status == DialogStatus.ESCALATE
    assert escalated.line == SupportLine.L2
    assert escalated.closed is True
    assert escalated.citations == []
    assert "l2" in escalated.reply.lower()


async def test_clarifications_use_catalog_then_escalate() -> None:
    service = make_service()
    dialog = await service.create()
    first = await service.add_message(dialog.id, "помогите")
    assert first.status == DialogStatus.CLARIFYING
    catalog_ids = {topic.id for topic in service.knowledge.topics}
    assert first.clarification_options
    assert {option.id for option in first.clarification_options} <= catalog_ids
    assert first.reply == "Уточните, пожалуйста, тему обращения. Выберите один из вариантов."
    assert "1." not in first.reply
    second = await service.add_message(dialog.id, "ну не знаю")
    third = await service.add_message(dialog.id, "что угодно")
    assert second.status == DialogStatus.CLARIFYING
    assert third.status == DialogStatus.CLARIFYING
    fourth = await service.add_message(dialog.id, "всё ещё непонятно")
    assert fourth.status == DialogStatus.ESCALATE
    assert fourth.line is None
    assert fourth.closed is False
    escalated = await service.request_specialist(dialog.id)
    assert escalated.line == SupportLine.L1
    assert escalated.closed is True


async def test_clarification_option_index_locks_topic() -> None:
    service = make_service()
    dialog = await service.create()
    first = await service.add_message(dialog.id, "помогите")
    assert first.clarification_options
    chosen = first.clarification_options[0]
    response = await service.add_message(dialog.id, "1")
    assert response.topic is not None
    assert response.topic.id == chosen.id
    assert response.status == DialogStatus.CLARIFYING
    assert response.clarification_options == []
    assert "что именно" in response.reply.lower()


async def test_null_llama_does_not_invent_topic() -> None:
    service = make_service(llama_client=NullLlamaClient())
    response = await _ask(service, "абстрактный запрос без ключей")
    assert response.status == DialogStatus.CLARIFYING
    assert response.topic is None


async def test_capability_question_offers_topics_without_knowledge_lookup() -> None:
    service = make_service(chunks=[])
    response = await _ask(service, "Чем ты можешь мне помочь?")

    assert response.status == DialogStatus.CLARIFYING
    assert response.reason is None
    assert response.topic is None
    assert response.clarification_options
    assert "портале поставщиков" in response.reply.lower()
    assert "нет достаточной информации" not in response.reply.lower()


async def test_greeting_answers_naturally_and_offers_topics() -> None:
    service = make_service(chunks=[])
    response = await _ask(service, "Hi")

    assert response.status == DialogStatus.CLARIFYING
    assert response.reply.startswith("Здравствуйте!")
    assert "помогаю" in response.reply.lower()
    assert response.clarification_options


async def test_mchd_question_selects_supplier_topic_and_answers() -> None:
    supplier = Topic(
        id="t-002",
        title="Полномочия",
        parent_title="Личный кабинет пользователя",
        description="Полномочия поставщика.",
        keys=["мчд", "машиночитаемая доверенность"],
    )
    customer = Topic(
        id="t-065",
        title="Полномочия УО",
        parent_title="Уполномоченный орган (Региональный заказчик)",
        description="Полномочия заказчика.",
        keys=["мчд", "машиночитаемая доверенность"],
    )
    chunk = Chunk(
        id="mchd-1",
        topic_id=supplier.id,
        text="МЧД — машиночитаемую доверенность — загружают в профиль пользователя в формате XML.",
        document="Инструкция_по_работе_с_машиночитаемыми_доверенностями.pdf",
        section="1.1 Операции с МЧД",
        path="docs/Инструкция_по_работе_с_машиночитаемыми_доверенностями.pdf",
    )
    service = make_service(
        knowledge=KnowledgeBase(topics=[supplier, customer]),
        chunks=[chunk],
        llama_client=NullLlamaClient(),
    )

    response = await _ask(service, "Расскажи всё, что знаешь про МЧД")

    assert response.status == DialogStatus.ANSWERED
    assert response.topic is not None
    assert response.topic.id == supplier.id
    assert "доверенность" in response.reply.lower()


async def test_capability_question_does_not_consume_clarification_attempt() -> None:
    service = make_service()
    dialog = await service.create()

    for _ in range(4):
        response = await service.add_message(dialog.id, "Что ты умеешь?")
        assert response.status == DialogStatus.CLARIFYING
        assert response.reason is None

    selected = await service.add_message(dialog.id, "1")
    assert selected.topic is not None
