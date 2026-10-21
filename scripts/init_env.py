"""Cria a configuração local sem mostrar os segredos gerados."""

import secrets
from pathlib import Path

from dotenv import dotenv_values, set_key

path = Path(".env")
if not path.exists():
    path.write_text(Path(".env.example").read_text(encoding="utf-8"), encoding="utf-8")
path.chmod(0o600)
values = dotenv_values(path)
for name in ("ADMIN_API_TOKEN", "CALENDLY_WEBHOOK_SIGNING_KEY"):
    if not values.get(name):
        set_key(str(path), name, secrets.token_urlsafe(48))
print("Configuração .env preparada. Edite os dados da empresa e das integrações.")
