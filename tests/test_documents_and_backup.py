import io
import zipfile

import pytest
from pydantic import ValidationError
from pypdf import PdfReader

from consulta.backup import create_backup, restore_backup
from consulta.models import Medication
from consulta.pdfs import render_pdf
from consulta.signatures import verify_signed
from tests.conftest import (
    complete_encounter,
    create_encounter,
    make_document,
    medication,
    patient_client,
    prepare_document,
)


def test_long_pdf_is_a4_paginated_and_does_not_cut_last_dosage(system):
    items = []
    for index in range(50):
        item = Medication(**medication()).model_dump()
        item["ingredient"] = f"SUBSTANCIA FICTICIA {index + 1}"
        item["instructions"] = (
            "Orientação fictícia longa para teste de paginação. " * 25
        ) + f" FIM_ITEM_{index + 1}"
        items.append(item)
    payload = {
        "doctor": system.profile,
        "patient": {"name": "PESSOA FICTICIA", "birth_date": "1990-01-01"},
        "kind": "prescription",
        "medications": items,
        "content": "",
        "prescription_text": "",
        "created_at": 1792620000,
    }
    data = render_pdf(payload, draft=True, document_id="id-exclusivo-teste")
    reader = PdfReader(io.BytesIO(data))
    assert len(reader.pages) > 5
    text = "\n".join(page.extract_text() for page in reader.pages)
    assert "FIM_ITEM_50" in text
    assert "2,5 mg/mL" in text and "1,5 mL" in text
    assert "CID" not in text
    assert all("RASCUNHO" in page.extract_text() for page in reader.pages)
    assert all(abs(float(page.mediabox.width) - 595.2756) < 1 for page in reader.pages)
    assert all(abs(float(page.mediabox.height) - 841.8898) < 1 for page in reader.pages)


def test_decimal_comma_is_preserved_without_implicit_dose_calculation():
    item = Medication(**medication())
    assert item.strength == "2,5" and item.dose == "1,5"
    assert item.quantity == "1"
    for value in ("1.000,5", "1,000.5", "0", "-1", "2 mg", "NaN"):
        with pytest.raises(ValidationError):
            Medication(**{**medication(), "dose": value})


def test_evolution_pdf_preserves_medical_text_and_actual_teleconsultation(system):
    encounter_id = create_encounter(system)
    complete_encounter(system, encounter_id)
    document_id = make_document(system, encounter_id, "evolution")
    response = system.client.get(f"/api/documents/{document_id}/pdf")
    text = "\n".join(page.extract_text() for page in PdfReader(io.BytesIO(response.content)).pages)
    assert "Não teve febre." in text and "Avaliação fictícia" in text
    assert "Conferência fictícia em teste" in text and "Local fictício" in text
    assert "Achados efetivamente observados ao vídeo: Não informado" in text
    assert "RASCUNHO" in text and "America/Sao_Paulo" in text


def test_final_document_needs_explicit_medical_review(system):
    encounter_id = create_encounter(system)
    complete_encounter(system, encounter_id)
    document_id = make_document(system, encounter_id)
    assert (
        system.client.post(
            f"/api/documents/{document_id}/transition", json={"revision": 0, "target": "review"}
        ).status_code
        == 200
    )
    response = system.client.post(
        f"/api/documents/{document_id}/transition", json={"revision": 1, "target": "ready"}
    )
    assert response.status_code == 422 and "revisão" in response.text


@pytest.mark.parametrize(
    "category", ["unclassified", "antimicrobial", "ret_glp1", "controlled", "special"]
)
def test_special_or_unclassified_prescription_cannot_be_emitted_as_generic_pdf(system, category):
    encounter_id = create_encounter(system)
    complete_encounter(system, encounter_id)
    record = system.client.get(f"/api/encounters/{encounter_id}").json()
    record["draft"]["medications"] = [
        Medication(**{**medication(), "category": category}).model_dump()
    ]
    assert (
        system.client.put(
            f"/api/encounters/{encounter_id}/draft",
            json={"revision": record["revision"], "draft": record["draft"]},
        ).status_code
        == 200
    )
    document_id = make_document(system, encounter_id, "prescription")
    system.client.post(
        f"/api/documents/{document_id}/transition", json={"revision": 0, "target": "review"}
    )
    response = system.client.post(
        f"/api/documents/{document_id}/transition",
        json={"revision": 1, "target": "ready", "medical_review_confirmed": True},
    )
    assert response.status_code == 422 and "SNCR" in response.text
    draft = system.client.get(f"/api/documents/{document_id}/pdf")
    assert draft.status_code == 200
    assert "RASCUNHO" in PdfReader(io.BytesIO(draft.content)).pages[0].extract_text()


def test_final_pdf_bytes_are_stable_and_not_automatically_signed(system):
    encounter_id = create_encounter(system)
    complete_encounter(system, encounter_id)
    document_id = make_document(system, encounter_id)
    prepare_document(system, document_id)
    first = system.client.get(f"/api/documents/{document_id}/pdf")
    second = system.client.get(f"/api/documents/{document_id}/pdf")
    assert first.content == second.content
    assert "nao-assinado" in first.headers["content-disposition"]
    text = PdfReader(io.BytesIO(first.content)).pages[0].extract_text().lower()
    assert "assinado digitalmente" not in text
    report = system.client.post(
        f"/api/documents/{document_id}/signed-import",
        content=first.content,
        headers={"Content-Type": "application/pdf"},
    )
    assert report.status_code == 200 and report.json()["verified"] is False
    assert system.client.get(f"/api/documents/{document_id}").json()["status"] == "ready"
    release = system.client.post(
        f"/api/documents/{document_id}/transition",
        json={"revision": 2, "target": "delivered", "medical_review_confirmed": True},
    )
    assert release.status_code == 409


def test_patient_cannot_download_unsigned_document_even_with_its_identifier(system):
    encounter_id = create_encounter(system)
    complete_encounter(system, encounter_id)
    document_id = make_document(system, encounter_id)
    prepare_document(system, document_id)
    patient, _, _ = patient_client(system, encounter_id)
    assert patient.get(f"/api/documents/{document_id}/pdf").status_code == 404
    assert patient.get("/api/patient").json()["documents"] == []
    unsigned_id = system.store.one("SELECT pdf_id FROM documents WHERE id=?", (document_id,))[
        "pdf_id"
    ]
    assert patient.get("/api/files/" + unsigned_id).status_code == 404


def test_favorite_requires_new_confirmation_for_each_encounter(system):
    favorite = system.client.post(
        "/api/favorites", json=Medication(**medication()).model_dump()
    ).json()["id"]
    first, second = create_encounter(system), create_encounter(system)
    for number, encounter_id in enumerate((first, second)):
        complete_encounter(system, encounter_id)
        template = system.client.post(
            f"/api/encounters/{encounter_id}/favorites/{favorite}"
        ).json()["medication"]
        assert template["favorite_id"] == favorite
        row = system.client.get(f"/api/encounters/{encounter_id}").json()
        row["draft"]["medications"] = [template]
        system.client.put(
            f"/api/encounters/{encounter_id}/draft",
            json={"revision": row["revision"], "draft": row["draft"]},
        )
        if number == 0:
            system.client.post(
                f"/api/encounters/{encounter_id}/medications/{template['id']}/confirm-favorite"
            )
        doc = make_document(system, encounter_id, "prescription")
        system.client.post(
            f"/api/documents/{doc}/transition", json={"revision": 0, "target": "review"}
        )
        result = system.client.post(
            f"/api/documents/{doc}/transition",
            json={"revision": 1, "target": "ready", "medical_review_confirmed": True},
        )
        assert result.status_code == (200 if number == 0 else 422)
        if number == 1:
            assert "reconfirme" in result.text.lower()


def test_backup_restore_preserves_records_and_invalidates_sessions(system, tmp_path):
    encounter_id = create_encounter(system, "REGISTRO_CIFRADO_NO_BACKUP")
    file_id = system.store.file(
        encounter_id, b"arquivo privado ficticio", "arquivo.pdf", "application/pdf"
    )
    archive = tmp_path / "backup.zip"
    create_backup(system.store, archive)
    assert b"REGISTRO_CIFRADO_NO_BACKUP" not in archive.read_bytes()
    restored = restore_backup(archive, tmp_path / "restored", system.settings.encryption_key)
    row = restored.one("SELECT data FROM patients")
    assert restored.decode(row["data"])["name"] == "REGISTRO_CIFRADO_NO_BACKUP"
    assert restored.file_bytes(file_id) == b"arquivo privado ficticio"
    assert restored.rows("SELECT * FROM sessions") == []


def test_corrupted_backup_is_rejected_before_restoration(system, tmp_path):
    create_encounter(system)
    original, modified = tmp_path / "backup.zip", tmp_path / "modified.zip"
    create_backup(system.store, original)
    with zipfile.ZipFile(original) as source, zipfile.ZipFile(modified, "w") as dest:
        for name in source.namelist():
            dest.writestr(name, b"tampered" if name == "database.sqlite3" else source.read(name))
    with pytest.raises(ValueError, match="Integridade"):
        restore_backup(modified, tmp_path / "restore-invalid", system.settings.encryption_key)
    assert not (tmp_path / "restore-invalid").exists()


def test_pdf_without_signature_or_modified_bytes_cannot_verify(system):
    payload = {
        "doctor": system.profile,
        "patient": {"name": "PESSOA FICTICIA"},
        "kind": "guidance",
        "content": "Orientação fictícia",
        "created_at": 1792620000,
    }
    unsigned = render_pdf(payload, draft=False, document_id="teste")
    assert not verify_signed(unsigned, unsigned, system.profile["cpf"], system.settings)["verified"]
    tampered = unsigned.replace(b"%PDF", b"%PDE", 1)
    assert not verify_signed(unsigned, tampered, system.profile["cpf"], system.settings)["verified"]
