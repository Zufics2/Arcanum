import base64
import os
import uuid
from pathlib import Path

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from rest_framework.test import APIClient

from storage.models import File, Folder

User = get_user_model()

pytestmark = pytest.mark.django_db


def enc(n: int = 40) -> str:
    """A plausible base64 ciphertext of n bytes."""
    return base64.b64encode(os.urandom(n)).decode()


@pytest.fixture(autouse=True)
def media_root(settings, tmp_path) -> Path:
    settings.MEDIA_ROOT = tmp_path
    return tmp_path


def make_client(username: str) -> tuple[APIClient, User]:
    user = User.objects.create_user(username=username, password="x")
    client = APIClient()
    client.force_authenticate(user)
    return client, user


@pytest.fixture
def alice():
    return make_client("alice")


@pytest.fixture
def bob():
    return make_client("bob")


def create_folder(client: APIClient, parent=None) -> dict:
    response = client.post(
        reverse("folder-list"),
        {"encrypted_name": enc(), "parent": str(parent) if parent else None},
        format="json",
    )
    assert response.status_code == 201, response.content
    return response.json()


def upload(client: APIClient, folder=None, content: bytes | None = None, **overrides):
    data = {
        "blob": SimpleUploadedFile("blob", content or os.urandom(100), "application/octet-stream"),
        "encrypted_name": enc(),
        "encrypted_file_key": enc(60),
    }
    if folder:
        data["folder"] = str(folder)
    data.update(overrides)
    return client.post(reverse("file-list"), data, format="multipart")


# --- auth ---


@pytest.mark.parametrize("url", ["/api/folders/", "/api/folders/tree/", "/api/files/"])
def test_endpoints_require_authentication(url):
    assert APIClient().get(url).status_code == 401


# --- folders ---


def test_root_listing_is_empty_initially(alice):
    client, _ = alice

    response = client.get(reverse("folder-list"))

    assert response.status_code == 200
    assert response.json() == {"folder": None, "path": [], "folders": [], "files": []}


def test_create_and_list_nested_folders_with_path(alice):
    client, _ = alice
    root = create_folder(client)
    child = create_folder(client, parent=root["id"])
    grandchild = create_folder(client, parent=child["id"])

    body = client.get(reverse("folder-list"), {"parent": child["id"]}).json()

    assert body["folder"]["id"] == child["id"]
    assert [p["id"] for p in body["path"]] == [root["id"], child["id"]]
    assert [f["id"] for f in body["folders"]] == [grandchild["id"]]
    assert client.get(reverse("folder-list")).json()["folders"][0]["id"] == root["id"]


def test_folder_name_must_be_base64_ciphertext(alice):
    client, _ = alice

    response = client.post(reverse("folder-list"), {"encrypted_name": "plain name"}, format="json")

    assert response.status_code == 400
    assert "encrypted_name" in response.json()


def test_listing_with_malformed_parent_returns_400(alice):
    client, _ = alice

    assert client.get(reverse("folder-list"), {"parent": "nope"}).status_code == 400


def test_tree_returns_all_folders(alice):
    client, _ = alice
    root = create_folder(client)
    create_folder(client, parent=root["id"])

    response = client.get(reverse("folder-tree"))

    assert response.status_code == 200
    assert len(response.json()) == 2


def test_rename_and_move_folder(alice):
    client, _ = alice
    a = create_folder(client)
    b = create_folder(client)
    new_name = enc()

    response = client.patch(
        reverse("folder-detail", args=[b["id"]]),
        {"encrypted_name": new_name, "parent": a["id"]},
        format="json",
    )

    assert response.status_code == 200
    folder = Folder.objects.get(pk=b["id"])
    assert folder.encrypted_name == new_name
    assert str(folder.parent_id) == a["id"]


def test_move_folder_back_to_root(alice):
    client, _ = alice
    a = create_folder(client)
    b = create_folder(client, parent=a["id"])

    response = client.patch(reverse("folder-detail", args=[b["id"]]), {"parent": None}, format="json")

    assert response.status_code == 200
    assert Folder.objects.get(pk=b["id"]).parent is None


@pytest.mark.parametrize("target", ["self", "descendant"])
def test_cannot_move_folder_into_itself_or_descendant(alice, target):
    client, _ = alice
    a = create_folder(client)
    child = create_folder(client, parent=a["id"])
    parent = a["id"] if target == "self" else child["id"]

    response = client.patch(reverse("folder-detail", args=[a["id"]]), {"parent": parent}, format="json")

    assert response.status_code == 400
    assert "parent" in response.json()


def test_delete_folder_cascades_subfolders_files_and_blobs(
    alice, media_root, django_capture_on_commit_callbacks
):
    client, _ = alice
    a = create_folder(client)
    b = create_folder(client, parent=a["id"])
    upload(client, folder=a["id"])
    upload(client, folder=b["id"])
    assert len(list((media_root / "blobs").iterdir())) == 2

    with django_capture_on_commit_callbacks(execute=True):
        response = client.delete(reverse("folder-detail", args=[a["id"]]))

    assert response.status_code == 204
    assert not Folder.objects.exists()
    assert not File.objects.exists()
    assert list((media_root / "blobs").iterdir()) == []


# --- files ---


def test_upload_stores_ciphertext_under_random_name(alice, media_root):
    client, user = alice
    content = os.urandom(1000)

    response = client.post(
        reverse("file-list"),
        {
            "blob": SimpleUploadedFile("secret-report.pdf", content),
            "encrypted_name": enc(),
            "encrypted_file_key": enc(60),
        },
        format="multipart",
    )

    assert response.status_code == 201, response.content
    body = response.json()
    assert body["size"] == 1000
    assert "blob" not in body
    file = File.objects.get(pk=body["id"])
    assert file.owner == user
    assert "secret-report" not in file.blob.name
    assert (media_root / file.blob.name).read_bytes() == content


def test_upload_into_folder_appears_in_listing(alice):
    client, _ = alice
    folder = create_folder(client)

    file_id = upload(client, folder=folder["id"]).json()["id"]

    body = client.get(reverse("folder-list"), {"parent": folder["id"]}).json()
    assert [f["id"] for f in body["files"]] == [file_id]
    assert client.get(reverse("folder-list")).json()["files"] == []


@pytest.mark.parametrize(
    "overrides, field",
    [
        ({"encrypted_file_key": enc(32)}, "encrypted_file_key"),  # not an encrypted 32-byte key
        ({"encrypted_name": "report.pdf"}, "encrypted_name"),
        ({"blob": SimpleUploadedFile("blob", b"short")}, "blob"),  # smaller than iv + tag
    ],
)
def test_upload_validation(alice, overrides, field):
    client, _ = alice

    response = upload(client, **overrides)

    assert response.status_code == 400
    assert field in response.json()


def test_upload_rejects_files_over_limit(alice, monkeypatch):
    client, _ = alice
    monkeypatch.setattr("storage.serializers.MAX_BLOB_BYTES", 50)

    response = upload(client, content=os.urandom(51))

    assert response.status_code == 400
    assert "blob" in response.json()


def test_download_returns_exact_ciphertext(alice):
    client, _ = alice
    content = os.urandom(5000)
    file_id = upload(client, content=content).json()["id"]

    response = client.get(reverse("file-download", args=[file_id]))

    assert response.status_code == 200
    assert response["Content-Type"] == "application/octet-stream"
    assert b"".join(response.streaming_content) == content


def test_rename_and_move_file(alice):
    client, _ = alice
    folder = create_folder(client)
    file_id = upload(client).json()["id"]
    new_name = enc()

    response = client.patch(
        reverse("file-detail", args=[file_id]),
        {"encrypted_name": new_name, "folder": folder["id"]},
        format="json",
    )

    assert response.status_code == 200
    file = File.objects.get(pk=file_id)
    assert file.encrypted_name == new_name
    assert str(file.folder_id) == folder["id"]


def test_file_key_cannot_be_changed_by_patch(alice):
    client, _ = alice
    body = upload(client).json()

    client.patch(reverse("file-detail", args=[body["id"]]), {"encrypted_file_key": enc(60)}, format="json")

    assert File.objects.get(pk=body["id"]).encrypted_file_key == body["encrypted_file_key"]


def test_delete_file_removes_blob(alice, media_root, django_capture_on_commit_callbacks):
    client, _ = alice
    file_id = upload(client).json()["id"]
    blob_path = media_root / File.objects.get(pk=file_id).blob.name

    with django_capture_on_commit_callbacks(execute=True):
        response = client.delete(reverse("file-detail", args=[file_id]))

    assert response.status_code == 204
    assert not blob_path.exists()


# --- isolation between users ---


def test_users_cannot_see_or_touch_each_others_objects(alice, bob):
    alice_client, _ = alice
    bob_client, _ = bob
    folder = create_folder(alice_client)
    file_id = upload(alice_client, folder=folder["id"]).json()["id"]

    assert bob_client.get(reverse("folder-list"), {"parent": folder["id"]}).status_code == 404
    assert bob_client.get(reverse("folder-list")).json()["folders"] == []
    assert bob_client.get(reverse("folder-tree")).json() == []
    assert bob_client.get(reverse("file-download", args=[file_id])).status_code == 404
    assert bob_client.patch(
        reverse("file-detail", args=[file_id]), {"encrypted_name": enc()}, format="json"
    ).status_code == 404
    assert bob_client.delete(reverse("folder-detail", args=[folder["id"]])).status_code == 404
    assert bob_client.delete(reverse("file-detail", args=[file_id])).status_code == 404
    assert File.objects.filter(pk=file_id).exists()


def test_cannot_put_objects_into_someone_elses_folder(alice, bob):
    alice_client, _ = alice
    bob_client, _ = bob
    alice_folder = create_folder(alice_client)
    bob_folder = create_folder(bob_client)

    upload_response = upload(bob_client, folder=alice_folder["id"])
    move_response = bob_client.patch(
        reverse("folder-detail", args=[bob_folder["id"]]), {"parent": alice_folder["id"]}, format="json"
    )

    assert upload_response.status_code == 400
    assert move_response.status_code == 400


def test_detail_with_malformed_id_returns_404(alice):
    client, _ = alice

    assert client.delete(reverse("file-detail", args=[uuid.uuid4()])).status_code == 404
    assert client.delete("/api/files/not-a-uuid/").status_code == 404


def test_download_head_returns_first_bytes(alice):
    client, _ = alice
    content = os.urandom(10_000)
    file_id = upload(client, content=content).json()["id"]

    first = client.get(reverse("file-download", args=[file_id]), {"head": 512})
    capped = client.get(reverse("file-download", args=[file_id]), {"head": 1_000_000})

    assert first.content == content[:512]
    assert capped.content == content[:4096]
    assert client.get(reverse("file-download", args=[file_id]), {"head": "x"}).status_code == 400
