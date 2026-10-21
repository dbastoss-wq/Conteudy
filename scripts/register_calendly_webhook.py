"""Registra o webhook no Calendly, com chave de assinatura definida no .env."""

import argparse
from pathlib import Path
from urllib.parse import urlparse

import httpx
from dotenv import dotenv_values


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="https://seu-host/webhooks/calendly")
    args = parser.parse_args()
    parsed = urlparse(args.url)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path != "/webhooks/calendly"
    ):
        raise SystemExit("Informe uma URL HTTPS completa terminada em /webhooks/calendly.")
    values = dotenv_values(Path(".env"))
    token, key = values.get("CALENDLY_API_TOKEN"), values.get("CALENDLY_WEBHOOK_SIGNING_KEY")
    if not token or not key:
        raise SystemExit("Configure CALENDLY_API_TOKEN e CALENDLY_WEBHOOK_SIGNING_KEY no .env.")
    try:
        with httpx.Client(headers={"Authorization": f"Bearer {token}"}, timeout=30) as client:
            profile = client.get("https://api.calendly.com/users/me")
            profile.raise_for_status()
            user = profile.json()["resource"]
            query = {
                "organization": user["current_organization"],
                "user": user["uri"],
                "scope": "user",
            }
            page = None
            while True:
                existing = client.get(
                    "https://api.calendly.com/webhook_subscriptions",
                    params={
                        **query,
                        "count": 100,
                        **({"page_token": page} if page else {}),
                    },
                )
                existing.raise_for_status()
                data = existing.json()
                if any(item.get("callback_url") == args.url for item in data.get("collection", [])):
                    raise SystemExit(
                        "Já existe uma assinatura para esta URL. Verifique sua chave e eventos "
                        "no Calendly antes de substituir a configuração."
                    )
                page = data.get("pagination", {}).get("next_page_token")
                if not page:
                    break
            response = client.post(
                "https://api.calendly.com/webhook_subscriptions",
                json={
                    **query,
                    "url": args.url,
                    "events": ["invitee.created", "invitee.canceled"],
                    "signing_key": key,
                },
            )
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise SystemExit(
            f"Calendly retornou HTTP {exc.response.status_code}. Confira token, permissões e plano. "
            "A consulta periódica pode ser usada quando a conta permitir leitura pela API."
        ) from exc
    except (httpx.TransportError, KeyError, ValueError) as exc:
        raise SystemExit("Não foi possível configurar o webhook do Calendly.") from exc
    print("Webhook registrado. Mantenha a mesma chave de assinatura no servidor do agente.")


if __name__ == "__main__":
    main()
