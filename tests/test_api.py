import hashlib
import hmac
import json
import time
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from agent.api import create_app, valid_signature
from tests.conftest import invitee_data


def signature(body, key, stamp=None):
    stamp = str(int(time.time()) if stamp is None else stamp)
    digest = hmac.new(key.encode(), stamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    return f"t={stamp},v1={digest}"


@pytest.fixture
def api(settings):
    with TestClient(create_app(settings)) as client:
        yield client


def auth(settings):
    return {"Authorization": f"Bearer {settings.admin_api_token}"}


@pytest.mark.parametrize(
    "path",
    [
        "/api/status",
        "/api/messages",
        "/api/outbox",
        "/api/bookings",
        "/api/contacts",
        "/api/audit",
    ],
)
def test_administrative_data_requires_authentication(api, path):
    assert api.get(path).status_code == 401
    assert api.get(path, headers={"Authorization": "Bearer incorrect"}).status_code == 401


def test_health_and_authenticated_status_do_not_expose_secrets(api, settings):
    assert api.get("/health").json()["status"] == "ok"
    response = api.get("/api/status", headers=auth(settings))
    assert response.status_code == 200
    assert response.json()["mode"] == "draft"
    for secret in [
        settings.admin_api_token,
        settings.google_client_secret,
        settings.google_refresh_token,
        settings.calendly_api_token,
        settings.openai_api_key,
    ]:
        assert secret not in response.text
        assert secret not in repr(settings)


def test_missing_admin_configuration_fails_closed(settings):
    with TestClient(create_app(replace(settings, admin_api_token=""))) as client:
        assert client.get("/api/status").status_code == 503


def test_signed_webhook_is_queued_once_without_external_requests(api, settings):
    raw = json.dumps({"event": "invitee.created", "payload": invitee_data()}).encode()
    headers = {"Calendly-Webhook-Signature": signature(raw, settings.calendly_webhook_signing_key)}
    first = api.post("/webhooks/calendly", content=raw, headers=headers)
    duplicate = api.post("/webhooks/calendly", content=raw, headers=headers)
    assert first.status_code == 202 and first.json()["status"] == "queued"
    assert duplicate.status_code == 202 and duplicate.json()["status"] == "duplicate"
    assert first.json()["id"] == duplicate.json()["id"]
    assert api.app.state.store.one("SELECT COUNT(*) AS count FROM notifications")["count"] == 1
    assert not api.app.state.store.rows("SELECT * FROM bookings")


@pytest.mark.parametrize("change", ["tamper", "expired", "missing"])
def test_invalid_webhook_cannot_enqueue(api, settings, change):
    raw = json.dumps({"event": "invitee.created", "payload": invitee_data()}).encode()
    stamp = int(time.time()) - 301 if change == "expired" else None
    signed = signature(raw, settings.calendly_webhook_signing_key, stamp=stamp)
    if change == "tamper":
        raw += b" "
    response = api.post(
        "/webhooks/calendly",
        content=raw,
        headers={
            "Calendly-Webhook-Signature": "" if change == "missing" else signed,
        },
    )
    assert response.status_code == 401
    assert not api.app.state.store.rows("SELECT * FROM notifications")


def test_signed_webhook_cannot_fetch_arbitrary_urls(api, settings):
    raw = json.dumps(
        {"event": "invitee.created", "payload": invitee_data(event="http://127.0.0.1/")}
    ).encode()
    response = api.post(
        "/webhooks/calendly",
        content=raw,
        headers={
            "Calendly-Webhook-Signature": signature(raw, settings.calendly_webhook_signing_key),
        },
    )
    assert response.status_code == 400
    assert not api.app.state.store.rows("SELECT * FROM notifications")


def test_webhook_body_has_size_limit(api):
    assert api.post("/webhooks/calendly", content=b"x" * 262_145).status_code == 413


def test_webhook_requires_configured_signing_key(settings):
    with TestClient(create_app(replace(settings, calendly_webhook_signing_key=""))) as client:
        assert client.post("/webhooks/calendly", json={}).status_code == 503


def test_key_rotation_accepts_any_valid_v1_but_rejects_duplicate_timestamps():
    raw, key = b'{"test":1}', "test-key"
    valid = signature(raw, key)
    assert valid_signature(raw, valid + ",v1=wrong", key)
    assert not valid_signature(raw, valid + ",t=0", key)
    assert not valid_signature(raw, "t=abc,v1=x", key)


def test_draft_cannot_be_approved_in_draft_mode(api, settings):
    response = api.post("/api/outbox/not-present/approve", headers=auth(settings))
    assert response.status_code == 409


@pytest.mark.parametrize(
    "body",
    [
        {"start": "2026-10-21T09:00:00", "end": "2026-10-21T10:00:00"},
        {"start": "2026-10-22T09:00:00Z", "end": "2026-10-21T10:00:00Z"},
        {"start": "2026-10-21T09:00:00Z", "end": "2027-10-21T10:00:00Z"},
    ],
)
def test_calendar_requires_bounded_dates_with_timezone(api, settings, body):
    assert api.post("/api/availability", json=body, headers=auth(settings)).status_code == 422


def test_failed_notification_can_be_retried(api, settings):
    store = api.app.state.store
    store.add_notification("failed", {"event": "invitee.created", "payload": invitee_data()})
    store.execute("UPDATE notifications SET status='failed',attempts=8")
    result = api.post("/api/notifications/failed/retry", headers=auth(settings))
    assert result.status_code == 200
    assert store.one("SELECT status,attempts FROM notifications") == {
        "status": "pending",
        "attempts": 0,
    }
