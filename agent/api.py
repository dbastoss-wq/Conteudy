from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import secrets
import time
from contextlib import asynccontextmanager, suppress
from datetime import timedelta
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import AwareDatetime, BaseModel, model_validator

from agent.config import EMAIL_PATTERN, Settings
from agent.providers import Brain, Calendar, Calendly, Gmail, GoogleAuth, calendly_uri, utc
from agent.service import Agent
from agent.store import Store

MAX_WEBHOOK_BYTES = 262_144
bearer = HTTPBearer(auto_error=False)


def valid_signature(body: bytes, signature: str, key: str, now: float | None = None) -> bool:
    if not key or not signature:
        return False
    try:
        parts: dict[str, list[str]] = {}
        for item in signature.split(","):
            name, value = item.strip().split("=", 1)
            parts.setdefault(name, []).append(value)
        if len(parts.get("t", [])) != 1:
            return False
        stamp = parts["t"][0]
        if abs((time.time() if now is None else now) - int(stamp)) > 300:
            return False
        digest = hmac.new(key.encode(), stamp.encode() + b"." + body, hashlib.sha256).hexdigest()
        return any(
            secrets.compare_digest(digest.encode(), value.encode()) for value in parts.get("v1", [])
        )
    except (KeyError, ValueError, OverflowError):
        return False


class AvailabilityQuery(BaseModel):
    start: AwareDatetime
    end: AwareDatetime

    @model_validator(mode="after")
    def ordered(self):
        if self.end <= self.start or self.end - self.start > timedelta(days=31):
            raise ValueError("O intervalo deve ser positivo e de até 31 dias")
        return self


def create_app(
    settings: Settings | None = None, *, client: httpx.AsyncClient | None = None
) -> FastAPI:
    settings = settings or Settings.from_env()
    store = Store(settings.database_path)
    http = client or httpx.AsyncClient(timeout=45, follow_redirects=False)
    auth = GoogleAuth(settings, http)
    agent = Agent(
        settings,
        store,
        Gmail(settings, auth),
        Calendly(settings, http),
        Brain(settings, http),
        Calendar(settings, auth),
    )

    async def worker():
        while True:
            try:
                await agent.run_cycle()
            except Exception as exc:
                # Não registrar o conteúdo de erros externos ou credenciais.
                logging.getLogger(__name__).warning("worker: %s", type(exc).__name__)
            await asyncio.sleep(settings.poll_seconds)

    @asynccontextmanager
    async def lifespan(app):
        with store.exclusive_runtime():
            store.recover()
            task = asyncio.create_task(worker()) if settings.run_worker else None
            try:
                yield
            finally:
                if task:
                    task.cancel()
                    with suppress(asyncio.CancelledError):
                        await task
                if client is None:
                    await http.aclose()

    app = FastAPI(title="Agente de e-mail e Calendly", version="0.1.0", lifespan=lifespan)
    app.state.agent = agent
    app.state.store = store

    async def admin(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
        if not settings.admin_api_token:
            raise HTTPException(503, "ADMIN_API_TOKEN não configurado")
        if credentials is None or not secrets.compare_digest(
            credentials.credentials.encode(),
            settings.admin_api_token.encode(),
        ):
            raise HTTPException(
                401, "Token administrativo inválido", headers={"WWW-Authenticate": "Bearer"}
            )

    protected = [Depends(admin)]

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "email-calendly-agent"}

    @app.get("/api/status", dependencies=protected)
    async def status():
        return {
            "mode": "live" if settings.auto_send else "draft",
            "worker_enabled": settings.run_worker,
            "missing_configuration": settings.missing(),
            "last_cycle": store.get("last_cycle") or None,
            "last_calendly_sync": store.get("calendly_last_sync") or None,
            "last_errors": json.loads(store.get("last_errors", "[]")),
            "outbox": store.rows("SELECT status,COUNT(*) AS count FROM outbox GROUP BY status"),
            "messages": store.rows("SELECT status,COUNT(*) AS count FROM messages GROUP BY status"),
            "notifications": store.rows(
                "SELECT status,COUNT(*) AS count FROM notifications GROUP BY status"
            ),
        }

    @app.post("/api/run", dependencies=protected)
    async def run():
        return await agent.run_cycle()

    @app.get("/api/messages", dependencies=protected)
    async def messages(limit: int = Query(50, ge=1, le=200)):
        return store.rows(
            "SELECT id,thread_id,sender,subject,body,received_at,status,reason,attempts FROM messages ORDER BY received_at DESC LIMIT ?",
            (limit,),
        )

    @app.get("/api/outbox", dependencies=protected)
    async def outbox(limit: int = Query(50, ge=1, le=200)):
        return store.rows("SELECT * FROM outbox ORDER BY created_at DESC LIMIT ?", (limit,))

    @app.get("/api/bookings", dependencies=protected)
    async def bookings(limit: int = Query(50, ge=1, le=200)):
        return store.rows("SELECT * FROM bookings ORDER BY starts_at DESC LIMIT ?", (limit,))

    @app.get("/api/contacts", dependencies=protected)
    async def contacts(limit: int = Query(50, ge=1, le=200)):
        return store.rows("SELECT * FROM contacts ORDER BY created_at DESC LIMIT ?", (limit,))

    @app.get("/api/audit", dependencies=protected)
    async def audit(limit: int = Query(50, ge=1, le=200)):
        return store.rows("SELECT * FROM audit ORDER BY id DESC LIMIT ?", (limit,))

    @app.post("/api/outbox/{message_id}/approve", dependencies=protected)
    async def approve(message_id: str):
        if not settings.auto_send:
            raise HTTPException(409, "Ative AUTO_SEND para liberar rascunhos para envio")
        if not store.execute(
            "UPDATE outbox SET status='pending',updated_at=? WHERE message_id=? AND status='draft'",
            (time.time(), message_id),
        ):
            raise HTTPException(409, "Rascunho não encontrado ou já processado")
        store.audit("draft_approved", message_id)
        return {"status": "pending"}

    @app.post("/api/messages/{message_id}/retry", dependencies=protected)
    async def retry_message(message_id: str):
        if not store.execute(
            """UPDATE messages SET status='queued',attempts=0,next_attempt_at=0,reason=''
            WHERE id=? AND status='human' AND NOT EXISTS
            (SELECT 1 FROM outbox WHERE message_id=messages.id)""",
            (message_id,),
        ):
            raise HTTPException(409, "A mensagem não está disponível para reavaliação")
        store.audit("message_retry", message_id)
        return {"status": "queued"}

    @app.post("/api/notifications/{notification_id}/retry", dependencies=protected)
    async def retry_notification(notification_id: str):
        if not store.execute(
            "UPDATE notifications SET status='pending',attempts=0,next_attempt_at=0 WHERE id=? AND status='failed'",
            (notification_id,),
        ):
            raise HTTPException(409, "Notificação não está em falha")
        store.audit("notification_retry", notification_id)
        return {"status": "pending"}

    @app.post("/api/availability", dependencies=protected)
    async def availability(query: AvailabilityQuery):
        if not settings.google_ready:
            raise HTTPException(503, "Google OAuth não configurado")
        from agent.providers import ProviderError

        try:
            return await agent.calendar.availability(query.start.isoformat(), query.end.isoformat())
        except ProviderError as exc:
            raise HTTPException(502, str(exc)) from exc

    @app.post("/webhooks/calendly", status_code=202)
    async def webhook(request: Request):
        if not settings.calendly_webhook_signing_key:
            raise HTTPException(503, "Chave de assinatura do Calendly não configurada")
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_WEBHOOK_BYTES:
                raise HTTPException(413, "Notificação excede o tamanho permitido")
        raw = bytes(body)
        if not valid_signature(
            raw,
            request.headers.get("Calendly-Webhook-Signature", ""),
            settings.calendly_webhook_signing_key,
        ):
            raise HTTPException(401, "Assinatura inválida ou expirada")
        try:
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError("Objeto esperado")
            if data.get("event") not in {"invitee.created", "invitee.canceled"}:
                return {"status": "ignored"}
            payload = data["payload"]
            calendly_uri(payload["uri"], invitee=True)
            calendly_uri(payload["event"])
            if not EMAIL_PATTERN.fullmatch(payload["email"]):
                raise ValueError("E-mail inválido")
            utc(payload["created_at"])
            canonical = json.dumps({"event": data["event"], "payload": payload}, sort_keys=True)
        except (KeyError, ValueError, TypeError) as exc:
            raise HTTPException(400, "Notificação inválida") from exc
        key = hashlib.sha256(canonical.encode()).hexdigest()
        added = store.add_notification(key, data)
        return {"status": "queued" if added else "duplicate", "id": key}

    return app
