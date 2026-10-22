import io
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

from consulta.models import Draft, Intake
from tests.conftest import (
    PASSWORD,
    complete_encounter,
    create_encounter,
    make_document,
    patient_client,
    submit_intake,
)


def test_production_starts_without_patients_or_clinical_examples(system):
    assert system.client.get("/api/encounters").json() == []
    assert system.store.rows("SELECT * FROM patients") == []
    assert system.client.post("/api/demo").status_code == 404


def test_anonymous_cannot_read_or_write_records(system):
    encounter_id = create_encounter(system)
    with TestClient(system.app) as anonymous:
        for path in [
            "/api/encounters",
            f"/api/encounters/{encounter_id}",
            "/api/patient",
            "/api/profile",
            "/api/audit",
        ]:
            assert anonymous.get(path).status_code == 401
        assert (
            anonymous.put(
                f"/api/encounters/{encounter_id}/draft", json={"revision": 0, "draft": {}}
            ).status_code
            == 401
        )


def test_patient_has_server_side_isolation_from_other_patient_and_medical_notes(system):
    first, second = create_encounter(system), create_encounter(system, "Outra pessoa fictícia")
    draft = Draft().model_dump()
    draft["note"]["assessment"] = "HIPOTESE_INTERNA_NAO_VISIVEL"
    system.client.put(f"/api/encounters/{first}/draft", json={"revision": 0, "draft": draft})
    patient, _, _ = patient_client(system, first)
    portal = patient.get("/api/patient")
    assert "HIPOTESE_INTERNA" not in portal.text
    assert "draft" not in portal.json() and "note" not in portal.json()
    assert patient.get(f"/api/encounters/{first}").status_code == 403
    assert patient.get(f"/api/encounters/{second}").status_code == 403
    assert patient.get("/api/encounters").status_code == 403
    assert patient.post(f"/api/encounters/{first}/finalize", json={}).status_code == 403
    second_doc = make_document(system, second)
    assert patient.get(f"/api/documents/{second_doc}").status_code == 404
    first_doc = make_document(system, first)
    assert patient.get(f"/api/documents/{first_doc}/pdf").status_code == 404


def test_another_physician_cannot_open_patient_or_document(system):
    encounter_id = create_encounter(system)
    document_id = make_document(system, encounter_id)
    system.security.create_doctor("outro-medico", PASSWORD)
    with TestClient(system.app) as other:
        login = other.post("/api/login", json={"username": "outro-medico", "password": PASSWORD})
        other.headers["X-CSRF-Token"] = login.json()["csrf"]
        assert other.get("/api/encounters").json() == []
        assert other.get(f"/api/encounters/{encounter_id}").status_code == 404
        assert other.get(f"/api/documents/{document_id}/pdf").status_code == 404


def test_patient_invitation_is_one_use_and_revocation_ends_existing_session(system):
    encounter_id = create_encounter(system)
    patient, invitation, token = patient_client(system, encounter_id)
    with TestClient(system.app) as another:
        assert another.post("/api/invitations/exchange", json={"token": token}).status_code == 410
    assert patient.get("/api/patient").status_code == 200
    assert system.client.delete("/api/invitations/" + invitation["id"]).status_code == 200
    assert patient.get("/api/patient").status_code == 401


def test_expired_invitation_is_rejected(system):
    encounter_id = create_encounter(system)
    response = system.client.post(f"/api/encounters/{encounter_id}/invitations").json()
    token = response["url"].split("token=")[1]
    system.store.execute("UPDATE invitations SET expires_at=0 WHERE id=?", (response["id"],))
    with TestClient(system.app) as patient:
        assert patient.post("/api/invitations/exchange", json={"token": token}).status_code == 410


def test_csrf_and_cross_origin_mutations_are_rejected(system):
    body = {"patient": {"name": "Pessoa fictícia"}}
    assert (
        system.client.post("/api/encounters", json=body, headers={"X-CSRF-Token": ""}).status_code
        == 403
    )
    assert (
        system.client.post(
            "/api/encounters", json=body, headers={"Origin": "https://outro.example"}
        ).status_code
        == 403
    )


def test_saved_draft_survives_new_app_and_session_reload(system):
    encounter_id = create_encounter(system)
    draft = Draft().model_dump()
    draft["note"]["hpma"] = "Texto original médico: não nega; não soube informar."
    response = system.client.put(
        f"/api/encounters/{encounter_id}/draft", json={"revision": 0, "draft": draft}
    )
    assert response.status_code == 200
    from consulta.api import create_app

    restarted = create_app(system.settings)
    with TestClient(restarted) as client:
        client.cookies.update(system.client.cookies)
        result = client.get(f"/api/encounters/{encounter_id}").json()
        assert result["draft"]["note"]["hpma"] == draft["note"]["hpma"]
        assert result["revision"] == 1


def test_concurrent_revision_does_not_silently_overwrite(system):
    encounter_id = create_encounter(system)
    first, stale = Draft().model_dump(), Draft().model_dump()
    first["note"]["hpma"], stale["note"]["hpma"] = "Texto da aba A", "Texto da aba B"
    assert (
        system.client.put(
            f"/api/encounters/{encounter_id}/draft", json={"revision": 0, "draft": first}
        ).status_code
        == 200
    )
    assert (
        system.client.put(
            f"/api/encounters/{encounter_id}/draft", json={"revision": 0, "draft": stale}
        ).status_code
        == 409
    )
    assert (
        system.client.get(f"/api/encounters/{encounter_id}").json()["draft"]["note"]["hpma"]
        == "Texto da aba A"
    )


def test_organizing_preserves_negative_and_never_replaces_doctor_writing(system):
    encounter_id = create_encounter(system)
    submit_intake(system, encounter_id)
    draft = Draft().model_dump()
    draft["note"]["hpma"] = "Redação médica que deve ser preservada."
    draft["note"]["assessment"] = "Avaliação exclusivamente médica."
    system.client.put(f"/api/encounters/{encounter_id}/draft", json={"revision": 0, "draft": draft})
    proposal = system.client.post(f"/api/encounters/{encounter_id}/organize").json()
    assert "Não tive febre." in proposal["proposal"]["hpma"]
    assert proposal["proposal"]["allergies"] == "Não sabe"
    assert proposal["proposal"]["exam"] == ""
    assert "normal" not in proposal["proposal"]["hpma"].lower()
    assert proposal["applied"] is False
    original = system.client.get(f"/api/encounters/{encounter_id}").json()
    assert original["draft"]["note"]["hpma"] == draft["note"]["hpma"]
    assert original["draft"]["note"]["assessment"] == draft["note"]["assessment"]


@pytest.mark.parametrize(
    "status,label",
    [
        ("not_informed", "Não informado"),
        ("does_not_know", "Não sabe"),
        ("denies", "Nega"),
        ("not_applicable", "Não se aplica"),
    ],
)
def test_distinct_absence_states_are_not_conflated(status, label):
    from consulta.clinical import answer_text
    from consulta.models import Answer

    assert answer_text(Answer(status=status)) == label


def test_minor_requires_guardian_at_submission(system):
    encounter_id = create_encounter(system)
    patient, _, _ = patient_client(system, encounter_id)
    portal = patient.get("/api/patient").json()
    portal["patient"]["birth_date"] = (date.today() - timedelta(days=3650)).isoformat()
    intake = Intake(chief_complaint="Relato fictício", privacy_acknowledged=True).model_dump()
    response = patient.put(
        "/api/patient/intake",
        json={"revision": 0, "patient": portal["patient"], "intake": intake, "submit": True},
    )
    assert response.status_code == 422 and "responsável" in response.text


def test_finalized_note_is_immutable_and_addendum_preserves_original(system):
    encounter_id = create_encounter(system)
    revision = complete_encounter(system, encounter_id)
    row = system.client.get(f"/api/encounters/{encounter_id}").json()
    old = row["draft"]["note"]["assessment"]
    row["draft"]["note"]["assessment"] = "Tentativa de substituir registro final."
    assert (
        system.client.put(
            f"/api/encounters/{encounter_id}/draft",
            json={"revision": revision, "draft": row["draft"]},
        ).status_code
        == 409
    )
    assert (
        system.client.post(
            f"/api/encounters/{encounter_id}/addenda",
            json={"text": "Complementação médica fictícia."},
        ).status_code
        == 201
    )
    after = system.client.get(f"/api/encounters/{encounter_id}").json()
    assert after["draft"]["note"]["assessment"] == old and len(after["addenda"]) == 1


def test_follow_up_starts_empty_and_keeps_previous_encounter(system):
    encounter_id = create_encounter(system)
    complete_encounter(system, encounter_id)
    old = system.client.get(f"/api/encounters/{encounter_id}").json()
    result = system.client.post(f"/api/patients/{old['patient_id']}/encounters")
    new = system.client.get("/api/encounters/" + result.json()["id"]).json()
    assert new["draft"]["note"]["hpma"] == "" and new["intake"]["chief_complaint"] == ""
    assert len(new["history"]) == 2


def test_clinical_payload_and_private_file_are_encrypted_at_rest(system):
    encounter_id = create_encounter(system, "MARCADOR_CLINICO_NUNCA_EM_TEXTO_PURO")
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer)
    pdf.setTitle("MARCADOR_ANEXO_PRIVADO")
    pdf.drawString(20, 20, "Anexo ficticio de teste")
    pdf.save()
    unique = buffer.getvalue()
    response = system.client.post(
        f"/api/encounters/{encounter_id}/attachments",
        content=unique,
        headers={"Content-Type": "application/pdf", "X-File-Name": "exame.pdf"},
    )
    assert response.status_code == 201
    file_id = response.json()["id"]
    with system.store.connect() as conn:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    assert b"MARCADOR_CLINICO" not in system.store.path.read_bytes()
    assert b"MARCADOR_ANEXO" not in (system.store.files_dir / file_id).read_bytes()
    assert system.client.get("/api/files/" + file_id).content == unique


@pytest.mark.parametrize(
    "content,mime",
    [
        (b"%PDF-1.7\nPDF truncado", "application/pdf"),
        (b"\x89PNG\r\n\x1a\nimagem truncada", "image/png"),
        (b"<html>conteudo ativo</html>", "image/jpeg"),
    ],
)
def test_invalid_upload_is_rejected_without_creating_file(system, content, mime):
    encounter_id = create_encounter(system)
    response = system.client.post(
        f"/api/encounters/{encounter_id}/attachments",
        content=content,
        headers={"Content-Type": mime},
    )
    assert response.status_code == 415
    assert system.store.rows("SELECT * FROM files") == []


def test_anonymized_export_preserves_json_with_quoted_identifiers(system):
    name = 'Pessoa fictícia "Nome com aspas"'
    encounter_id = create_encounter(system, name)
    draft = Draft().model_dump()
    draft["note"]["hpma"] = f"Relato de {name}. Nega febre. Contato: pessoa@exemplo.invalid."
    system.client.put(f"/api/encounters/{encounter_id}/draft", json={"revision": 0, "draft": draft})
    response = system.client.get(f"/api/encounters/{encounter_id}/anonymized")
    assert response.status_code == 200
    result = response.json()
    assert result["review_required"]
    assert name not in result["content"]["draft"]["note"]["hpma"]
    assert "Nega febre." in result["content"]["draft"]["note"]["hpma"]
    assert "pessoa@exemplo.invalid" not in response.text


def test_audit_contains_no_clinical_text(system):
    encounter_id = create_encounter(system, "IDENTIDADE_NAO_DEVE_APARECER_NA_AUDITORIA")
    draft = Draft().model_dump()
    draft["note"]["hpma"] = "RELATO_PRIVADO_NAO_DEVE_APARECER_NA_AUDITORIA"
    system.client.put(f"/api/encounters/{encounter_id}/draft", json={"revision": 0, "draft": draft})
    audit = system.client.get("/api/audit").text
    assert "IDENTIDADE_NAO" not in audit and "RELATO_PRIVADO" not in audit


def test_manual_mode_still_works_when_ai_is_unconfigured(system):
    encounter_id = create_encounter(system)
    assert (
        system.client.post(
            f"/api/encounters/{encounter_id}/ai", json={"allow_external_processing": True}
        ).status_code
        == 503
    )
    draft = Draft().model_dump()
    draft["note"]["hpma"] = "Atendimento manual preservado."
    assert (
        system.client.put(
            f"/api/encounters/{encounter_id}/draft", json={"revision": 0, "draft": draft}
        ).status_code
        == 200
    )


def test_call_link_is_validated_on_server_and_never_embedded(system):
    encounter_id = create_encounter(system)
    draft = Draft().model_dump()
    draft["tele"]["call_url"] = "https://evil.example/call"
    assert (
        system.client.put(
            f"/api/encounters/{encounter_id}/draft", json={"revision": 0, "draft": draft}
        ).status_code
        == 200
    )
    assert system.client.get(f"/api/encounters/{encounter_id}/call").status_code == 422
    draft["tele"]["call_url"] = "https://meet.google.com/abc-defg-hij"
    system.client.put(f"/api/encounters/{encounter_id}/draft", json={"revision": 1, "draft": draft})
    assert (
        system.client.get(f"/api/encounters/{encounter_id}/call").json()["embedded_video"] is False
    )
