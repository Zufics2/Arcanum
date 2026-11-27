import base64
import os

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

User = get_user_model()

pytestmark = pytest.mark.django_db


def b64(n: int) -> str:
    return base64.b64encode(os.urandom(n)).decode()


@pytest.fixture
def authed():
    client = APIClient()
    creds = {"username": "alice", "auth_hash": b64(32), "salt": b64(16), "encrypted_master_key": b64(60)}
    client.post(reverse("auth-register"), creds, format="json")
    access = client.post(
        reverse("auth-login"), {"username": "alice", "auth_hash": creds["auth_hash"]}, format="json"
    ).json()["access"]
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    return client, creds


@pytest.fixture
def with_recovery(authed):
    client, creds = authed
    recovery = {"recovery_auth_hash": b64(32), "recovery_encrypted_master_key": b64(60)}
    response = client.post(reverse("auth-recovery"), {"auth_hash": creds["auth_hash"], **recovery}, format="json")
    assert response.status_code == 204
    return client, creds, recovery


def new_password() -> dict:
    return {"new_auth_hash": b64(32), "new_salt": b64(16), "new_encrypted_master_key": b64(60)}


# --- setup / disable ---


def test_setup_stores_hashed_auth_and_encrypted_key(with_recovery):
    client, _, recovery = with_recovery

    profile = User.objects.get(username="alice").profile
    assert profile.recovery_auth_hash.startswith("pbkdf2_sha256$")
    assert recovery["recovery_auth_hash"] not in profile.recovery_auth_hash
    assert profile.recovery_encrypted_master_key == recovery["recovery_encrypted_master_key"]
    assert client.get(reverse("me")).json()["has_recovery_key"] is True


def test_me_reports_no_recovery_key_by_default(authed):
    client, _ = authed

    assert client.get(reverse("me")).json()["has_recovery_key"] is False


def test_setup_requires_current_password(authed):
    client, _ = authed

    response = client.post(
        reverse("auth-recovery"),
        {"auth_hash": b64(32), "recovery_auth_hash": b64(32), "recovery_encrypted_master_key": b64(60)},
        format="json",
    )

    assert response.status_code == 400
    assert "auth_hash" in response.json()
    assert not User.objects.get(username="alice").profile.has_recovery_key


def test_setup_requires_authentication():
    assert APIClient().post(reverse("auth-recovery"), {}, format="json").status_code == 401


def test_regenerating_invalidates_old_key(with_recovery):
    client, creds, old = with_recovery
    client.post(
        reverse("auth-recovery"),
        {"auth_hash": creds["auth_hash"], "recovery_auth_hash": b64(32), "recovery_encrypted_master_key": b64(60)},
        format="json",
    )

    response = APIClient().post(
        reverse("auth-recovery-verify"),
        {"username": "alice", "recovery_auth_hash": old["recovery_auth_hash"]},
        format="json",
    )

    assert response.status_code == 401


def test_disable_requires_password_and_removes_key(with_recovery):
    client, creds, _ = with_recovery

    assert client.delete(reverse("auth-recovery"), {"auth_hash": b64(32)}, format="json").status_code == 400
    assert client.delete(reverse("auth-recovery"), {"auth_hash": creds["auth_hash"]}, format="json").status_code == 204
    assert client.get(reverse("me")).json()["has_recovery_key"] is False


# --- recovery flow ---


def test_verify_returns_master_key_encrypted_with_recovery_key(with_recovery):
    _, _, recovery = with_recovery

    response = APIClient().post(
        reverse("auth-recovery-verify"),
        {"username": "alice", "recovery_auth_hash": recovery["recovery_auth_hash"]},
        format="json",
    )

    assert response.status_code == 200
    assert response.json() == {"recovery_encrypted_master_key": recovery["recovery_encrypted_master_key"]}


@pytest.mark.parametrize("username", ["alice", "ghost"])
def test_verify_same_error_for_wrong_key_and_unknown_user(with_recovery, username):
    response = APIClient().post(
        reverse("auth-recovery-verify"), {"username": username, "recovery_auth_hash": b64(32)}, format="json"
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid username or recovery key."}


def test_verify_fails_for_user_without_recovery_key(authed):
    response = APIClient().post(
        reverse("auth-recovery-verify"), {"username": "alice", "recovery_auth_hash": b64(32)}, format="json"
    )

    assert response.status_code == 401


def test_reset_sets_new_password(with_recovery):
    _, creds, recovery = with_recovery
    new = new_password()

    response = APIClient().post(
        reverse("auth-recovery-reset"),
        {"username": "alice", "recovery_auth_hash": recovery["recovery_auth_hash"], **new},
        format="json",
    )

    assert response.status_code == 204
    profile = User.objects.get(username="alice").profile
    assert profile.salt == new["new_salt"]
    assert profile.encrypted_master_key == new["new_encrypted_master_key"]
    login = lambda h: APIClient().post(reverse("auth-login"), {"username": "alice", "auth_hash": h}, format="json")
    assert login(creds["auth_hash"]).status_code == 401
    assert login(new["new_auth_hash"]).status_code == 200
    # masterKey did not change, so the recovery key keeps working
    assert profile.has_recovery_key


def test_reset_with_wrong_key_changes_nothing(with_recovery):
    _, creds, _ = with_recovery

    response = APIClient().post(
        reverse("auth-recovery-reset"),
        {"username": "alice", "recovery_auth_hash": b64(32), **new_password()},
        format="json",
    )

    assert response.status_code == 401
    assert User.objects.get(username="alice").check_password(creds["auth_hash"])


def test_reset_validates_new_password_fields(with_recovery):
    _, _, recovery = with_recovery

    response = APIClient().post(
        reverse("auth-recovery-reset"),
        {"username": "alice", "recovery_auth_hash": recovery["recovery_auth_hash"], **new_password(), "new_salt": "x"},
        format="json",
    )

    assert response.status_code == 400
    assert "new_salt" in response.json()


def test_password_change_keeps_recovery_key_working(with_recovery):
    client, creds, recovery = with_recovery
    client.post(reverse("auth-change-password"), {"old_auth_hash": creds["auth_hash"], **new_password()}, format="json")

    response = APIClient().post(
        reverse("auth-recovery-verify"),
        {"username": "alice", "recovery_auth_hash": recovery["recovery_auth_hash"]},
        format="json",
    )

    assert response.status_code == 200
