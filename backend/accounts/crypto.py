"""Server-side helpers. The server never encrypts or decrypts user data."""

import base64
import binascii
import hashlib
import hmac

from django.conf import settings

SALT_BYTES = 16


def b64decode_strict(value: str) -> bytes:
    """Decode standard base64, raising ValueError on malformed input."""
    try:
        return base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid base64") from exc


def fake_salt(username: str) -> str:
    """Deterministic fake salt for unknown usernames.

    Returning a stable, plausible salt instead of 404 means the salt endpoint
    does not reveal which usernames are registered.
    """
    digest = hmac.new(
        settings.SECRET_KEY.encode(),
        username.encode(),
        hashlib.sha256,
    ).digest()
    return base64.b64encode(digest[:SALT_BYTES]).decode()
