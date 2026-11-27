import base64
import os
from datetime import timedelta
from pathlib import Path

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from sharing.models import ShareLink
from storage.models import File

User = get_user_model()

pytestmark = pytest.mark.django_db


def b64(n: int) -> str:
    return base64.b64encode(os.urandom(n)).decode()


@pytest.fixture(autouse=True)
def media_root(settings, tmp_path) -> Path:
    settings.MEDIA_ROOT = tmp_path
    return tmp_path


def make_client(username: str) -> APIClient:
    client = APIClient()
    client.force_authenticate(User.objects.create_user(username=username, password="x"))
    return client


@pytest.fixture
def alice() -> APIClient:
    return make_client("alice")


@pytest.fixture
def bob() -> APIClient:
    return make_client("bob")


CONTENT = os.urandom(300)


@pytest.fixture
def file_id(alice) -> str:
    response = alice.post(
        reverse("file-list"),
        {"blob": SimpleUploadedFile("blob", CONTENT), "encrypted_name": b64(40), "encrypted_file_key": b64(60)},
        format="multipart",
    )
    return response.json()["id"]


def share(client, file_id, **extra):
    return client.post(reverse("share-list"), {"file": file_id, **extra}, format="json")


def download(link_id):
    return APIClient().get(reverse("share-download", args=[link_id]))


# --- create / list / delete (owner) ---


def test_create_link_returns_unguessable_id(alice, file_id):
    response = share(alice, file_id, max_downloads=3)

    assert response.status_code == 201
    body = response.json()
    assert len(body["id"]) >= 22  # 16 random bytes, base64url
    assert body["max_downloads"] == 3
    assert body["downloads_left"] == 3
    assert body["download_count"] == 0


def test_link_stores_no_key(alice, file_id):
    share(alice, file_id)

    fields = {f.name for f in ShareLink._meta.get_fields()}
    assert not any("key" in name for name in fields)


def test_cannot_share_someone_elses_file(bob, file_id):
    response = share(bob, file_id)

    assert response.status_code == 400
    assert "file" in response.json()


@pytest.mark.parametrize(
    "extra, field",
    [
        ({"expires_at": (timezone.now() - timedelta(minutes=1)).isoformat()}, "expires_at"),
        ({"max_downloads": 0}, "max_downloads"),
        ({"max_downloads": 100_000}, "max_downloads"),
    ],
)
def test_create_validation(alice, file_id, extra, field):
    response = share(alice, file_id, **extra)

    assert response.status_code == 400
    assert field in response.json()


def test_creating_requires_auth(file_id):
    assert share(APIClient(), file_id).status_code == 401


def test_list_shows_only_active_links_of_own_file(alice, bob, file_id):
    share(alice, file_id)
    expired = ShareLink.objects.create(file_id=file_id, expires_at=timezone.now() + timedelta(seconds=1))
    ShareLink.objects.filter(pk=expired.pk).update(expires_at=timezone.now() - timedelta(seconds=1))

    mine = alice.get(reverse("share-list"), {"file": file_id}).json()
    theirs = bob.get(reverse("share-list"), {"file": file_id}).json()

    assert len(mine) == 1
    assert theirs == []


def test_list_with_malformed_file_id_returns_400(alice):
    assert alice.get(reverse("share-list"), {"file": "nope"}).status_code == 400


def test_owner_can_revoke_link(alice, file_id):
    link_id = share(alice, file_id).json()["id"]

    assert alice.delete(reverse("share-detail", args=[link_id])).status_code == 204
    assert APIClient().get(reverse("share-detail", args=[link_id])).status_code == 404


def test_others_cannot_revoke_link(alice, bob, file_id):
    link_id = share(alice, file_id).json()["id"]

    assert bob.delete(reverse("share-detail", args=[link_id])).status_code == 404
    assert APIClient().delete(reverse("share-detail", args=[link_id])).status_code == 401
    assert ShareLink.objects.filter(pk=link_id).exists()


# --- public access ---


def test_public_metadata_without_auth(alice, file_id):
    link_id = share(alice, file_id, max_downloads=2).json()["id"]
    file = File.objects.get(pk=file_id)

    response = APIClient().get(reverse("share-detail", args=[link_id]))

    assert response.status_code == 200
    assert response.json() == {
        "encrypted_name": file.encrypted_name,
        "size": file.size,
        "expires_at": None,
        "downloads_left": 2,
    }


def test_public_metadata_ignores_stale_token(alice, file_id):
    link_id = share(alice, file_id).json()["id"]
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION="Bearer expired.or.garbage")

    assert client.get(reverse("share-detail", args=[link_id])).status_code == 200


def test_metadata_does_not_count_as_download(alice, file_id):
    link_id = share(alice, file_id, max_downloads=1).json()["id"]

    for _ in range(3):
        APIClient().get(reverse("share-detail", args=[link_id]))

    assert ShareLink.objects.get(pk=link_id).download_count == 0


def test_download_returns_ciphertext_and_counts(alice, file_id):
    link_id = share(alice, file_id, max_downloads=5).json()["id"]

    response = download(link_id)

    assert response.status_code == 200
    assert b"".join(response.streaming_content) == CONTENT
    assert ShareLink.objects.get(pk=link_id).download_count == 1


def test_link_self_destructs_after_last_download(alice, file_id):
    link_id = share(alice, file_id, max_downloads=2).json()["id"]

    assert download(link_id).status_code == 200
    assert download(link_id).status_code == 200  # the last allowed download still succeeds

    assert not ShareLink.objects.filter(pk=link_id).exists()
    assert download(link_id).status_code == 404
    assert APIClient().get(reverse("share-detail", args=[link_id])).status_code == 404
    assert File.objects.filter(pk=file_id).exists()  # the owner's file is untouched


def test_unlimited_link_keeps_working(alice, file_id):
    link_id = share(alice, file_id).json()["id"]

    for _ in range(5):
        assert download(link_id).status_code == 200


def test_expired_link_is_gone_and_deleted(alice, file_id):
    link_id = share(alice, file_id, expires_at=(timezone.now() + timedelta(hours=1)).isoformat()).json()["id"]
    ShareLink.objects.filter(pk=link_id).update(expires_at=timezone.now() - timedelta(seconds=1))

    assert APIClient().get(reverse("share-detail", args=[link_id])).status_code == 404
    assert not ShareLink.objects.filter(pk=link_id).exists()


def test_unknown_link_is_404():
    assert APIClient().get(reverse("share-detail", args=["doesnotexist"])).status_code == 404
    assert download("doesnotexist").status_code == 404


def test_deleting_file_deletes_its_links(alice, file_id):
    link_id = share(alice, file_id).json()["id"]

    alice.delete(reverse("file-detail", args=[file_id]))

    assert not ShareLink.objects.filter(pk=link_id).exists()


def test_purge_command_removes_expired_and_exhausted(alice, file_id):
    keep = share(alice, file_id).json()["id"]
    expired = share(alice, file_id, expires_at=(timezone.now() + timedelta(hours=1)).isoformat()).json()["id"]
    exhausted = share(alice, file_id, max_downloads=1).json()["id"]
    ShareLink.objects.filter(pk=expired).update(expires_at=timezone.now() - timedelta(seconds=1))
    ShareLink.objects.filter(pk=exhausted).update(download_count=1)

    call_command("purge_expired_shares")

    assert list(ShareLink.objects.values_list("id", flat=True)) == [keep]
