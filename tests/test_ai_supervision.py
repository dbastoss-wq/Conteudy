from dataclasses import replace

import httpx
from fastapi.testclient import TestClient

from consulta.api import create_app
from consulta.models import Draft
from tests.conftest import create_encounter, submit_intake


def configured_client(system):
    settings = replace(system.settings, ai_enabled=True, openai_api_key="chave-ficticia-de-teste")
    client = TestClient(create_app(settings), base_url=settings.base_url)
    client.cookies.update(system.client.cookies)
    client.headers["X-CSRF-Token"] = system.client.headers["X-CSRF-Token"]
    return client


def test_ai_provider_failure_does_not_change_or_block_medical_record(system, monkeypatch):
    encounter_id = create_encounter(system)
    draft = Draft().model_dump()
    draft["note"]["hpma"] = "Não teve febre. Texto médico que precisa permanecer literal."
    system.client.put(f"/api/encounters/{encounter_id}/draft", json={"revision": 0, "draft": draft})

    class FailingProvider:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            raise httpx.ConnectError("Falha fictícia de rede do provedor")

        async def __aexit__(self, *args):
            return False

    monkeypatch.setattr(httpx, "AsyncClient", FailingProvider)
    with configured_client(system) as client:
        assert client.post(f"/api/encounters/{encounter_id}/ai", json={}).status_code == 422
        response = client.post(
            f"/api/encounters/{encounter_id}/ai", json={"allow_external_processing": True}
        )
        assert response.status_code == 502
        record = client.get(f"/api/encounters/{encounter_id}").json()
        assert record["draft"] == draft and record["revision"] == 1
        draft["note"]["plan"] = "Plano escrito manualmente após falha de IA."
        assert (
            client.put(
                f"/api/encounters/{encounter_id}/draft", json={"revision": 1, "draft": draft}
            ).status_code
            == 200
        )


def test_ai_only_receives_minimized_fields_and_never_applies_its_proposal(system, monkeypatch):
    name = 'Pessoa fictícia "Teste de privacidade"'
    encounter_id = create_encounter(system, name)
    submit_intake(system, encounter_id)
    before = system.client.get(f"/api/encounters/{encounter_id}").json()
    intake = before["intake"]
    intake["original_report"] += " " + name
    system.store.execute(
        "UPDATE encounters SET intake=? WHERE id=?", (system.store.encode(intake), encounter_id)
    )
    captured = []

    class TestProvider:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, **kwargs):
            captured.append(kwargs["json"]["messages"][-1]["content"])
            return httpx.Response(
                200,
                request=httpx.Request("POST", url),
                json={
                    "choices": [
                        {
                            "message": {
                                "content": '{"hpma":"Sugestão fictícia: não teve febre.","questions":[],"contradictions":[],"evidence":[]}'
                            }
                        }
                    ]
                },
            )

    monkeypatch.setattr(httpx, "AsyncClient", TestProvider)
    with configured_client(system) as client:
        response = client.post(
            f"/api/encounters/{encounter_id}/ai", json={"allow_external_processing": True}
        )
        assert response.status_code == 200
        assert response.json()["applied"] is False
        assert response.json()["requires_medical_review"] is True
        assert captured and name not in captured[0]
        assert "Não tive febre." in captured[0] and "guardian_contact" not in captured[0]
        after = client.get(f"/api/encounters/{encounter_id}").json()
        assert after["draft"] == before["draft"] and after["revision"] == before["revision"]
