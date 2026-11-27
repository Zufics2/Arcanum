import base64
import os
from pathlib import Path

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from rest_framework.test import APIClient

from accounts.avatars import DEFAULT_AVATARS

User = get_user_model()

pytestmark = pytest.mark.django_db

COOKIE = "arcanum_session"


def b64(n: int) -> str:
    return base64.b64encode(os.urandom(n)).decode()


@pytest.fixture(autouse=True)
def media_root(settings, tmp_path) -> Path:
    settings.MEDIA_ROOT = tmp_path
    return tmp_path


@pytest.fixture
def account():
    """A registered user: returns (client, credentials)."""
    client = APIClient()
    creds = {"username": "alice", "auth_hash": b64(32), "salt": b64(16), "encrypted_master_key": b64(60)}
    assert client.post(reverse("auth-register"), creds, format="json").status_code == 201
    return client, creds


def login(client: APIClient, creds: dict):
    return client.post(
        reverse("auth-login"), {"username": creds["username"], "auth_hash": creds["auth_hash"]}, format="json"
    )


@pytest.fixture
def authed(account):
    client, creds = account
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login(client, creds).json()['access']}")
    return client, creds


# --- default avatar ---


def test_registration_assigns_a_builtin_avatar(account):
    assert User.objects.get(username="alice").profile.default_avatar in DEFAULT_AVATARS


def test_login_returns_avatar_and_updates_last_login(account):
    client, creds = account

    body = login(client, creds).json()

    assert body["default_avatar"] in DEFAULT_AVATARS
    assert User.objects.get(username="alice").last_login is not None


# --- session cookie ---


def test_login_sets_httponly_session_cookie(account):
    client, creds = account

    cookie = login(client, creds).cookies[COOKIE]

    assert cookie["httponly"]
    assert cookie["path"] == "/api/auth/"
    assert cookie["samesite"] == "Lax"


def test_session_returns_user_from_cookie(account):
    client, creds = account
    login(client, creds)  # the test client keeps cookies like a browser

    response = client.get(reverse("auth-session"))

    assert response.status_code == 200
    assert response.json()["username"] == "alice"
    assert "encrypted_master_key" not in response.json()  # the cookie alone never unlocks data


def test_session_without_cookie_is_401():
    assert APIClient().get(reverse("auth-session")).status_code == 401


def test_session_with_garbage_cookie_is_401_and_cleared():
    client = APIClient()
    client.cookies[COOKIE] = "garbage"

    response = client.get(reverse("auth-session"))

    assert response.status_code == 401
    assert response.cookies[COOKIE].value == ""


def test_logout_clears_cookie(account):
    client, creds = account
    login(client, creds)

    response = client.post(reverse("auth-logout"))

    assert response.status_code == 204
    assert client.get(reverse("auth-session")).status_code == 401


def test_session_activate_switches_cookie_to_another_account(account):
    client, creds = account
    login(client, creds)
    bob = {"username": "bob", "auth_hash": b64(32), "salt": b64(16), "encrypted_master_key": b64(60)}
    other = APIClient()
    other.post(reverse("auth-register"), bob, format="json")
    bob_refresh = login(other, bob).json()["refresh"]

    response = client.post(reverse("auth-session"), {"refresh": bob_refresh}, format="json")

    assert response.status_code == 204
    assert client.get(reverse("auth-session")).json()["username"] == "bob"


def test_session_activate_rejects_invalid_token():
    response = APIClient().post(reverse("auth-session"), {"refresh": "nope"}, format="json")

    assert response.status_code == 401


# --- change password ---


def test_change_password(authed):
    client, creds = authed
    new = {"new_auth_hash": b64(32), "new_salt": b64(16), "new_encrypted_master_key": b64(60)}

    response = client.post(
        reverse("auth-change-password"), {"old_auth_hash": creds["auth_hash"], **new}, format="json"
    )

    assert response.status_code == 204
    profile = User.objects.get(username="alice").profile
    assert profile.salt == new["new_salt"]
    assert profile.encrypted_master_key == new["new_encrypted_master_key"]
    assert login(APIClient(), creds).status_code == 401
    assert login(APIClient(), {"username": "alice", "auth_hash": new["new_auth_hash"]}).status_code == 200


def test_change_password_requires_correct_old_password(authed):
    client, _ = authed

    response = client.post(
        reverse("auth-change-password"),
        {"old_auth_hash": b64(32), "new_auth_hash": b64(32), "new_salt": b64(16), "new_encrypted_master_key": b64(60)},
        format="json",
    )

    assert response.status_code == 400
    assert "old_auth_hash" in response.json()


def test_change_password_requires_auth():
    assert APIClient().post(reverse("auth-change-password"), {}, format="json").status_code == 401


# --- /me ---


def test_me_returns_profile_and_storage(authed, settings):
    client, _ = authed

    body = client.get(reverse("me")).json()

    assert body["username"] == "alice"
    assert body["default_avatar"] in DEFAULT_AVATARS
    assert body["has_custom_avatar"] is False
    assert body["storage_used"] == 0
    assert body["storage_quota"] == settings.STORAGE_QUOTA_BYTES


def test_me_counts_uploaded_files(authed):
    client, _ = authed
    client.post(
        reverse("file-list"),
        {"blob": SimpleUploadedFile("blob", os.urandom(500)), "encrypted_name": b64(40), "encrypted_file_key": b64(60)},
        format="multipart",
    )

    assert client.get(reverse("me")).json()["storage_used"] == 500


def test_change_default_avatar(authed):
    client, _ = authed

    response = client.patch(reverse("me"), {"default_avatar": "lock-green"}, format="json")

    assert response.status_code == 200
    assert response.json()["default_avatar"] == "lock-green"


def test_unknown_default_avatar_is_rejected(authed):
    client, _ = authed

    response = client.patch(reverse("me"), {"default_avatar": "../../etc/passwd"}, format="json")

    assert response.status_code == 400


# --- custom avatar ---


def put_avatar(client, content: bytes):
    return client.put(reverse("me-avatar"), {"blob": SimpleUploadedFile("photo.jpg", content)}, format="multipart")


def test_custom_avatar_upload_download_and_delete(authed, media_root, django_capture_on_commit_callbacks):
    client, _ = authed
    content = os.urandom(2000)

    assert put_avatar(client, content).status_code == 204
    profile = User.objects.get(username="alice").profile
    assert "photo" not in profile.encrypted_avatar.name
    assert client.get(reverse("me")).json()["has_custom_avatar"] is True
    download = client.get(reverse("me-avatar"))
    assert b"".join(download.streaming_content) == content

    path = media_root / profile.encrypted_avatar.name
    with django_capture_on_commit_callbacks(execute=True):
        assert client.delete(reverse("me-avatar")).status_code == 204
    assert not path.exists()
    assert client.get(reverse("me-avatar")).status_code == 404


def test_replacing_avatar_deletes_old_blob(authed, media_root, django_capture_on_commit_callbacks):
    client, _ = authed
    put_avatar(client, os.urandom(100))
    old = media_root / User.objects.get(username="alice").profile.encrypted_avatar.name

    with django_capture_on_commit_callbacks(execute=True):
        put_avatar(client, os.urandom(100))

    assert not old.exists()
    assert len(list((media_root / "avatars").iterdir())) == 1


def test_choosing_builtin_avatar_removes_custom_one(authed, django_capture_on_commit_callbacks):
    client, _ = authed
    put_avatar(client, os.urandom(100))

    with django_capture_on_commit_callbacks(execute=True):
        client.patch(reverse("me"), {"default_avatar": "lock-red"}, format="json")

    assert client.get(reverse("me")).json()["has_custom_avatar"] is False


def test_avatar_size_limits(authed):
    client, _ = authed

    assert put_avatar(client, b"tiny").status_code == 400
    assert put_avatar(client, os.urandom(1024 * 1024 + 1)).status_code == 400


def test_avatar_deleted_with_account(authed, media_root, django_capture_on_commit_callbacks):
    client, _ = authed
    put_avatar(client, os.urandom(100))
    path = media_root / User.objects.get(username="alice").profile.encrypted_avatar.name

    with django_capture_on_commit_callbacks(execute=True):
        User.objects.get(username="alice").delete()

    assert not path.exists()


# --- quota ---


def test_upload_rejected_when_quota_exceeded(authed, settings):
    client, _ = authed
    settings.STORAGE_QUOTA_BYTES = 1000

    def upload(size):
        return client.post(
            reverse("file-list"),
            {"blob": SimpleUploadedFile("blob", os.urandom(size)), "encrypted_name": b64(40), "encrypted_file_key": b64(60)},
            format="multipart",
        )

    assert upload(600).status_code == 201
    response = upload(600)
    assert response.status_code == 400
    assert response.json()["blob"] == ["Storage quota exceeded."]
