from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

from cryptography.fernet import Fernet


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    encryption_key: str = field(repr=False)
    base_url: str = "http://127.0.0.1:8000"
    environment: str = "production"
    session_seconds: int = 43200
    idle_seconds: int = 1800
    ai_enabled: bool = False
    openai_api_key: str = field(default="", repr=False)
    openai_model: str = "gpt-4.1-mini"
    trust_dir: Path = Path("trust")
    trust_manifest: str = ""
    revocation_required: bool = True

    def __post_init__(self):
        Fernet(self.encryption_key.encode())
        parsed = urlparse(self.base_url)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.path not in {"", "/"}
        ):
            raise ValueError("APP_BASE_URL deve conter apenas a origem do aplicativo")
        if self.environment == "production" and parsed.scheme != "https":
            raise ValueError("Use HTTPS em produção")
        if self.environment not in {"production", "development", "demo", "test"}:
            raise ValueError("APP_ENV inválido")

    @property
    def secure_cookie(self) -> bool:
        return self.environment == "production" or self.base_url.startswith("https://")

    @classmethod
    def from_env(cls):
        key = os.getenv("APP_ENCRYPTION_KEY", "")
        if not key:
            raise RuntimeError("Inicialize a configuração com: python -m consulta.cli init")
        return cls(
            data_dir=Path(os.getenv("APP_DATA_DIR", "data")),
            encryption_key=key,
            base_url=os.getenv("APP_BASE_URL", "http://127.0.0.1:8000").rstrip("/"),
            environment=os.getenv("APP_ENV", "production"),
            session_seconds=int(os.getenv("SESSION_SECONDS", "43200")),
            idle_seconds=int(os.getenv("SESSION_IDLE_SECONDS", "1800")),
            ai_enabled=os.getenv("AI_ENABLED", "false").lower() == "true",
            openai_api_key=os.getenv("OPENAI_API_KEY", ""),
            openai_model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
            trust_dir=Path(os.getenv("ICP_TRUST_DIR", "trust")),
            trust_manifest=os.getenv("ICP_TRUST_MANIFEST", ""),
            revocation_required=os.getenv("SIGNATURE_REVOCATION_REQUIRED", "true").lower()
            == "true",
        )
