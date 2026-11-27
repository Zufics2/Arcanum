import base64
import os

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from accounts.models import Profile

User = get_user_model()

pytestmark = pytest.mark.django_db


def b64(n: int) -> str:
    return base64.b64encode(os.urandom(n)).decode()


def make_payload(username: str = "alice", **overrides) -> dict:
    payload = {
        "username": username,
        "auth_hash": b64(32),
        "salt": b64(16),
        "encrypted_master_key": b64(60),
    }
    payload.update(overrides)
    return payload


@pytest.fixture
def client() -> APIClient:
    return APIClient()


@pytest.fixture
def registered(client):
    payload = make_payload()
    response = client.post(reverse("auth-register"), payload, format="json")
    assert response.status_code == 201
    return payload

# Register


def test_register_creates_user_and_profile(client):
    payload = make_payload()

    response = client.post(reverse("auth-register"), payload, format="json")

    assert response.status_code == 201
    assert response.json() == {"username": "alice"}
    user = User.objects.get(username="alice")
    assert user.profile.salt == payload["salt"]
    assert user.profile.encrypted_master_key == payload["encrypted_master_key"]
    assert user.email == ""


def test_register_stores_auth_hash_hashed_not_plain(client):
    payload = make_payload()

    client.post(reverse("auth-register"), payload, format="json")

    user = User.objects.get(username="alice")
    assert payload["auth_hash"] not in user.password
    assert user.check_password(payload["auth_hash"])


def test_register_rejects_duplicate_username_case_insensitive(client, registered):
    response = client.post(reverse("auth-register"), make_payload("ALICE"), format="json")

    assert response.status_code == 400
    assert "username" in response.json()


@pytest.mark.parametrize(
    "field, value",
    [
        ("salt", b64(8)),  # wrong length
        ("auth_hash", b64(16)),  # wrong length
        ("auth_hash", "not base64!!"),
        ("encrypted_master_key", b64(10)),  # too short to be iv + key + tag
        ("username", "bad name with spaces"),
    ],
)
def test_register_validates_fields(client, field, value):
    response = client.post(reverse("auth-register"), make_payload(**{field: value}), format="json")

    assert response.status_code == 400
    assert field in response.json()
    assert not User.objects.exists()


def test_register_ignores_email(client):
    response = client.post(
        reverse("auth-register"), make_payload(email="a@example.com"), format="json"
    )

    assert response.status_code == 201
    assert User.objects.get().email == ""


# Salt


def test_salt_returns_stored_salt(client, registered):
    response = client.post(reverse("auth-salt"), {"username": "alice"}, format="json")

    assert response.status_code == 200
    assert response.json() == {"salt": registered["salt"]}


def test_salt_for_unknown_user_is_fake_but_deterministic(client):
    first = client.post(reverse("auth-salt"), {"username": "ghost"}, format="json")
    second = client.post(reverse("auth-salt"), {"username": "ghost"}, format="json")
    other = client.post(reverse("auth-salt"), {"username": "ghost2"}, format="json")

    assert first.status_code == 200
    assert first.json() == second.json()
    assert first.json() != other.json()
    assert len(base64.b64decode(first.json()["salt"])) == 16


# Login


def test_login_returns_tokens_and_encrypted_master_key(client, registered):
    response = client.post(
        reverse("auth-login"),
        {"username": "alice", "auth_hash": registered["auth_hash"]},
        format="json",
    )

    assert response.status_code == 200
    body = response.json()
    assert body["encrypted_master_key"] == registered["encrypted_master_key"]
    assert body["access"] and body["refresh"]


@pytest.mark.parametrize("username", ["alice", "ghost"])
def test_login_fails_with_same_error_for_wrong_hash_and_unknown_user(client, registered, username):
    response = client.post(
        reverse("auth-login"),
        {"username": username, "auth_hash": b64(32)},
        format="json",
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid username or password."}


# Refresh


def test_refresh_returns_new_access_token(client, registered):
    login = client.post(
        reverse("auth-login"),
        {"username": "alice", "auth_hash": registered["auth_hash"]},
        format="json",
    ).json()

    response = client.post(reverse("auth-refresh"), {"refresh": login["refresh"]}, format="json")

    assert response.status_code == 200
    assert "access" in response.json()


def test_profile_is_deleted_with_user(registered):
    User.objects.get(username="alice").delete()

    assert not Profile.objects.exists()
