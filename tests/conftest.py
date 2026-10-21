from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from agent.config import Settings
from agent.providers import Mail
from agent.service import Agent
from agent.store import Store

EVENT_URI = "https://api.calendly.com/scheduled_events/event-1"
INVITEE_URI = EVENT_URI + "/invitees/invitee-1"


def mail(message_id="gmail-1", **changes):
    item = Mail(
        id=message_id,
        thread_id="thread-1",
        sender="cliente@example.com",
        sender_name="Cliente",
        subject="Reunião",
        body="Gostaria de agendar uma conversa.",
        internet_id=f"<{message_id}@example.com>",
        reference_ids="",
        headers={},
        received_at=100.0,
    )
    return replace(item, **changes)


def event_data():
    start = datetime.now(UTC) + timedelta(days=2)
    return {
        "uri": EVENT_URI,
        "status": "active",
        "start_time": start.isoformat(),
        "end_time": (start + timedelta(minutes=30)).isoformat(),
    }


def invitee_data(**changes):
    return {
        "uri": INVITEE_URI,
        "event": EVENT_URI,
        "email": "cliente@example.com",
        "name": "Cliente",
        "status": "active",
        "timezone": "America/Sao_Paulo",
        "rescheduled": False,
        "created_at": "2026-10-20T12:00:00Z",
        "updated_at": "2026-10-20T12:00:00Z",
        "cancel_url": "https://calendly.com/cancellations/invitee-1",
        "reschedule_url": "https://calendly.com/reschedulings/invitee-1",
        "old_invitee": None,
        "new_invitee": None,
        **changes,
    }


class FakeGmail:
    def __init__(self, settings):
        self.address = settings.agent_email
        self.messages = [mail()]
        self.send_calls = []
        self.sent = {}
        self.error = None
        self.accept_before_error = False

    async def profile(self):
        return {"emailAddress": self.address, "historyId": "10"}

    async def scan(self, cursor, since):
        return self.messages, "10"

    async def send(self, incoming, outgoing):
        self.send_calls.append(dict(outgoing))
        if not self.error or self.accept_before_error:
            self.sent[outgoing["outgoing_id"]] = "provider-sent-1"
        if self.error:
            raise self.error
        return "provider-sent-1"

    async def find_sent(self, outgoing_id):
        return self.sent.get(outgoing_id)


class FakeCalendly:
    def __init__(self):
        self.events = {EVENT_URI: event_data()}
        self.records = []
        self.error = None

    async def event(self, uri):
        if self.error:
            raise self.error
        return self.events[uri]

    async def bookings(self, start, end):
        if self.error:
            raise self.error
        for record in self.records:
            yield record


class FakeBrain:
    def __init__(self):
        self.decision = {"intent": "schedule", "reply": "", "reason": "Solicitação de reunião"}
        self.calls = 0
        self.error = None

    async def decide(self, message, history):
        self.calls += 1
        if self.error:
            raise self.error
        return self.decision


class FakeCalendar:
    async def availability(self, start, end):
        return {"calendar_id": "primary", "busy": [], "timezone": "America/Sao_Paulo"}


@pytest.fixture
def settings(tmp_path):
    knowledge = tmp_path / "company.md"
    knowledge.write_text("Atendemos de segunda a sexta, das 9h às 18h.", encoding="utf-8")
    return Settings(
        company_name="Empresa de teste",
        agent_email="assistente@example.com",
        database_path=str(tmp_path / "agent.sqlite3"),
        knowledge_path=str(knowledge),
        google_client_id="test-client",
        google_client_secret="test-client-secret",
        google_refresh_token="test-refresh-token",
        openai_api_key="test-openai-key",
        calendly_api_token="test-calendly-token",
        calendly_webhook_signing_key="test-signing-key",
        calendly_scheduling_url="https://calendly.com/teste/reuniao",
        admin_api_token="test-admin-token-01234567890123456789",
        run_worker=False,
    )


@pytest.fixture
def system(settings):
    store = Store(settings.database_path)
    gmail, calendly, brain = FakeGmail(settings), FakeCalendly(), FakeBrain()
    agent = Agent(settings, store, gmail, calendly, brain, FakeCalendar())
    return SimpleNamespace(
        settings=settings,
        store=store,
        gmail=gmail,
        calendly=calendly,
        brain=brain,
        agent=agent,
    )
