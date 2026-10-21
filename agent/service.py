from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from datetime import UTC, datetime, timedelta

from agent.config import Settings, calendly_link
from agent.providers import Brain, Calendar, Calendly, Gmail, ProviderError, booking_record
from agent.store import Store

logger = logging.getLogger(__name__)


def retry_at(attempt: int) -> float:
    return time.time() + min(3600, 30 * 2 ** min(attempt, 7))


class Agent:
    def __init__(
        self,
        settings: Settings,
        store: Store,
        gmail: Gmail,
        calendly: Calendly,
        brain: Brain,
        calendar: Calendar,
    ):
        self.settings, self.store = settings, store
        self.gmail, self.calendly, self.brain, self.calendar = gmail, calendly, brain, calendar
        self.lock = asyncio.Lock()

    async def run_cycle(self) -> dict:
        if self.lock.locked():
            return {"busy": True}
        errors = []

        async def part(name, action):
            try:
                await action()
            except Exception as exc:
                detail = str(exc) if isinstance(exc, ProviderError) else type(exc).__name__
                self.store.audit("cycle_error", name, detail)
                logger.warning("%s: %s", name, detail)
                errors.append({"stage": name, "error": detail})

        async with self.lock:
            if self.settings.calendly_api_token:
                await part("calendly_sync", self.sync_calendly)
                await part("calendly_notifications", self.process_notifications)
            if not self.settings.missing()["email"]:
                profile = None
                try:
                    profile = await self.gmail.profile()
                except ProviderError as exc:
                    errors.append({"stage": "google_auth", "error": str(exc)})
                if (
                    profile
                    and profile.get("emailAddress", "").lower() != self.settings.agent_email.lower()
                ):
                    detail = "AGENT_EMAIL difere da caixa autenticada; nenhuma mensagem foi enviada"
                    self.store.audit("identity_mismatch", detail=detail)
                    errors.append({"stage": "google_auth", "error": detail})
                elif profile:
                    await part("email_ingest", self.ingest)
                    await part("email_plan", self.plan_replies)
                    await part("email_reconcile", self.reconcile)
                    await part("email_send", self.send_pending)
            self.store.set("last_cycle", str(time.time()))
            self.store.set("last_errors", json.dumps(errors))
        return {
            "busy": False,
            "errors": errors,
            "mode": "live" if self.settings.auto_send else "draft",
        }

    async def ingest(self) -> None:
        since = self.store.get("gmail_since")
        if not since:
            since = str(int(time.time()) - self.settings.initial_lookback_days * 86400)
            self.store.set("gmail_since", since)
        messages, cursor = await self.gmail.scan(self.store.get("gmail_cursor"), int(since))
        for message in messages:
            self.store.add_message(message)
        # Só avançar após persistir todas as mensagens do lote.
        self.store.set("gmail_cursor", cursor)

    def ignore_reason(self, message: dict) -> str:
        headers = json.loads(message["headers"])
        if not message["sender"]:
            return "Remetente inválido ou ambíguo"
        if message["sender"].lower() == self.settings.agent_email.lower():
            return "Mensagem do próprio agente"
        auto = headers.get("auto-submitted", "no").strip().lower()
        if auto != "no" or headers.get("precedence", "").lower() in {"bulk", "list", "junk"}:
            return "Mensagem automática ou de lista"
        if (
            headers.get("list-id")
            or headers.get("x-auto-response-suppress")
            or headers.get("return-path", "").strip() == "<>"
        ):
            return "Mensagem automática ou de lista"
        latest = self.store.one(
            """SELECT id FROM messages WHERE thread_id=? AND sender=?
            ORDER BY received_at DESC,id DESC LIMIT 1""",
            (message["thread_id"], message["sender"]),
        )
        if latest and latest["id"] != message["id"]:
            return "Substituída por mensagem mais recente da mesma conversa"
        return ""

    def human(self, message_id: str, reason: str) -> None:
        self.store.execute(
            "UPDATE messages SET status='human',reason=? WHERE id=?", (reason[:300], message_id)
        )
        self.store.audit("human_required", message_id, reason[:300])

    def compose(self, decision: dict, message: dict) -> str | None:
        intent = decision["intent"]
        if intent == "schedule":
            link = calendly_link(self.settings.calendly_scheduling_url)
            if not link:
                return None
            reply = (
                "Olá! Você pode escolher um horário disponível e concluir o agendamento aqui:\n"
                f"{link}\n\nConfira o fuso horário na página antes de confirmar. "
                "O Calendly enviará a confirmação após a reserva."
            )
        elif intent in {"reschedule", "cancel"}:
            bookings = self.store.rows(
                """SELECT * FROM bookings WHERE email=? AND status='active' AND starts_at>=?
                ORDER BY starts_at LIMIT 2""",
                (message["sender"], datetime.now(UTC).isoformat()),
            )
            if len(bookings) > 1:
                return None
            if not bookings:
                return None
            link = calendly_link(
                bookings[0]["reschedule_url" if intent == "reschedule" else "cancel_url"]
            )
            if not link:
                return None
            action = "reagendamento" if intent == "reschedule" else "cancelamento"
            reply = f"Olá! Você pode concluir o {action} pelo link da sua reserva:\n{link}"
        elif intent == "question":
            reply = decision["reply"].strip()
        else:
            return None
        return f"{reply}\n\n{self.settings.agent_name}\nAssistente virtual de {self.settings.company_name}".strip()

    async def plan_replies(self) -> None:
        messages = self.store.rows(
            "SELECT * FROM messages WHERE status='queued' AND next_attempt_at<=? ORDER BY received_at LIMIT 50",
            (time.time(),),
        )
        for message in messages:
            ignored = self.ignore_reason(message)
            if ignored:
                self.store.execute(
                    "UPDATE messages SET status='ignored',reason=? WHERE id=?",
                    (ignored, message["id"]),
                )
                continue
            if not message["internet_id"] or not message["body"].strip():
                self.human(
                    message["id"], "Mensagem sem identificação de resposta ou sem texto legível"
                )
                continue
            headers = json.loads(message["headers"])
            authentication = headers.get("authentication-results", "").lower()
            if any(value in authentication for value in ("spf=fail", "dkim=fail", "dmarc=fail")):
                self.human(message["id"], "Autenticação do remetente requer revisão")
                continue
            history = self.store.rows(
                """SELECT m.subject,m.body,o.body AS agent_reply FROM messages m
                LEFT JOIN outbox o ON o.message_id=m.id AND o.status='sent'
                WHERE m.thread_id=? AND m.sender=? AND m.id!=? AND m.received_at<=?
                ORDER BY m.received_at DESC LIMIT 5""",
                (message["thread_id"], message["sender"], message["id"], message["received_at"]),
            )
            try:
                decision = await self.brain.decide(message, list(reversed(history)))
                if decision["intent"] == "ignore":
                    self.store.execute(
                        "UPDATE messages SET status='ignored',reason=? WHERE id=?",
                        (decision["reason"][:300], message["id"]),
                    )
                    continue
                body = self.compose(decision, message)
                if not body:
                    self.human(
                        message["id"],
                        decision["reason"] or "Informações insuficientes para responder",
                    )
                    continue
                outgoing_id = (
                    "<agent."
                    + hashlib.sha256(message["id"].encode()).hexdigest()
                    + "@"
                    + self.settings.agent_email.split("@", 1)[1]
                    + ">"
                )
                subject = message["subject"]
                if not subject.lower().startswith("re:"):
                    subject = "Re: " + subject
                now = time.time()
                with self.store.connect() as conn:
                    conn.execute(
                        """INSERT OR IGNORE INTO outbox
                        (message_id,outgoing_id,recipient,subject,body,status,created_at,updated_at)
                        VALUES (?,?,?,?,?,?,?,?)""",
                        (
                            message["id"],
                            outgoing_id,
                            message["sender"],
                            subject,
                            body,
                            "pending" if self.settings.auto_send else "draft",
                            now,
                            now,
                        ),
                    )
                    conn.execute(
                        "UPDATE messages SET status='planned' WHERE id=?", (message["id"],)
                    )
                self.store.audit("reply_planned", message["id"], decision["intent"])
            except Exception as exc:
                attempt = message["attempts"] + 1
                detail = str(exc) if isinstance(exc, ProviderError) else type(exc).__name__
                self.store.execute(
                    "UPDATE messages SET attempts=?,reason=?,next_attempt_at=? WHERE id=?",
                    (attempt, detail, retry_at(attempt), message["id"]),
                )
                if attempt >= 5:
                    self.human(message["id"], "Falha persistente ao preparar resposta: " + detail)

    async def send_pending(self) -> None:
        if not self.settings.auto_send:
            return
        for outgoing in self.store.rows(
            "SELECT * FROM outbox WHERE status='pending' AND next_attempt_at<=? ORDER BY created_at LIMIT 50",
            (time.time(),),
        ):
            if not self.store.execute(
                "UPDATE outbox SET status='sending',attempts=attempts+1,updated_at=? WHERE message_id=? AND status='pending'",
                (time.time(), outgoing["message_id"]),
            ):
                continue
            incoming = self.store.one(
                "SELECT * FROM messages WHERE id=?", (outgoing["message_id"],)
            )
            try:
                provider_id = await self.gmail.send(incoming, outgoing)
            except Exception as exc:
                if isinstance(exc, ProviderError) and exc.status == 429:
                    status = "pending" if outgoing["attempts"] < 7 else "failed"
                elif isinstance(exc, ProviderError) and exc.status and not exc.ambiguous:
                    status = "failed"
                else:
                    status = "uncertain"
                detail = str(exc) if isinstance(exc, ProviderError) else type(exc).__name__
                self.store.execute(
                    "UPDATE outbox SET status=?,last_error=?,next_attempt_at=?,updated_at=? WHERE message_id=?",
                    (
                        status,
                        detail,
                        retry_at(outgoing["attempts"] + 1),
                        time.time(),
                        outgoing["message_id"],
                    ),
                )
                self.store.audit("send_" + status, outgoing["message_id"], detail)
                continue
            self.mark_sent(outgoing["message_id"], provider_id)

    def mark_sent(self, message_id: str, provider_id: str) -> None:
        self.store.execute(
            "UPDATE outbox SET status='sent',provider_id=?,last_error='',updated_at=? WHERE message_id=?",
            (provider_id, time.time(), message_id),
        )
        self.store.audit("email_sent", message_id)

    async def reconcile(self) -> None:
        for outgoing in self.store.rows("SELECT * FROM outbox WHERE status='uncertain' LIMIT 50"):
            provider_id = await self.gmail.find_sent(outgoing["outgoing_id"])
            if provider_id:
                self.mark_sent(outgoing["message_id"], provider_id)

    async def process_notifications(self) -> None:
        for notification in self.store.rows(
            "SELECT * FROM notifications WHERE status='pending' AND next_attempt_at<=? ORDER BY created_at LIMIT 50",
            (time.time(),),
        ):
            self.store.execute(
                "UPDATE notifications SET status='processing' WHERE id=?", (notification["id"],)
            )
            try:
                data = json.loads(notification["payload"])
                invitee = data["payload"]
                event = await self.calendly.event(invitee["event"])
                self.store.save_booking(
                    booking_record(invitee, event, canceled=data["event"] == "invitee.canceled")
                )
                self.store.execute(
                    "UPDATE notifications SET status='done' WHERE id=?", (notification["id"],)
                )
                self.store.audit("booking_registered", invitee["uri"], data["event"])
            except Exception as exc:
                attempt = notification["attempts"] + 1
                detail = str(exc) if isinstance(exc, ProviderError) else type(exc).__name__
                self.store.execute(
                    "UPDATE notifications SET status=?,attempts=?,next_attempt_at=?,last_error=? WHERE id=?",
                    (
                        "failed" if attempt >= 8 else "pending",
                        attempt,
                        retry_at(attempt),
                        detail,
                        notification["id"],
                    ),
                )
                self.store.audit("booking_retry", notification["id"], detail)

    async def sync_calendly(self) -> None:
        if time.time() < float(self.store.get("calendly_next_sync", "0")):
            return
        now = datetime.now(UTC)
        start = (now - timedelta(days=self.settings.calendly_lookback_days)).isoformat()
        end = (now + timedelta(days=self.settings.calendly_ahead_days)).isoformat()
        try:
            async for booking in self.calendly.bookings(start, end):
                self.store.save_booking(booking)
        except Exception:
            failures = int(self.store.get("calendly_failures", "0")) + 1
            self.store.set("calendly_failures", str(failures))
            self.store.set("calendly_next_sync", str(retry_at(failures)))
            raise
        self.store.set("calendly_failures", "0")
        self.store.set("calendly_next_sync", str(time.time() + self.settings.calendly_sync_seconds))
        self.store.set("calendly_last_sync", str(time.time()))
