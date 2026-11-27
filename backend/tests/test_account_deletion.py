import base64
import os
from pathlib import Path

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from rest_framework.test import APIClient

from accounts.models import Profile
from sharing.models import ShareLink
from storage.models import File, Folder

User = get_user_model()

pytestmark = pytest.mark.django_db


def b64(n: int) -> str:
    return base64.b64encode(os.urandom(n)).decode()


@pytest.fixture(autouse=True)
def media_root(settings, tmp_path) -> Path:
    settings.MEDIA_ROOT = tmp_path
    return tmp_path


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


def fill_account(client: APIClient) -> None:
    folder = client.post(reverse("folder-list"), {"encrypted_name": b64(40)}, format="json").json()
    for parent in (None, folder["id"]):
        data = {"blob": SimpleUploadedFile("blob", os.urandom(200)), "encrypted_name": b64(40), "encrypted_file_key": b64(60)}
        if parent:
            data["folder"] = parent
        file_id = client.post(reverse("file-list"), data, format="multipart").json()["id"]
        client.post(reverse("share-list"), {"file": file_id}, format="json")
    client.put(reverse("me-avatar"), {"blob": SimpleUploadedFile("a", os.urandom(100))}, format="multipart")


def test_delete_account_removes_everything(authed, media_root, django_capture_on_commit_callbacks):
    client, creds = authed
    fill_account(client)
    assert len(list((media_root / "blobs").iterdir())) == 2
    assert len(list((media_root / "avatars").iterdir())) == 1

    with django_capture_on_commit_callbacks(execute=True):
        response = client.delete(reverse("auth-account"), {"auth_hash": creds["auth_hash"]}, format="json")

    assert response.status_code == 204
    assert response.cookies["arcanum_session"].value == ""
    assert not User.objects.exists()
    for model in (Profile, Folder, File, ShareLink):
        assert not model.objects.exists(), model.__name__
    assert list((media_root / "blobs").iterdir()) == []
    assert list((media_root / "avatars").iterdir()) == []
    login = APIClient().post(reverse("auth-login"), {"username": "alice", "auth_hash": creds["auth_hash"]}, format="json")
    assert login.status_code == 401


def test_delete_account_requires_correct_password(authed):
    client, _ = authed

    response = client.delete(reverse("auth-account"), {"auth_hash": b64(32)}, format="json")

    assert response.status_code == 400
    assert "auth_hash" in response.json()
    assert User.objects.filter(username="alice").exists()


def test_delete_account_requires_auth():
    assert APIClient().delete(reverse("auth-account"), {}, format="json").status_code == 401


def test_deleting_one_account_leaves_others(authed):
    client, creds = authed
    other = User.objects.create_user(username="bob", password="x")

    client.delete(reverse("auth-account"), {"auth_hash": creds["auth_hash"]}, format="json")

    assert User.objects.filter(pk=other.pk).exists()
