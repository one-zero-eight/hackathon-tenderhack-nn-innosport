from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.modules.dialog.models import Chunk, KnowledgeBase, Topic
from src.modules.dialog.retrieval import MemoryKnowledgeRetriever
from src.modules.dialog.routes import router
from src.modules.dialog.service import DialogService
from src.modules.dialog.store import MemoryConversationStore

REGISTRATION_TEXT = (
    "Для регистрации поставщика перейдите на главную страницу Портала поставщиков "
    "и нажмите кнопку «Регистрация». Заполните сведения об организации и подпишите "
    "заявку электронной подписью. После проверки заявки пользователь получает доступ "
    "к личному кабинету."
)

YML_TEXT = (
    "Прайс-лист загружается в формате YML. Поставщик экспортирует номенклатуру в YML "
    "и отправляет файл через форму импорта в личном кабинете. В файле указываются shop, "
    "categories и offers."
)

SAMPLE_CHUNKS = [
    Chunk(
        id="t-001-c1",
        topic_id="t-001",
        text=REGISTRATION_TEXT,
        document="Инструкция_по_работе_с_Порталом_для_поставщика.pdf",
        section="3.3 Регистрация поставщика",
        path="docs/Инструкция_по_работе_с_Порталом_для_поставщика.pdf",
    ),
    Chunk(
        id="t-053-c1",
        topic_id="t-053",
        text=YML_TEXT,
        document="Инструкция по формированию YML.pdf",
        section="1 Массовый импорт прайс-листа",
        path="docs/Инструкция по формированию YML.pdf",
    ),
]


def sample_knowledge() -> KnowledgeBase:
    return KnowledgeBase(
        topics=[
            Topic(
                id="t-001",
                title="Регистрация",
                parent_title="Личный кабинет пользователя",
                description="Регистрация поставщика на портале.",
                keys=["регистрация", "зарегистрироваться", "заявка"],
                document="Инструкция_по_работе_с_Порталом_для_поставщика.pdf",
                section="3.3 Регистрация поставщика",
                path="docs/Инструкция_по_работе_с_Порталом_для_поставщика.pdf",
            ),
            Topic(
                id="t-008",
                title="Сертификат ЭП",
                parent_title="Личный кабинет пользователя",
                description="Подключение электронной подписи.",
                keys=["эп", "эцп", "сертификат", "электронная подпись"],
                document="Инструкция_по_работе_с_Порталом_для_поставщика.pdf",
                section="3.2 Подключение электронной подписи",
                path="docs/Инструкция_по_работе_с_Порталом_для_поставщика.pdf",
            ),
            Topic(
                id="t-053",
                title="Массовая загрузка YML",
                parent_title="Работа с СТЕ",
                description="Импорт прайс-листа YML.",
                keys=["yml", "прайс-лист", "импорт"],
                document="Инструкция по формированию YML.pdf",
                section="1 Массовый импорт прайс-листа",
                path="docs/Инструкция по формированию YML.pdf",
            ),
            Topic(
                id="t-069",
                title="Консультация УО",
                parent_title="Уполномоченный орган (Региональный заказчик)",
                description="Тема без чанков в тестовой базе.",
                keys=["консультацияуотест", "уоуникальнаятема"],
                document="",
                section="",
                path="",
            ),
        ],
    )


def make_service(
    knowledge: KnowledgeBase | None = None,
    *,
    chunks: list[Chunk] | None = None,
    llama_client=None,
) -> DialogService:
    return DialogService(
        knowledge=knowledge or sample_knowledge(),
        store=MemoryConversationStore(),
        retriever=MemoryKnowledgeRetriever(SAMPLE_CHUNKS if chunks is None else chunks),
        llama_client=llama_client,
    )


def make_client(service: DialogService | None = None) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.state.dialog_service = service or make_service()
    return TestClient(app)
