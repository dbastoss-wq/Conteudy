"""Ensaio real de navegador. Ative com RUN_BROWSER_TESTS=1; usa somente dados fictícios."""

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_BROWSER_TESTS") != "1", reason="Ensaio de navegador optativo"
)


@pytest.fixture(scope="module")
def browser_url():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    process = subprocess.Popen(
        [sys.executable, "-m", "consulta.cli", "demo", "--port", str(port)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    url = f"http://127.0.0.1:{port}"
    try:
        for _ in range(100):
            try:
                if httpx.get(url + "/health", timeout=1).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            time.sleep(0.1)
        else:
            raise AssertionError("Servidor de demonstração não iniciou")
        yield url
    finally:
        process.terminate()
        process.wait(timeout=10)


def test_browser_patient_doctor_recovery_network_conflict_mobile(browser_url):
    from playwright.sync_api import expect, sync_playwright

    evidence = Path("test-results")
    evidence.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={"width": 1600, "height": 1050})
        doctor = context.new_page()
        errors = []
        doctor.on("pageerror", lambda error: errors.append(str(error)))
        doctor.goto(browser_url)
        doctor.get_by_role("button", name="Abrir demonstração vazia").click()
        expect(doctor.get_by_text("Seu consultório, em foco.")).to_be_visible()
        expect(doctor.get_by_text("Seu primeiro cuidado começa aqui.")).to_be_visible()
        doctor.locator('[data-action="settings"]').click()
        doctor.locator('[data-profile="privacy_notice"]').fill(
            "Aviso fictício exclusivo para testes, sem uso assistencial. Dados serão apagados ao encerrar a demonstração."
        )
        doctor.locator('[data-form="profile"] button[type="submit"]').click()
        expect(doctor.locator("#toast")).to_contain_text("salvos no servidor")
        doctor.locator('[data-action="home"]').click()
        doctor.locator('[data-action="newEncounter"]').first.click()
        doctor.locator('[data-new="name"]').fill("Pessoa fictícia de demonstração")
        doctor.locator('[data-new="birth_date"]').fill("1990-01-01")
        doctor.locator('[data-new="contact"]').fill("Contato fictício do teste")
        doctor.locator('[data-form="newEncounter"] button[type="submit"]').click()
        expect(doctor.locator(".consult-header h1")).to_have_text("Pessoa fictícia de demonstração")
        record_url = doctor.url
        hpma = "Redação médica fictícia preservada: não houve relato da informação."
        doctor.locator('[data-draft="note.hpma"]').fill(hpma)
        expect(doctor.locator(".save-status")).to_have_text("Salvo no servidor")
        doctor.reload()
        expect(doctor.locator('[data-draft="note.hpma"]')).to_have_value(hpma)
        doctor.evaluate("scrollTo(0,document.body.scrollHeight)")
        expect(doctor.locator(".clinical-strip")).to_be_in_viewport()
        expect(doctor.locator(".clinical-strip")).to_contain_text("Pessoa fictícia")
        doctor.evaluate("scrollTo(0,0)")
        doctor.screenshot(path=str(evidence / "workspace-desktop.png"), full_page=True)
        doctor.locator('[data-action="tab"][data-tab="prescription"]').click()
        doctor.locator('[data-action="medAdd"]').first.click()
        for key, value in {
            "ingredient": "Substância fictícia de demonstração",
            "strength": "2,5",
            "strength_unit": "mg/mL",
            "dose": "1,5",
            "dose_unit": "mL",
            "presentation": "Apresentação fictícia",
            "route": "Via fictícia",
            "frequency": "Intervalo definido no teste",
            "duration": "Duração definida no teste",
            "quantity": "1",
            "dispensing_unit": "unidade fictícia",
        }.items():
            doctor.locator('[data-med="0"][data-key="' + key + '"]').fill(value)
        doctor.locator('[data-med="0"][data-key="category"]').select_option("common")
        expect(doctor.locator(".save-status")).to_have_text("Salvo no servidor")
        expect(doctor.locator("#rx-preview")).to_contain_text("2,5 mg/mL")
        expect(doctor.locator("#rx-preview")).to_contain_text("1,5 mL")
        doctor.screenshot(path=str(evidence / "prescription-desktop.png"), full_page=True)
        doctor.locator('[data-action="invite"]').click()
        invite_url = doctor.locator("#invite-url").input_value()
        doctor.locator('#modal [data-action="closeModal"]').first.click()
        patient_context = browser.new_context(viewport={"width": 390, "height": 844})
        patient = patient_context.new_page()
        patient.on("pageerror", lambda error: errors.append(str(error)))
        patient.goto(invite_url)
        expect(patient.get_by_text("Vamos começar pela sua história.")).to_be_visible()
        expect(patient.locator('[data-patient="name"]')).to_have_value(
            "Pessoa fictícia de demonstração"
        )
        patient.locator('[data-action="wizardNext"]').click()
        patient.locator('[data-intake="chief_complaint"]').fill("Relato fictício: não tive febre.")
        patient.locator('[data-intake="original_report"]').fill(
            "Não tive febre. Não sei informar a duração."
        )
        expect(patient.locator(".save-status")).to_have_text("Salvo no servidor")
        patient.route("**/api/patient/intake", lambda route: route.abort())
        patient.locator('[data-intake="expectation"]').fill(
            "Expectativa fictícia escrita durante falha de rede."
        )
        expect(patient.locator(".save-status")).to_have_text("Não sincronizado · erro")
        expect(patient.locator('[data-intake="expectation"]')).to_have_value(
            "Expectativa fictícia escrita durante falha de rede."
        )
        patient.unroute("**/api/patient/intake")
        patient.locator('[data-action="retrySave"]').click()
        expect(patient.locator(".save-status")).to_have_text("Salvo no servidor")
        patient.locator('[data-action="wizardNext"]').click()
        patient.locator('[data-intake="allergies.status"]').select_option("does_not_know")
        expect(patient.locator(".save-status")).to_have_text("Salvo no servidor")
        patient.screenshot(path=str(evidence / "patient-mobile.png"), full_page=True)
        assert not patient.evaluate("document.documentElement.scrollWidth>innerWidth")
        patient.locator('[data-action="wizardNext"]').click()
        patient.locator('[data-action="wizardNext"]').click()
        patient.locator('[data-intake="privacy_acknowledged"]').check()
        patient.locator('[data-intake="telemedicine_consent"]').check()
        expect(patient.locator(".save-status")).to_have_text("Salvo no servidor")
        patient.locator('[data-action="submitIntake"]').click()
        expect(patient.get_by_text("Seu relato chegou ao consultório.")).to_be_visible()
        doctor.goto(record_url)
        doctor.reload()
        doctor.locator('[data-action="tab"][data-tab="note"]').click()
        expect(doctor.locator('[data-draft="note.hpma"]')).to_have_value(hpma)
        doctor.locator('[data-action="organize"]').click()
        expect(doctor.locator("#modal")).to_contain_text("Não tive febre.")
        doctor.locator('#modal [data-action="closeModal"]').first.click()
        expect(doctor.locator('[data-draft="note.hpma"]')).to_have_value(hpma)
        second_context = browser.new_context(storage_state=context.storage_state())
        second = second_context.new_page()
        second.goto(record_url)
        second.locator('[data-action="tab"][data-tab="note"]').click()
        expect(second.locator('[data-draft="note.hpma"]')).to_have_value(hpma)
        doctor.locator('[data-draft="note.assessment"]').fill(
            "Avaliação fictícia registrada na aba principal."
        )
        expect(doctor.locator(".save-status")).to_have_text("Salvo no servidor")
        second.locator('[data-draft="note.plan"]').fill(
            "Redação concorrente que não pode sobrescrever o registro."
        )
        expect(second.locator(".save-status")).to_have_text("Conflito de edição")
        expect(second.locator('[data-draft="note.plan"]')).to_have_value(
            "Redação concorrente que não pode sobrescrever o registro."
        )
        second_context.close()
        doctor.locator('[data-draft="note.plan"]').fill(
            "Plano fictício confirmado pelo médico no teste."
        )
        expect(doctor.locator(".save-status")).to_have_text("Salvo no servidor")
        doctor.locator('[data-action="tab"][data-tab="tele"]').click()
        for key, value in {
            "identity_method": "Conferência fictícia do teste",
            "current_location": "Local fictício",
            "reconnection_contact": "Contato fictício",
            "platform": "Plataforma externa de teste",
            "consent_details": "Consentimento fictício documentado durante o ensaio",
        }.items():
            doctor.locator('[data-draft="tele.' + key + '"]').fill(value)
        doctor.locator('[data-draft="tele.modality"]').select_option("video")
        doctor.locator('[data-draft="tele.connection_quality"]').select_option("boa")
        doctor.locator('[data-draft="tele.identity_confirmed"]').check()
        doctor.locator('[data-draft="tele.consent_confirmed"]').check()
        expect(doctor.locator(".save-status")).to_have_text("Salvo no servidor")
        doctor.locator('[data-action="teleStart"]').click()
        expect(doctor.locator("#tele-end")).to_be_enabled()
        doctor.locator('[data-action="teleEnd"]').click()
        expect(doctor.locator("#tele-end")).to_be_disabled()
        doctor.locator('[data-action="tab"][data-tab="note"]').click()
        doctor.locator('[data-action="finalize"]').click()
        doctor.locator("#medical-review").check()
        doctor.locator('[data-action="confirmFinalize"]').click()
        expect(doctor.get_by_text("Atendimento finalizado.", exact=False)).to_be_visible()
        doctor.locator('[data-action="tab"][data-tab="prescription"]').click()
        expect(doctor.locator('[data-med="0"][data-key="dose"]')).to_be_enabled()
        doctor.locator('[data-action="newDocument"][data-kind="prescription"]').click()
        doctor.locator('[data-form="newDocument"] button[type="submit"]').click()
        expect(doctor.locator(".document-list")).to_contain_text("Rascunho")
        with doctor.expect_download() as download:
            doctor.locator('[data-action="pdf"]').first.click()
        assert download.value.suggested_filename.endswith(".pdf")
        doctor.set_viewport_size({"width": 390, "height": 844})
        doctor.locator('[data-action="tab"][data-tab="prescription"]').click()
        expect(doctor.locator('[data-med="0"][data-key="dose"]')).to_have_value("1,5")
        doctor.screenshot(path=str(evidence / "prescription-mobile.png"), full_page=True)
        assert not doctor.evaluate("document.documentElement.scrollWidth>innerWidth")
        assert errors == []
        patient_context.close()
        context.close()
        browser.close()
