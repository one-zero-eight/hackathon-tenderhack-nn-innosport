import datetime as dtm
from collections import Counter
from typing import Any

from src.modules.dialog.schemas import AnalyticsBucket, AnalyticsDay, DialogAnalytics


def as_utc(value: dtm.datetime) -> dtm.datetime:
    return value.replace(tzinfo=dtm.UTC) if value.tzinfo is None else value.astimezone(dtm.UTC)


def insight_current(insight: Any, updated_at: dtm.datetime) -> bool:
    return (
        insight is not None
        and insight.dialog_updated_at is not None
        and as_utc(insight.dialog_updated_at) == as_utc(updated_at)
    )


class AnalyticsAccumulator:
    """Reduce projected closed dialogs without loading transcripts or imposing a list limit."""

    def __init__(self, days: int) -> None:
        self.days = days
        self.now = dtm.datetime.now(dtm.UTC)
        self.end = dtm.datetime.combine(self.now.date() + dtm.timedelta(days=1), dtm.time(), dtm.UTC)
        self.start = self.end - dtm.timedelta(days=days)
        self.daily = {
            (self.start + dtm.timedelta(days=offset)).date(): AnalyticsDay(
                date=(self.start + dtm.timedelta(days=offset)).date(), total=0, escalated=0
            )
            for offset in range(days)
        }
        self.counts: Counter[str] = Counter()
        self.topics: Counter[str] = Counter()
        self.subtopics: Counter[str] = Counter()
        self.outcomes: Counter[str] = Counter()
        self.ratings: Counter[str] = Counter()

    def add(self, row: dict) -> None:
        closed_at = row.get("closed_at")
        if closed_at is None or not self.start <= as_utc(closed_at) < self.end:
            return
        self.counts["total_closed"] += 1
        day = self.daily[as_utc(closed_at).date()]
        day.total += 1
        escalated = row.get("reason") == "specialist_requested" or (
            row.get("status") == "escalate" and row.get("reason") != "user_closed"
        )
        line = row.get("line")
        if escalated and line in {"L1", "L2", "L3"}:
            outcome = f"Передано в {line}"
            day.escalated += 1
        elif row.get("reason") == "user_closed":
            outcome = "Закрыто пользователем"
        elif row.get("reason") == "abuse" or row.get("status") == "closed_abuse":
            outcome = "Закрыто из-за нарушения"
        else:
            outcome = "Другое"
        self.outcomes[outcome] += 1
        summarized = bool(row.get("summary_current"))
        classified = bool(row.get("classification_current"))
        self.counts["summarized"] += summarized
        self.counts["analyzed"] += summarized and classified
        self.counts["with_remaining_questions"] += summarized and bool(row.get("remaining_questions"))
        if classified:
            topic = row.get("topic")
            subtopic = row.get("subtopic")
            self.counts["classified"] += topic is not None
            self.topics[topic or "Не определена"] += 1
            self.subtopics[f"{topic} — {subtopic}" if topic and subtopic else "Не определена"] += 1
        rating = row.get("rating")
        labels = {"complete": "Полностью помог", "partial": "Частично помог", "irrelevant": "Не помог"}
        if rating in labels:
            self.counts["rated"] += 1
            self.counts["complete_ratings"] += rating == "complete"
            self.ratings[labels[rating]] += 1

    @staticmethod
    def buckets(counts: Counter[str], limit: int | None = None) -> list[AnalyticsBucket]:
        return [
            AnalyticsBucket(label=label, count=count)
            for label, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]
        ]

    def result(self) -> DialogAnalytics:
        return DialogAnalytics(
            days=self.days,
            generated_at=self.now,
            total_closed=self.counts["total_closed"],
            analyzed=self.counts["analyzed"],
            pending=self.counts["total_closed"] - self.counts["analyzed"],
            classified=self.counts["classified"],
            with_remaining_questions=self.counts["with_remaining_questions"],
            summarized=self.counts["summarized"],
            rated=self.counts["rated"],
            complete_ratings=self.counts["complete_ratings"],
            daily=list(self.daily.values()),
            topics=self.buckets(self.topics, 10),
            subtopics=self.buckets(self.subtopics, 10),
            outcomes=self.buckets(self.outcomes),
            ratings=self.buckets(self.ratings),
        )
