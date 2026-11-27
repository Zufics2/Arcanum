"""Validators shared by apps. The server cannot check ciphertext, only its shape."""

import base64
import binascii

from rest_framework import serializers

# AES-GCM payload produced by the browser: 12-byte IV || ciphertext || 16-byte tag.
GCM_OVERHEAD_BYTES = 12 + 16


def b64decode_strict(value: str) -> bytes:
    """Decode standard base64, raising ValueError on malformed input."""
    try:
        return base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid base64") from exc


def validate_b64(value: str, *, exact: int | None = None, min_len: int = 0, max_len: int | None = None) -> str:
    """DRF-style validation of a base64 field by its decoded length."""
    try:
        raw = b64decode_strict(value)
    except ValueError:
        raise serializers.ValidationError("Must be valid base64.")
    if exact is not None and len(raw) != exact:
        raise serializers.ValidationError(f"Must decode to exactly {exact} bytes.")
    if len(raw) < min_len or (max_len is not None and len(raw) > max_len):
        raise serializers.ValidationError("Unexpected length.")
    return value
