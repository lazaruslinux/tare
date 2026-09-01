"""Who may call what. Two dependencies, so a route says its requirement in its
signature rather than checking a flag in its body."""

from __future__ import annotations

from fastapi import Depends, HTTPException, status

from app import models, security


def require_user(user: models.User = Depends(security.current_user)) -> models.User:
    return user


def require_admin(user: models.User = Depends(require_user)) -> models.User:
    # 403 rather than 401: whoever is asking is signed in and known, they are
    # simply not allowed, and answering 401 would send the client off to sign
    # in again for a session that is already valid.
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This needs an administrator account.")
    return user
