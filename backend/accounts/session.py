"""The refresh token in an httpOnly cookie: lets a reloaded page know who is logged in.

The cookie only proves the session. It never unlocks data: to get the encrypted masterKey
the browser must log in again with the password-derived auth_hash.
"""

from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.tokens import RefreshToken

User = get_user_model()


def set_refresh_cookie(response: Response, refresh: str) -> None:
    response.set_cookie(
        settings.REFRESH_COOKIE_NAME,
        refresh,
        max_age=int(api_settings.REFRESH_TOKEN_LIFETIME.total_seconds()),
        path=settings.REFRESH_COOKIE_PATH,
        secure=settings.REFRESH_COOKIE_SECURE,
        httponly=True,
        samesite="Lax",
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(settings.REFRESH_COOKIE_NAME, path=settings.REFRESH_COOKIE_PATH, samesite="Lax")


def user_from_refresh(raw: str | None):
    """The active user a refresh token belongs to, or None if the token is missing/invalid."""
    if not raw:
        return None
    try:
        token = RefreshToken(raw)
    except TokenError:
        return None
    return User.objects.filter(
        pk=token.get(api_settings.USER_ID_CLAIM), is_active=True
    ).select_related("profile").first()
