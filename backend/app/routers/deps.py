"""Shared helpers for routes: the app container and the signed-in user."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Annotated, Any

from fastapi import Depends, HTTPException, Request

from app.auth import AuthError, User

if TYPE_CHECKING:
    from app.main import Container
    from app.services.generation import GenerationService
    from app.storage.repository import Repository

SIGN_IN_HEADERS = {"WWW-Authenticate": "Bearer"}


def get_container(request: Request) -> Any:
    return request.app.state.container


# FastAPI reads these annotations at runtime, so the container is typed as Any here.
ContainerDep = Annotated[Any, Depends(get_container)]


def current_user(request: Request, c: ContainerDep) -> User:
    """The signed-in user, from the "Authorization: Bearer <Supabase access token>" header."""
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(401, "Please sign in to continue.", headers=SIGN_IN_HEADERS)
    try:
        user = c.verifier.verify(token.strip())
    except AuthError as exc:
        raise HTTPException(401, str(exc), headers=SIGN_IN_HEADERS) from exc
    request.state.user_id = user.id
    return user


@dataclass
class Ctx:
    """Everything a route needs for one signed-in user."""

    user: User
    repo: Repository
    generation: GenerationService
    c: Container


def get_ctx(c: ContainerDep, user: Annotated[User, Depends(current_user)]) -> Ctx:
    return Ctx(user=user, repo=c.repo_for(user.id), generation=c.generation_for(user.id), c=c)


def not_found(message: str = "Not found") -> HTTPException:
    return HTTPException(status_code=404, detail=message)
