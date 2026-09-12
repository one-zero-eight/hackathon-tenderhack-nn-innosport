__all__ = ["lifespan"]

import asyncio
from contextlib import asynccontextmanager

from beanie import init_beanie
from fastapi import FastAPI
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import timeout
from pymongo.errors import ConnectionFailure

from src.config import settings
from src.logging_ import logger
from src.modules.dialog.factory import build_dialog_service, build_llama_client_from_settings
from src.storages.mongo import document_models


async def setup_database() -> AsyncIOMotorClient:
    motor_client: AsyncIOMotorClient = AsyncIOMotorClient(
        settings.database_uri.get_secret_value(),
        connectTimeoutMS=5000,
        serverSelectionTimeoutMS=5000,
        tz_aware=True,
    )
    motor_client.get_io_loop = asyncio.get_running_loop  # type: ignore[method-assign]

    # healthcheck mongo
    try:
        with timeout(1):
            server_info = await motor_client.server_info()
            vesion = server_info["version"]
            logger.info(f"Connected to MongoDB v{vesion}")
    except ConnectionFailure as e:
        logger.critical(f"Could not connect to MongoDB: {e}")

    mongo_db = motor_client.get_database()
    await init_beanie(database=mongo_db, document_models=document_models, recreate_views=True)
    return motor_client


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Application startup
    motor_client = await setup_database()
    _app.state.dialog_service = build_dialog_service(
        use_mongo=True,
        llama_client=build_llama_client_from_settings(),
    )
    yield

    # -- Application shutdown --
    motor_client.close()
