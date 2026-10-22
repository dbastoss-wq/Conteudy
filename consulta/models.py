from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Literal
from uuid import uuid4
from zoneinfo import ZoneInfo

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", str_max_length=20000)


class Answer(Model):
    status: Literal["not_informed", "does_not_know", "denies", "not_applicable", "informed"] = (
        "not_informed"
    )
    text: str = ""

    @model_validator(mode="after")
    def informed_text(self):
        if self.status == "informed" and not self.text.strip():
            raise ValueError("Descreva a informação ou selecione outro estado")
        if self.status != "informed" and self.text.strip():
            raise ValueError("Texto exige estado 'Informado'")
        return self


class Patient(Model):
    name: str = Field(min_length=3, max_length=200)
    birth_date: date | None = None
    contact: str = ""
    email: str = ""
    identification: str = ""
    address: str = ""
    guardian_name: str = ""
    guardian_relationship: str = ""
    guardian_contact: str = ""
    needs_guardian: bool = False

    @field_validator("birth_date")
    @classmethod
    def birth_is_past(cls, value):
        today = datetime.now(ZoneInfo("America/Sao_Paulo")).date()
        if value and (value > today or today.year - value.year > 130):
            raise ValueError("Nascimento inválido")
        return value

    @property
    def minor(self):
        if not self.birth_date:
            return False
        today = datetime.now(ZoneInfo("America/Sao_Paulo")).date()
        age = (
            today.year
            - self.birth_date.year
            - ((today.month, today.day) < (self.birth_date.month, self.birth_date.day))
        )
        return age < 18


class Intake(Model):
    chief_complaint: str = ""
    expectation: str = ""
    original_report: str = ""
    onset: str = ""
    duration: str = ""
    location: str = ""
    radiation: str = ""
    characteristic: str = ""
    intensity: int | None = Field(default=None, ge=0, le=10)
    frequency: str = ""
    evolution: str = ""
    aggravating: str = ""
    relieving: str = ""
    associated: str = ""
    explicit_negatives: str = ""
    treatments_tried: str = ""
    conditions: Answer = Field(default_factory=Answer)
    medications: Answer = Field(default_factory=Answer)
    allergies: Answer = Field(default_factory=Answer)
    surgeries: Answer = Field(default_factory=Answer)
    family: Answer = Field(default_factory=Answer)
    psychosocial: Answer = Field(default_factory=Answer)
    privacy_acknowledged: bool = False
    telemedicine_consent: bool = False


class Vital(Model):
    id: str = Field(default_factory=lambda: str(uuid4()))
    kind: Literal[
        "", "pressao", "frequencia_cardiaca", "temperatura", "saturacao", "peso", "altura", "outro"
    ] = ""
    value: str = Field(default="", max_length=100)
    unit: str = Field(default="", max_length=40)
    source: Literal["", "paciente", "documento", "observado_em_video", "medico"] = ""
    measured_at: AwareDatetime | None = None


class Teleconsultation(Model):
    identity_confirmed: bool = False
    identity_method: str = ""
    current_location: str = ""
    reconnection_contact: str = ""
    modality: str = ""
    platform: str = ""
    call_url: str = ""
    companion: Answer = Field(default_factory=Answer)
    consent_confirmed: bool = False
    consent_details: str = ""
    connection_quality: str = ""
    limitations: str = ""
    video_findings: str = ""
    disposition: Literal["not_decided", "follow_up", "in_person", "urgent"] = "not_decided"
    disposition_reason: str = ""
    recording_authorized: bool = False
    transcription_authorized: bool = False
    specific_authorization_details: str = ""
    vitals: list[Vital] = Field(default_factory=list, max_length=40)


def numeric(value: str, label: str) -> Decimal | None:
    if not value:
        return None
    # Não aceita separadores de milhar nem unidades junto ao número.
    if not re.fullmatch(r"\d+(?:[,.]\d+)?", value.strip()):
        raise ValueError(f"{label}: use número positivo com vírgula ou ponto decimal, sem milhar")
    try:
        result = Decimal(value.replace(",", "."))
    except InvalidOperation as exc:
        raise ValueError(f"{label} inválido") from exc
    if not result.is_finite() or result <= 0:
        raise ValueError(f"{label} deve ser positivo")
    return result


class Medication(Model):
    id: str = Field(default_factory=lambda: str(uuid4()))
    ingredient: str = ""
    brand: str = ""
    strength: str = ""
    strength_unit: str = ""
    presentation: str = ""
    dose: str = ""
    dose_unit: str = ""
    route: str = ""
    frequency: str = ""
    duration: str = ""
    continuous: bool = False
    quantity: str = ""
    dispensing_unit: str = ""
    as_needed: bool = False
    condition: str = ""
    minimum_interval: str = ""
    daily_limit: str = ""
    prn_exception_reason: str = ""
    instructions: str = ""
    variable_schedule: str = ""
    category: Literal[
        "unclassified", "common", "antimicrobial", "ret_glp1", "controlled", "special"
    ] = "unclassified"
    favorite_id: str | None = None

    @model_validator(mode="after")
    def numbers(self):
        for key in ("strength", "dose", "quantity"):
            numeric(getattr(self, key), key)
        return self


class ClinicalNote(Model):
    format: Literal["traditional", "soap"] = "traditional"
    qd: str = ""
    hpma: str = ""
    history: str = ""
    medications: str = ""
    allergies: str = ""
    exam: str = ""
    assessment: str = ""
    plan: str = ""
    subjective: str = ""
    objective: str = ""
    sources: dict[str, Literal["doctor", "patient", "document", "ai"]] = Field(default_factory=dict)


class Draft(Model):
    note: ClinicalNote = Field(default_factory=ClinicalNote)
    tele: Teleconsultation = Field(default_factory=Teleconsultation)
    medications: list[Medication] = Field(default_factory=list, max_length=80)
    prescription_text: str = ""
    follow_up: str = ""


class Profile(Model):
    name: str = "Dr. Daniel Cardoso de Bastos"
    specialty: str = "Clínico geral"
    crm: str = "239894"
    crm_state: str = "SP"
    cpf: str = ""
    professional_address: str = ""
    professional_contact: str = ""
    privacy_notice: str = ""


class DraftSave(Model):
    revision: int = Field(ge=0)
    draft: Draft


class IntakeSave(Model):
    revision: int = Field(ge=0)
    patient: Patient
    intake: Intake
    submit: bool = False


class DocumentCreate(Model):
    kind: Literal[
        "prescription", "exam_request", "referral", "guidance", "certificate", "evolution"
    ]
    content: str = ""
    encounter_revision: int = Field(ge=0)


class DocumentTransition(Model):
    revision: int = Field(ge=0)
    target: Literal["review", "ready", "delivered"]
    medical_review_confirmed: bool = False


class Addendum(Model):
    text: str = Field(min_length=5, max_length=10000)


class Login(Model):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=512)


class InviteExchange(Model):
    token: str = Field(min_length=32, max_length=200)


class NewEncounter(Model):
    patient: Patient
    scheduled_at: datetime | None = None
