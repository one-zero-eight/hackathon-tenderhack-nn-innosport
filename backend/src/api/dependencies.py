__all__ = ["USER_AUTH", "get_current_user_auth"]

from typing import Annotated

from fastapi import Depends


def get_current_user_auth():
    raise NotImplementedError


USER_AUTH = Annotated[None, Depends(get_current_user_auth)]
