__all__ = ["User", "UserRole", "UserSchema"]

from enum import StrEnum

from pymongo import IndexModel

from src.pydantic_base import BaseSchema
from src.storages.mongo.__base__ import CustomDocument


class UserRole(StrEnum):
    DEFAULT = "default"
    ADMIN = "admin"


class UserSchema(BaseSchema):
    role: UserRole = UserRole.DEFAULT


class User(UserSchema, CustomDocument):
    class Settings:
        indexes = [
        ]
