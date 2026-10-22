from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from dataclasses import dataclass
from urllib.parse import urlparse
from uuid import uuid4

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import HTTPException, Request, Response

from consulta.config import Settings
from consulta.models import Profile
from consulta.store import Store

PASSWORDS = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
DUMMY = PASSWORDS.hash(secrets.token_urlsafe(32))
COOKIE = "consulta_session"


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


@dataclass(frozen=True)
class Principal:
    role: str
    user_id: str | None
    encounter_id: str | None
    session_hash: str
    csrf: str

    @property
    def actor(self):
        return self.user_id or "patient:" + (self.encounter_id or "")


class Security:
    def __init__(self, store: Store, settings: Settings):
        self.store, self.settings = store, settings

    def csrf(self, token):
        return hmac.new(
            self.settings.encryption_key.encode(), token.encode(), hashlib.sha256
        ).hexdigest()

    def issue(self, response: Response, role, user_id=None, encounter_id=None, invitation_id=None):
        token = secrets.token_urlsafe(48)
        duration = (
            self.settings.session_seconds
            if role == "doctor"
            else min(7200, self.settings.session_seconds)
        )
        self.store.execute(
            "INSERT INTO sessions VALUES (?,?,?,?,?,?,?)",
            (
                digest(token),
                user_id,
                role,
                encounter_id,
                invitation_id,
                time.time() + duration,
                time.time(),
            ),
        )
        response.set_cookie(
            COOKIE,
            token,
            httponly=True,
            secure=self.settings.secure_cookie,
            samesite="lax",
            max_age=duration,
            path="/",
        )
        return self.csrf(token)

    def principal(self, request: Request) -> Principal:
        token = request.cookies.get(COOKIE, "")
        session = self.store.one("SELECT * FROM sessions WHERE token_hash=?", (digest(token),))
        if (
            not session
            or session["expires_at"] < time.time()
            or session["last_seen"] + self.settings.idle_seconds < time.time()
        ):
            raise HTTPException(401, "Sessão encerrada. Entre novamente.")
        if session["role"] == "doctor":
            user = self.store.one("SELECT disabled FROM users WHERE id=?", (session["user_id"],))
            if not user or user["disabled"]:
                raise HTTPException(401, "Sessão indisponível")
        else:
            invitation = self.store.one(
                "SELECT * FROM invitations WHERE id=?", (session["invitation_id"],)
            )
            if not invitation or invitation["revoked_at"] or invitation["expires_at"] < time.time():
                raise HTTPException(401, "Convite expirado ou revogado")
        self.store.execute(
            "UPDATE sessions SET last_seen=? WHERE token_hash=?", (time.time(), digest(token))
        )
        principal = Principal(
            session["role"],
            session["user_id"],
            session["encounter_id"],
            digest(token),
            self.csrf(token),
        )
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            self.check_origin(request)
            if not secrets.compare_digest(request.headers.get("X-CSRF-Token", ""), principal.csrf):
                raise HTTPException(
                    403, "A sessão não confirmou esta alteração. Recarregue a página."
                )
        return principal

    def doctor(self, request: Request):
        principal = self.principal(request)
        if principal.role != "doctor":
            raise HTTPException(403, "Área exclusiva do médico")
        return principal

    def check_origin(self, request):
        origin = request.headers.get("Origin")
        if origin and origin.rstrip("/") != self.settings.base_url.rstrip("/"):
            raise HTTPException(403, "Origem não autorizada")

    def login(self, request, response, username, password):
        self.check_origin(request)
        ip = request.client.host if request.client else "unknown"
        key = hmac.new(
            self.settings.encryption_key.encode(), ip.encode(), hashlib.sha256
        ).hexdigest()
        limit = self.store.one("SELECT * FROM login_limits WHERE key=?", (key,))
        if limit and limit["first_attempt"] > time.time() - 900 and limit["attempts"] >= 5:
            raise HTTPException(429, "Muitas tentativas. Aguarde 15 minutos.")
        user = self.store.one("SELECT * FROM users WHERE username=?", (username.strip().lower(),))
        valid = False
        try:
            valid = PASSWORDS.verify(user["password_hash"] if user else DUMMY, password)
        except VerificationError:
            pass
        if not user or user["disabled"] or not valid:
            first = (
                limit["first_attempt"]
                if limit and limit["first_attempt"] > time.time() - 900
                else time.time()
            )
            attempts = limit["attempts"] + 1 if limit and first == limit["first_attempt"] else 1
            self.store.execute(
                "INSERT OR REPLACE INTO login_limits VALUES (?,?,?)", (key, attempts, first)
            )
            raise HTTPException(401, "Usuário ou senha inválidos")
        self.store.execute("DELETE FROM login_limits WHERE key=?", (key,))
        old = request.cookies.get(COOKIE)
        if old:
            self.store.execute("DELETE FROM sessions WHERE token_hash=?", (digest(old),))
        csrf = self.issue(response, "doctor", user_id=user["id"])
        self.store.audit(user["id"], "login")
        return {"csrf": csrf, "role": "doctor"}

    def create_doctor(self, username, password):
        if len(password) < 14:
            raise ValueError("Use senha de pelo menos 14 caracteres")
        user_id = str(uuid4())
        self.store.execute(
            "INSERT INTO users(id,username,password_hash,profile) VALUES (?,?,?,?)",
            (
                user_id,
                username.strip().lower(),
                PASSWORDS.hash(password),
                self.store.encode(Profile().model_dump()),
            ),
        )
        self.store.audit(user_id, "doctor_created")
        return user_id


def valid_call_url(value: str) -> str:
    if not value:
        return ""
    parsed = urlparse(value)
    hosts = {
        "meet.google.com",
        "teams.microsoft.com",
        "teams.live.com",
        "zoom.us",
        "whereby.com",
        "doxy.me",
    }
    if (
        parsed.scheme != "https"
        or parsed.username
        or parsed.password
        or parsed.port not in {None, 443}
        or not any(
            parsed.hostname == host
            or (host == "zoom.us" and (parsed.hostname or "").endswith(".zoom.us"))
            for host in hosts
        )
    ):
        raise ValueError("Use um link HTTPS de Google Meet, Teams, Zoom, Whereby ou Doxy.me")
    return value
