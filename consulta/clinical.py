from __future__ import annotations

import re
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from consulta.models import Draft, Intake, Medication, Patient, Profile

ANSWER_LABELS = {
    "not_informed": "Não informado",
    "does_not_know": "Não sabe",
    "denies": "Nega",
    "not_applicable": "Não se aplica",
    "informed": "Informado",
}
KINDS = {
    "prescription": "Receita médica",
    "exam_request": "Solicitação de exames",
    "referral": "Encaminhamento",
    "guidance": "Orientações",
    "certificate": "Documento médico",
    "evolution": "Evolução e registro de teleconsulta",
}
FIELD_LABELS = {
    "onset": "Início",
    "duration": "Duração",
    "location": "Localização",
    "radiation": "Irradiação",
    "characteristic": "Característica",
    "intensity": "Intensidade (0–10)",
    "frequency": "Frequência",
    "evolution": "Evolução",
    "aggravating": "Fatores de piora",
    "relieving": "Fatores de alívio",
    "associated": "Sintomas associados",
    "explicit_negatives": "Negativas explicitamente relatadas",
    "treatments_tried": "Tratamentos tentados",
}


def answer_text(value) -> str:
    return value.text if value.status == "informed" else ANSWER_LABELS[value.status]


def suggest_note(intake: Intake, draft: Draft):
    """Organização literal: nunca deriva diagnósticos, negações ou exame normal."""
    hpma = []
    if intake.original_report:
        hpma.append("Relato original do paciente:\n" + intake.original_report)
    for key, label in FIELD_LABELS.items():
        value = getattr(intake, key)
        if value is not None and value != "":
            hpma.append(f"{label}: {value}")
    note = draft.note.model_dump()
    proposal = {
        **note,
        "qd": intake.chief_complaint,
        "hpma": "\n".join(hpma),
        "history": "\n".join(
            f"{label}: {answer_text(getattr(intake, key))}"
            for key, label in (
                ("conditions", "Antecedentes"),
                ("surgeries", "Cirurgias"),
                ("family", "História familiar"),
                ("psychosocial", "Contexto psicossocial"),
            )
        ),
        "medications": answer_text(intake.medications),
        "allergies": answer_text(intake.allergies),
    }
    if draft.note.format == "soap":
        proposal["subjective"] = "\n".join(filter(None, [intake.chief_complaint, proposal["hpma"]]))
    # Os demais campos permanecem exatamente como o médico os escreveu.
    return proposal


def intake_issues(patient: Patient, intake: Intake):
    issues = []
    for value, label in (
        (patient.birth_date, "Nascimento"),
        (patient.contact, "Contato"),
        (intake.chief_complaint.strip(), "Queixa principal"),
    ):
        if not value:
            issues.append(label + " é obrigatório")
    if patient.minor or patient.needs_guardian:
        if not all(
            (patient.guardian_name, patient.guardian_relationship, patient.guardian_contact)
        ):
            issues.append("Informe identificação, vínculo e contato do responsável")
    if not intake.privacy_acknowledged:
        issues.append("Confirme a ciência do aviso de privacidade")
    # Consentimento de teleconsulta permanece separado e pode ser colhido pelo médico.
    return issues


def encounter_issues(patient: Patient, draft: Draft, encounter: dict):
    issues = []
    tele, note = draft.tele, draft.note
    if not encounter.get("intake_submitted_at"):
        issues.append("Pré-consulta ainda não foi enviada/revisada")
    if not encounter.get("started_at") or not encounter.get("ended_at"):
        issues.append("Registre início e término do atendimento")
    if not tele.identity_confirmed or not tele.identity_method:
        issues.append("Confirme a identidade e registre como foi conferida")
    for value, label in (
        (tele.current_location, "Localização atual"),
        (tele.reconnection_contact, "Contato para reconexão"),
        (tele.modality, "Modalidade"),
        (tele.platform, "Plataforma"),
        (tele.connection_quality, "Qualidade da conexão"),
    ):
        if not value.strip():
            issues.append(label + " é obrigatório")
    if not tele.consent_confirmed or not tele.consent_details:
        issues.append("Confirme e documente o consentimento para teleconsulta")
    if tele.connection_quality in {"limitada", "ruim"} and not tele.limitations:
        issues.append("Descreva as limitações da conexão")
    if tele.disposition in {"urgent", "in_person"} and not tele.disposition_reason:
        issues.append("Documente o motivo do encaminhamento presencial/urgente")
    if (
        tele.recording_authorized or tele.transcription_authorized
    ) and not tele.specific_authorization_details:
        issues.append(
            "Documente a autorização específica; gravação/transcrição não são executadas pelo app"
        )
    if not (note.hpma if note.format == "traditional" else note.subjective):
        issues.append("Preencha a HPMA ou o subjetivo")
    if not note.assessment.strip() or not note.plan.strip():
        issues.append("Avaliação e plano precisam de registro médico")
    for index, vital in enumerate(tele.vitals, 1):
        if not all((vital.kind, vital.value, vital.unit, vital.source, vital.measured_at)):
            issues.append(
                f"Sinal vital {index}: complete medida, valor, unidade, origem e momento da aferição"
            )
    return issues


def medication_issues(item: Medication):
    missing = []
    for key, label in (
        ("ingredient", "princípio ativo"),
        ("strength", "concentração"),
        ("strength_unit", "unidade da concentração"),
        ("presentation", "apresentação"),
        ("route", "via"),
        ("frequency", "frequência/intervalo"),
        ("quantity", "quantidade total"),
        ("dispensing_unit", "unidade de dispensação"),
    ):
        if not getattr(item, key).strip():
            missing.append(label)
    if not item.variable_schedule and (not item.dose or not item.dose_unit):
        missing.append("dose por administração e sua unidade")
    if not item.continuous and not item.duration:
        missing.append("duração ou indicação de uso contínuo")
    if item.as_needed:
        if not item.condition:
            missing.append("condição de uso se necessário")
        if (not item.minimum_interval or not item.daily_limit) and not item.prn_exception_reason:
            missing.append(
                "intervalo mínimo e limite diário, ou justificativa de não aplicabilidade"
            )
    if item.category != "common":
        missing.append(
            "emissão final bloqueada: categoria não confirmada como comum ou sujeita a regras/SNCR"
        )
    return missing


def document_issues(payload: dict, confirmed_favorites: set[tuple[str, str]]):
    patient = Patient.model_validate(payload["patient"])
    profile = Profile.model_validate(payload["doctor"])
    issues = []
    for value, label in (
        (patient.name, "Nome do paciente"),
        (patient.birth_date, "Nascimento do paciente"),
        (patient.identification, "Identificação documental do paciente"),
        (profile.name, "Nome do médico"),
        (profile.crm, "CRM"),
        (profile.crm_state, "UF do CRM"),
        (profile.professional_address, "Endereço profissional"),
        (profile.professional_contact, "Contato profissional"),
        (profile.cpf, "CPF do médico para vínculo do certificado"),
    ):
        if not value:
            issues.append(label + " é obrigatório para preparar o documento final")
    if payload["kind"] == "prescription":
        if not patient.address:
            issues.append("Endereço do paciente é obrigatório nesta emissão")
        items = [Medication.model_validate(item) for item in payload.get("medications", [])]
        if not items:
            issues.append("Inclua ao menos um medicamento estruturado")
        for number, item in enumerate(items, 1):
            issues.extend(f"Item {number}: {text}" for text in medication_issues(item))
            if item.favorite_id and (item.id, item.favorite_id) not in confirmed_favorites:
                issues.append(f"Item {number}: reconfirme o favorito para este atendimento")
    elif not payload.get("content", "").strip():
        issues.append("O conteúdo precisa ser revisado e preenchido pelo médico")
    return issues


def medication_lines(item: dict):
    med = Medication.model_validate(item)
    title = med.ingredient + (f" ({med.brand})" if med.brand else "")
    title += f" — {med.strength} {med.strength_unit}; {med.presentation}"
    regimen = med.variable_schedule or f"Administrar {med.dose} {med.dose_unit} por administração."
    lines = [
        title,
        regimen,
        f"Via: {med.route}. Frequência/intervalo: {med.frequency}.",
        "Uso contínuo." if med.continuous else f"Duração: {med.duration}.",
        f"Quantidade total: {med.quantity} {med.dispensing_unit}.",
    ]
    if med.as_needed:
        lines.append(f"Se necessário: {med.condition}.")
        if med.minimum_interval:
            lines.append(f"Intervalo mínimo: {med.minimum_interval}.")
        if med.daily_limit:
            lines.append(f"Limite diário: {med.daily_limit}.")
        if med.prn_exception_reason:
            lines.append("Observação sobre uso se necessário: " + med.prn_exception_reason)
    if med.instructions:
        lines.append(med.instructions)
    return lines


def redact(text: str, patient: dict, profile: dict | None = None):
    values = [str(v) for k, v in patient.items() if k not in {"needs_guardian", "birth_date"} and v]
    values += [str(v) for v in (profile or {}).values() if v]
    for value in sorted(values, key=len, reverse=True):
        if len(value) >= 3:
            text = re.sub(re.escape(value), "[REMOVIDO]", text, flags=re.IGNORECASE)
    if patient.get("birth_date"):
        text = text.replace(str(patient["birth_date"]), "[DATA REMOVIDA]")
    text = re.sub(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b", "[EMAIL REMOVIDO]", text)
    text = re.sub(
        r"(?<!\d)(?:\+?55\s*)?(?:\(?\d{2}\)?[\s.-]*)?\d{4,5}[-\s.]?\d{4}(?!\d)",
        "[CONTATO REMOVIDO]",
        text,
    )
    text = re.sub(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b", "[DOCUMENTO REMOVIDO]", text)
    return text


def redact_payload(value, patient: dict, profile: dict | None = None):
    """Remove identificadores dos valores sem alterar chaves ou corromper JSON."""
    if isinstance(value, str):
        return redact(value, patient, profile)
    if isinstance(value, dict):
        return {key: redact_payload(item, patient, profile) for key, item in value.items()}
    if isinstance(value, list):
        return [redact_payload(item, patient, profile) for item in value]
    return value


def evolution_content(draft: Draft, encounter: dict, addenda: list[dict]):
    note, tele = draft.note, draft.tele
    fields = (
        [("qd", "QD"), ("hpma", "HPMA")]
        if note.format == "traditional"
        else [("subjective", "S — Subjetivo"), ("objective", "O — Objetivo")]
    )
    fields += [
        ("history", "Antecedentes e contexto"),
        ("medications", "Medicamentos em uso"),
        ("allergies", "Alergias"),
        ("exam", "Exame / achados documentados"),
        ("assessment", "Avaliação médica"),
        ("plan", "Plano"),
    ]
    sources = {
        "patient": "paciente",
        "doctor": "médico",
        "document": "documento",
        "ai": "sugestão de IA revisada",
    }
    lines = ["EVOLUÇÃO MÉDICA — " + ("SOAP" if note.format == "soap" else "TRADICIONAL")]
    for key, label in fields:
        lines.extend(
            [
                label + " · origem: " + sources[note.sources.get(key, "doctor")],
                getattr(note, key) or "Não informado",
                "",
            ]
        )
    lines.extend(
        [
            "Retorno e continuidade",
            draft.follow_up or "Não informado",
            "",
            "REGISTRO DE TELECONSULTA",
        ]
    )
    for key, label in (("started_at", "Início"), ("ended_at", "Término")):
        value = encounter.get(key)
        stamp = (
            datetime.fromtimestamp(value, UTC)
            .astimezone(ZoneInfo("America/Sao_Paulo"))
            .strftime("%d/%m/%Y %H:%M:%S")
            if value
            else "Não registrado"
        )
        lines.append(label + ": " + stamp + " — America/Sao_Paulo")
    lines.extend(
        [
            "Identidade: "
            + ("confirmada pelo médico" if tele.identity_confirmed else "não confirmada"),
            "Método de conferência: " + (tele.identity_method or "Não informado"),
            "Localização atual: " + (tele.current_location or "Não informado"),
            "Contato para reconexão: " + (tele.reconnection_contact or "Não informado"),
            "Modalidade: " + (tele.modality or "Não informado"),
            "Plataforma: " + (tele.platform or "Não informado"),
            "Acompanhante: " + answer_text(tele.companion),
            "Consentimento: "
            + ("confirmado pelo médico" if tele.consent_confirmed else "não confirmado"),
            "Registro do consentimento: " + (tele.consent_details or "Não informado"),
            "Qualidade da conexão: " + (tele.connection_quality or "Não informado"),
            "Limitações: " + (tele.limitations or "Não informado"),
            "Achados efetivamente observados ao vídeo: " + (tele.video_findings or "Não informado"),
            "Conduta de encaminhamento: "
            + {
                "not_decided": "Não decidida",
                "follow_up": "Acompanhamento/retorno",
                "in_person": "Atendimento presencial indicado",
                "urgent": "Urgência indicada",
            }[tele.disposition],
            "Motivo e orientação: " + (tele.disposition_reason or "Não informado"),
        ]
    )
    for vital in tele.vitals:
        moment = (
            vital.measured_at.astimezone(ZoneInfo("America/Sao_Paulo")).isoformat()
            if vital.measured_at
            else "momento não informado"
        )
        lines.append(
            f"Medida: {vital.kind or 'Não informada'}; {vital.value or 'valor não informado'} "
            f"{vital.unit}; origem: {vital.source or 'Não informada'}; aferida em: {moment}"
        )
    for item in addenda:
        stamp = datetime.fromtimestamp(item["created_at"], UTC).astimezone(
            ZoneInfo("America/Sao_Paulo")
        )
        lines.extend(["", "ADENDO — " + stamp.strftime("%d/%m/%Y %H:%M:%S"), item["text"]])
    return "\n".join(lines)
