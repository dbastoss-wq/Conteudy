"""Autoriza uma caixa Google localmente e salva o refresh token apenas no .env."""

from __future__ import annotations

import base64
import hashlib
import secrets
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

import httpx
from dotenv import dotenv_values, set_key

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.readonly",
]


def main() -> None:
    env_path = Path(".env")
    values = dotenv_values(env_path)
    client_id, client_secret = values.get("GOOGLE_CLIENT_ID"), values.get("GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise SystemExit("Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env primeiro.")
    state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(64)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    )
    result: dict[str, str] = {}

    class Callback(BaseHTTPRequestHandler):
        def log_message(self, *args):
            # A URL de callback contém o código de autorização: não registrá-la.
            pass

        def do_GET(self):
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            received = query.get("state", [""])[0]
            valid = parsed.path == "/callback" and secrets.compare_digest(
                received.encode(), state.encode()
            )
            code = query.get("code", [""])[0]
            if not valid or not code:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Autorizacao invalida. Retorne ao terminal.")
                if valid:
                    result["error"] = "Autorização recusada pelo Google"
                return
            result["code"] = code
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write("Autorização recebida. Volte ao terminal para concluir.".encode())

    with HTTPServer(("127.0.0.1", 0), Callback) as server:
        server.timeout = 1
        redirect = f"http://127.0.0.1:{server.server_port}/callback"
        url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(
            {
                "client_id": client_id,
                "redirect_uri": redirect,
                "response_type": "code",
                "scope": " ".join(SCOPES),
                "state": state,
                "access_type": "offline",
                "prompt": "consent",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
        print("Autorize a caixa profissional no navegador deste computador:")
        print(url)
        webbrowser.open(url)
        deadline = time.monotonic() + 300
        while not result and time.monotonic() < deadline:
            server.handle_request()
    if not result.get("code"):
        raise SystemExit(result.get("error", "Tempo de autorização esgotado. Execute novamente."))
    try:
        response = httpx.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": result["code"],
                "redirect_uri": redirect,
                "grant_type": "authorization_code",
                "code_verifier": verifier,
            },
            timeout=30,
        )
        response.raise_for_status()
        token = response.json().get("refresh_token")
        if not token:
            raise SystemExit(
                "Google não retornou um refresh token. Revise o consentimento offline."
            )
    except (httpx.HTTPError, ValueError) as exc:
        raise SystemExit("Falha na troca do código OAuth. Verifique o aplicativo Google.") from exc
    env_path.chmod(0o600)
    set_key(str(env_path), "GOOGLE_REFRESH_TOKEN", token)
    print("GOOGLE_REFRESH_TOKEN salvo no .env. Nenhum token foi exibido.")


if __name__ == "__main__":
    main()
