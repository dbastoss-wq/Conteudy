import asyncio
import time
from dataclasses import replace

import pytest

from agent.providers import ProviderError, booking_record
from agent.store import Store
from tests.conftest import EVENT_URI, INVITEE_URI, event_data, invitee_data, mail


async def test_email_to_draft_is_persistent_and_idempotent(system):
    await system.agent.run_cycle()
    await system.agent.run_cycle()
    outbox = system.store.rows("SELECT * FROM outbox")
    assert len(outbox) == 1
    assert outbox[0]["status"] == "draft"
    assert outbox[0]["recipient"] == "cliente@example.com"
    assert system.settings.calendly_scheduling_url in outbox[0]["body"]
    assert "confirmado" not in outbox[0]["body"].lower()
    assert not system.gmail.send_calls
    assert system.brain.calls == 1
    reopened = Store(system.settings.database_path)
    assert reopened.get("gmail_cursor") == "10"
    assert reopened.one("SELECT status FROM outbox")["status"] == "draft"


async def test_live_sends_once_to_sender_and_keeps_thread(system):
    system.agent.settings = replace(system.settings, auto_send=True)
    await system.agent.run_cycle()
    await system.agent.run_cycle()
    assert len(system.gmail.send_calls) == 1
    row = system.store.one("SELECT * FROM outbox")
    assert row["status"] == "sent"
    assert row["provider_id"] == "provider-sent-1"
    assert system.store.one("SELECT thread_id FROM messages")["thread_id"] == "thread-1"


@pytest.mark.parametrize(
    "headers",
    [
        {"auto-submitted": "auto-replied"},
        {"precedence": "bulk"},
        {"list-id": "some-list"},
        {"return-path": "<>"},
        {"x-auto-response-suppress": "All"},
    ],
)
async def test_automatic_messages_do_not_trigger_model_or_reply(system, headers):
    system.gmail.messages = [mail(headers=headers)]
    await system.agent.run_cycle()
    assert system.brain.calls == 0
    assert not system.store.rows("SELECT * FROM outbox")
    assert system.store.one("SELECT status FROM messages")["status"] == "ignored"


async def test_self_and_older_messages_are_ignored(system):
    system.gmail.messages = [
        mail("self", sender=system.settings.agent_email, thread_id="self"),
        mail("old", received_at=100),
        mail("new", received_at=200),
    ]
    await system.agent.run_cycle()
    assert system.brain.calls == 1
    assert system.store.one("SELECT message_id FROM outbox")["message_id"] == "new"


async def test_unknown_question_is_visible_for_human_review(system):
    system.brain.decision = {"intent": "human", "reply": "", "reason": "Preço não cadastrado"}
    await system.agent.run_cycle()
    row = system.store.one("SELECT status,reason FROM messages")
    assert row == {"status": "human", "reason": "Preço não cadastrado"}
    assert not system.gmail.send_calls


async def test_uncertain_send_is_reconciled_without_duplicate(system):
    system.agent.settings = replace(system.settings, auto_send=True)
    system.gmail.error = ProviderError("Gmail", ambiguous=True)
    system.gmail.accept_before_error = True
    await system.agent.run_cycle()
    assert system.store.one("SELECT status FROM outbox")["status"] == "uncertain"
    await system.agent.run_cycle()
    assert system.store.one("SELECT status FROM outbox")["status"] == "sent"
    assert len(system.gmail.send_calls) == 1


async def test_unresolved_send_never_retries_blindly(system):
    system.agent.settings = replace(system.settings, auto_send=True)
    system.gmail.error = ProviderError("Gmail", 503, ambiguous=True)
    for _ in range(3):
        await system.agent.run_cycle()
    assert len(system.gmail.send_calls) == 1
    assert system.store.one("SELECT status FROM outbox")["status"] == "uncertain"


async def test_crash_during_send_is_reconciled_on_restart(system):
    await system.agent.run_cycle()
    row = system.store.one("SELECT * FROM outbox")
    system.gmail.sent[row["outgoing_id"]] = "sent-before-crash"
    system.store.execute("UPDATE outbox SET status='sending'")
    system.store.recover()
    assert system.store.one("SELECT status FROM outbox")["status"] == "uncertain"
    await system.agent.run_cycle()
    assert system.store.one("SELECT provider_id FROM outbox")["provider_id"] == "sent-before-crash"
    assert not system.gmail.send_calls


async def test_rate_limited_send_retries_after_backoff(system):
    system.agent.settings = replace(system.settings, auto_send=True)
    system.gmail.error = ProviderError("Gmail", 429)
    await system.agent.run_cycle()
    row = system.store.one("SELECT * FROM outbox")
    assert row["status"] == "pending" and row["next_attempt_at"] > time.time()
    await system.agent.run_cycle()
    assert len(system.gmail.send_calls) == 1
    system.gmail.error = None
    system.store.execute("UPDATE outbox SET next_attempt_at=0")
    await system.agent.run_cycle()
    assert system.store.one("SELECT status FROM outbox")["status"] == "sent"
    assert system.gmail.send_calls[0]["outgoing_id"] == system.gmail.send_calls[1]["outgoing_id"]


async def test_permission_failure_is_not_retried(system):
    system.agent.settings = replace(system.settings, auto_send=True)
    system.gmail.error = ProviderError("Gmail", 403)
    await system.agent.run_cycle()
    await system.agent.run_cycle()
    assert len(system.gmail.send_calls) == 1
    assert system.store.one("SELECT status FROM outbox")["status"] == "failed"


async def test_wrong_google_account_blocks_ingest_and_send(system):
    system.gmail.address = "outra@example.com"
    result = await system.agent.run_cycle()
    assert result["errors"][0]["stage"] == "google_auth"
    assert not system.store.rows("SELECT * FROM messages")
    assert not system.gmail.send_calls


async def test_calendly_webhook_processing_and_polling_are_idempotent(system):
    invitee, event = invitee_data(), event_data()
    system.calendly.events[EVENT_URI] = event
    system.store.add_notification("delivery", {"event": "invitee.created", "payload": invitee})
    system.calendly.records = [booking_record(invitee, event)]
    await system.agent.run_cycle()
    assert len(system.store.rows("SELECT * FROM bookings")) == 1
    assert system.store.one("SELECT status FROM notifications")["status"] == "done"
    assert system.store.one("SELECT email FROM bookings")["email"] == "cliente@example.com"
    assert not system.gmail.send_calls


async def test_cancellation_cannot_be_undone_by_stale_creation(system):
    event = event_data()
    canceled = invitee_data(status="canceled", updated_at="2026-10-21T12:00:00Z")
    system.store.save_booking(booking_record(canceled, event))
    system.store.save_booking(booking_record(invitee_data(), event))
    assert system.store.one("SELECT status FROM bookings")["status"] == "canceled"


async def test_reschedule_links_old_and_new_records(system):
    event = event_data()
    system.store.save_booking(booking_record(invitee_data(), event))
    replacement = invitee_data(uri=EVENT_URI + "/invitees/replacement", old_invitee=INVITEE_URI)
    system.store.save_booking(booking_record(replacement, event))
    original = system.store.one("SELECT * FROM bookings WHERE invitee_uri=?", (INVITEE_URI,))
    assert original["status"] == "rescheduled"
    assert original["next_invitee_uri"] == replacement["uri"]
    assert system.store.one("SELECT COUNT(*) AS count FROM bookings")["count"] == 2


async def test_reschedule_is_correct_when_new_booking_arrives_before_original(system):
    event = event_data()
    replacement = invitee_data(uri=EVENT_URI + "/invitees/replacement", old_invitee=INVITEE_URI)
    system.store.save_booking(booking_record(replacement, event))
    system.store.save_booking(booking_record(invitee_data(), event))
    original = system.store.one("SELECT * FROM bookings WHERE invitee_uri=?", (INVITEE_URI,))
    assert original["status"] == "rescheduled"
    assert original["next_invitee_uri"] == replacement["uri"]


@pytest.mark.parametrize(
    "intent,expected",
    [
        ("cancel", "https://calendly.com/cancellations/invitee-1"),
        ("reschedule", "https://calendly.com/reschedulings/invitee-1"),
    ],
)
async def test_manage_booking_uses_link_for_same_email(system, intent, expected):
    system.store.save_booking(booking_record(invitee_data(), event_data()))
    system.brain.decision = {"intent": intent, "reply": "", "reason": "Pedido de alteração"}
    await system.agent.run_cycle()
    assert expected in system.store.one("SELECT body FROM outbox")["body"]


async def test_booking_links_are_never_disclosed_to_another_sender(system):
    system.store.save_booking(booking_record(invitee_data(email="outro@example.com"), event_data()))
    system.brain.decision = {"intent": "cancel", "reply": "", "reason": "Pedido de alteração"}
    await system.agent.run_cycle()
    assert system.store.one("SELECT status FROM messages")["status"] == "human"
    assert not system.store.rows("SELECT * FROM outbox")


async def test_notification_failure_is_durable_and_retryable(system):
    system.store.add_notification(
        "delivery", {"event": "invitee.created", "payload": invitee_data()}
    )
    system.calendly.error = ProviderError("Calendly", 429)
    await system.agent.run_cycle()
    row = system.store.one("SELECT * FROM notifications")
    assert row["status"] == "pending" and row["attempts"] == 1
    system.calendly.error = None
    system.store.execute("UPDATE notifications SET next_attempt_at=0")
    await system.agent.run_cycle()
    assert system.store.one("SELECT status FROM notifications")["status"] == "done"


async def test_repeated_model_failure_requires_human(system):
    system.brain.error = ProviderError("OpenAI", 500)
    for _ in range(5):
        system.store.execute("UPDATE messages SET next_attempt_at=0")
        await system.agent.run_cycle()
    assert system.store.one("SELECT status FROM messages")["status"] == "human"
    assert not system.gmail.send_calls


async def test_overlapping_cycles_do_not_execute_twice(system):
    started, release = asyncio.Event(), asyncio.Event()

    async def wait_profile():
        started.set()
        await release.wait()
        return {"emailAddress": system.settings.agent_email}

    system.gmail.profile = wait_profile
    first = asyncio.create_task(system.agent.run_cycle())
    await started.wait()
    try:
        assert await system.agent.run_cycle() == {"busy": True}
    finally:
        release.set()
        await first


def test_only_one_process_may_run_against_database(system):
    with system.store.exclusive_runtime(), pytest.raises(RuntimeError, match="único worker"):
        with Store(system.settings.database_path).exclusive_runtime():
            pytest.fail("O segundo processo não deveria obter o bloqueio")
