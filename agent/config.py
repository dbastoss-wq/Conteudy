from __future__ import annotations

import os
import re
from dataclasses import dataclass, field, fields
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

EMAIL_PATTERN = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


def calendly_link(value: str | None) -> str | None:
    if not value:
        return None
    parsed = urlparse(value)
    if (
        parsed.scheme == "https"
        and parsed.netloc in {"calendly.com", "www.calendly.com"}
        and parsed.path.strip("/")
    ):
        return value
    return None


@dataclass(frozen=True)
class Settings:
    company_name: str = ""
    agent_name: str = "Assistente"
    agent_email: str = ""
    agent_timezone: str = "America/Sao_Paulo"
    knowledge_path: str = "knowledge/company.md"
    database_path: str = "data/agent.sqlite3"
    google_client_id: str = field(default="", repr=False)
    google_client_secret: str = field(default="", repr=False)
    google_refresh_token: str = field(default="", repr=False)
    google_calendar_id: str = "primary"
    calendly_scheduling_url: str = ""
    calendly_api_token: str = field(default="", repr=False)
    calendly_webhook_signing_key: str = field(default="", repr=False)
    calendly_sync_seconds: int = 900
    calendly_lookback_days: int = 30
    calendly_ahead_days: int = 365
    initial_lookback_days: int = 7
    openai_api_key: str = field(default="", repr=False)
    openai_model: str = "gpt-4.1-mini"
    admin_api_token: str = field(default="", repr=False)
    auto_send: bool = False
    run_worker: bool = True
    poll_seconds: int = 60

    def __post_init__(self) -> None:
        ZoneInfo(self.agent_timezone)
        if self.agent_email and not EMAIL_PATTERN.fullmatch(self.agent_email):
            raise ValueError("AGENT_EMAIL inválido")
        if self.calendly_scheduling_url and not calendly_link(self.calendly_scheduling_url):
            raise ValueError("CALENDLY_SCHEDULING_URL deve ser um link HTTPS do calendly.com")
        if self.admin_api_token and len(self.admin_api_token) < 32:
            raise ValueError("ADMIN_API_TOKEN deve ter pelo menos 32 caracteres")
        for name in ("poll_seconds", "calendly_sync_seconds", "calendly_ahead_days"):
            if getattr(self, name) < 1:
                raise ValueError(f"{name} deve ser positivo")
        if self.initial_lookback_days < 0 or self.calendly_lookback_days < 0:
            raise ValueError("Os períodos de consulta não podem ser negativos")

    @classmethod
    def from_env(cls) -> Settings:
        values = {}
        defaults = cls()
        for item in fields(cls):
            raw = os.getenv(item.name.upper())
            if raw is None:
                continue
            default = getattr(defaults, item.name)
            if isinstance(default, bool):
                if raw.lower() not in {"true", "false"}:
                    raise ValueError(f"{item.name.upper()} deve ser true ou false")
                values[item.name] = raw.lower() == "true"
            elif isinstance(default, int):
                values[item.name] = int(raw)
            else:
                values[item.name] = raw.strip()
        return cls(**values)

    @property
    def google_ready(self) -> bool:
        return bool(
            self.google_client_id and self.google_client_secret and self.google_refresh_token
        )

    def missing(self) -> dict[str, list[str]]:
        groups = {
            "email": [
                "agent_email",
                "google_client_id",
                "google_client_secret",
                "google_refresh_token",
                "openai_api_key",
            ],
            "calendly": ["calendly_api_token", "calendly_scheduling_url"],
            "webhook": ["calendly_webhook_signing_key"],
            "admin": ["admin_api_token"],
        }
        return {
            group: [name.upper() for name in names if not getattr(self, name)]
            for group, names in groups.items()
        }

    def knowledge(self) -> str:
        path = Path(self.knowledge_path)
        if not path.is_file():
            return ""
        text = path.read_text(encoding="utf-8")
        return re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL).strip()[:20_000]
