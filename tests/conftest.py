from __future__ import annotations

from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from consulta.api import create_app
from consulta.config import Settings
from consulta.models import Draft, Intake, Patient, Profile

PASSWORD = "senha-ficticia-apenas-para-testes"


@pytest.fixture
def system(tmp_path):
    settings = Settings(
        data_dir=tmp_path / "data",
        encryption_key=Fernet.generate_key().decode(),
        base_url="http://testserver",
        environment="test",
    )
    app = create_app(settings)
    store, security = app.state.store, app.state.security
    user_id = security.create_doctor("medico-teste", PASSWORD)
    client = TestClient(app, base_url=settings.base_url)
    login = client.post("/api/login", json={"username": "medico-teste", "password": PASSWORD})
    assert login.status_code == 200
    client.headers["X-CSRF-Token"] = login.json()["csrf"]
    profile = Profile().model_dump()
    profile.update(
        name="Profissional fictício para testes",
        cpf="11144477735",
        professional_address="Endereço fictício de testes, sem uso assistencial",
        professional_contact="Contato fictício de testes",
        privacy_notice="Aviso fictício exclusivo para testes de ciência de privacidade.",
    )
    assert client.put("/api/profile", json=profile).status_code == 200
    yield SimpleNamespace(
        settings=settings,
        app=app,
        store=store,
        security=security,
        client=client,
        user_id=user_id,
        profile=profile,
    )
    client.close()


def create_encounter(system, name="Pessoa fictícia de teste"):
    patient = Patient(
        name=name,
        birth_date="1990-01-01",
        contact="Contato fictício",
        identification="Documento fictício",
        address="Endereço fictício",
    ).model_dump(mode="json")
    response = system.client.post("/api/encounters", json={"patient": patient})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def patient_client(system, encounter_id):
    invitation = system.client.post(f"/api/encounters/{encounter_id}/invitations")
    assert invitation.status_code == 200, invitation.text
    invitation = invitation.json()
    token = parse_qs(urlparse(invitation["url"]).fragment)["token"][0]
    client = TestClient(system.app, base_url=system.settings.base_url)
    response = client.post("/api/invitations/exchange", json={"token": token})
    assert response.status_code == 200, response.text
    client.headers["X-CSRF-Token"] = response.json()["csrf"]
    return client, invitation, token


def submit_intake(system, encounter_id, patient=None):
    patient = patient or patient_client(system, encounter_id)[0]
    portal = patient.get("/api/patient").json()
    intake = Intake(
        chief_complaint="Relato fictício: não apresenta o sintoma citado.",
        original_report="Não tive febre. Não sei informar a duração.",
        explicit_negatives="Não tive febre.",
        allergies={"status": "does_not_know"},
        privacy_acknowledged=True,
    ).model_dump()
    response = patient.put(
        "/api/patient/intake",
        json={
            "revision": portal["revision"],
            "patient": portal["patient"],
            "intake": intake,
            "submit": True,
        },
    )
    assert response.status_code == 200, response.text
    return patient


def complete_encounter(system, encounter_id):
    submit_intake(system, encounter_id)
    draft = Draft().model_dump(mode="json")
    draft["note"].update(
        hpma="Relato fictício preservado. Não teve febre.",
        assessment="Avaliação fictícia registrada pelo médico.",
        plan="Plano fictício registrado pelo médico.",
    )
    draft["tele"].update(
        identity_confirmed=True,
        identity_method="Conferência fictícia em teste",
        current_location="Local fictício",
        reconnection_contact="Contato fictício",
        modality="video",
        platform="Plataforma fictícia",
        consent_confirmed=True,
        consent_details="Consentimento fictício documentado no teste",
        connection_quality="boa",
    )
    response = system.client.put(
        f"/api/encounters/{encounter_id}/draft", json={"revision": 0, "draft": draft}
    )
    assert response.status_code == 200, response.text
    revision = response.json()["revision"]
    for action in ("start", "end"):
        result = system.client.post(
            f"/api/encounters/{encounter_id}/tele/{action}", json={"revision": revision}
        )
        assert result.status_code == 200, result.text
        revision = result.json()["revision"]
    result = system.client.post(
        f"/api/encounters/{encounter_id}/finalize",
        json={"revision": revision, "medical_review_confirmed": True},
    )
    assert result.status_code == 200, result.text
    return result.json()["revision"]


def medication():
    return {
        "ingredient": "Substância fictícia de teste",
        "strength": "2,5",
        "strength_unit": "mg/mL",
        "presentation": "Apresentação fictícia",
        "dose": "1,5",
        "dose_unit": "mL",
        "route": "Via explicitamente definida no teste",
        "frequency": "Intervalo fictício explícito",
        "duration": "Duração fictícia explícita",
        "quantity": "1",
        "dispensing_unit": "unidade fictícia",
        "category": "common",
    }


def make_document(system, encounter_id, kind="guidance"):
    revision = system.client.get(f"/api/encounters/{encounter_id}").json()["revision"]
    response = system.client.post(
        f"/api/encounters/{encounter_id}/documents",
        json={
            "kind": kind,
            "content": "Orientações fictícias revisadas pelo médico.",
            "encounter_revision": revision,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def prepare_document(system, document_id):
    for revision, target in ((0, "review"), (1, "ready")):
        response = system.client.post(
            f"/api/documents/{document_id}/transition",
            json={"revision": revision, "target": target, "medical_review_confirmed": True},
        )
        assert response.status_code == 200, response.text
    return system.client.get(f"/api/documents/{document_id}").json()
