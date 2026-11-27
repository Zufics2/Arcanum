from django.urls import reverse
from rest_framework.test import APIClient


def test_health_returns_ok():
    response = APIClient().get(reverse("health"))

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_api_docs_available():
    response = APIClient().get(reverse("docs"))

    assert response.status_code == 200


def test_openapi_schema_is_public():
    response = APIClient().get(reverse("schema"))

    assert response.status_code == 200
    assert b"Arcanum API" in response.content


def test_swagger_ui_uses_no_third_party_cdn():
    html = APIClient().get(reverse("docs")).content.decode()

    assert "cdn.jsdelivr.net" not in html
    assert "/static/drf_spectacular_sidecar/swagger-ui-dist/" in html
