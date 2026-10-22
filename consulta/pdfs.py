from __future__ import annotations

import io
from datetime import UTC, datetime
from pathlib import Path
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import HRFlowable, KeepTogether, Paragraph, SimpleDocTemplate, Spacer

from consulta.clinical import KINDS, medication_lines


def render_pdf(payload: dict, *, draft: bool, document_id: str) -> bytes:
    font_dir = Path(__file__).parent / "fonts"
    for name, filename in (
        ("Consulta", "OpenSans-Regular.ttf"),
        ("ConsultaBold", "OpenSans-Semibold.ttf"),
    ):
        if name not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(name, str(font_dir / filename)))
    pdfmetrics.registerFontFamily("Consulta", normal="Consulta", bold="ConsultaBold")
    stream = io.BytesIO()
    doc = SimpleDocTemplate(
        stream,
        pagesize=(210 * mm, 297 * mm),
        leftMargin=19 * mm,
        rightMargin=19 * mm,
        topMargin=18 * mm,
        bottomMargin=22 * mm,
        title=KINDS[payload["kind"]],
        author=payload["doctor"]["name"],
    )
    normal = ParagraphStyle(
        "Clinical",
        fontName="Consulta",
        fontSize=10,
        leading=15,
        textColor=colors.HexColor("#1e3837"),
        spaceAfter=7,
        wordWrap="LTR",
    )
    title = ParagraphStyle(
        "ClinicalTitle",
        parent=normal,
        fontName="ConsultaBold",
        fontSize=18,
        leading=23,
        spaceAfter=14,
    )
    label = ParagraphStyle(
        "Label", parent=normal, fontName="ConsultaBold", fontSize=11, spaceBefore=10
    )
    banner = ParagraphStyle(
        "Banner", parent=normal, textColor=colors.HexColor("#8b4d21"), alignment=TA_CENTER
    )
    patient, doctor = payload["patient"], payload["doctor"]

    def p(text, style=normal):
        return Paragraph(escape(str(text)).replace("\n", "<br/>"), style)

    parts = [
        p(doctor["name"], title),
        p(f"{doctor['specialty']} · CRM-{doctor['crm_state']} {doctor['crm']}"),
    ]
    if doctor.get("professional_address"):
        parts.append(p(doctor["professional_address"]))
    if doctor.get("professional_contact"):
        parts.append(p(doctor["professional_contact"]))
    parts.extend(
        [HRFlowable(width="100%", thickness=0.7, color=colors.HexColor("#b6c8c0")), Spacer(1, 12)]
    )
    if draft:
        parts.append(p("RASCUNHO — NÃO ASSINADO — NÃO UTILIZAR COMO RECEITA", banner))
    if payload.get("demonstration"):
        parts.append(p("DEMONSTRAÇÃO FICTÍCIA — SEM USO ASSISTENCIAL", banner))
    parts.extend([p(KINDS[payload["kind"]], title), p(f"Paciente: {patient['name']}")])
    for key, text in (
        ("birth_date", "Nascimento"),
        ("identification", "Identificação"),
        ("address", "Endereço"),
    ):
        if patient.get(key):
            parts.append(p(f"{text}: {patient[key]}"))
    parts.append(Spacer(1, 12))
    if payload["kind"] == "prescription":
        for number, item in enumerate(payload.get("medications", []), 1):
            lines = medication_lines(item)
            # Título e primeira linha ficam juntos. Blocos longos continuam na página seguinte.
            parts.append(KeepTogether([p(f"{number}. {lines[0]}", label), p(lines[1])]))
            parts.extend(p(line) for line in lines[2:])
            parts.append(Spacer(1, 9))
        if payload.get("prescription_text"):
            parts.extend([p("Orientações complementares", label), p(payload["prescription_text"])])
    if payload.get("content"):
        parts.append(p(payload["content"]))
    issued = datetime.fromtimestamp(payload["created_at"], UTC).astimezone(
        ZoneInfo("America/Sao_Paulo")
    )
    parts.extend(
        [
            Spacer(1, 18),
            p("Preparado em " + issued.strftime("%d/%m/%Y às %H:%M") + " — America/Sao_Paulo"),
            p(
                "A assinatura eletrônica deve ser conferida no arquivo final. Um PDF gerado não comprova assinatura."
            ),
        ]
    )

    def footer(canvas, document):
        canvas.saveState()
        canvas.setFont("Consulta", 7)
        canvas.setFillColor(colors.HexColor("#667b77"))
        canvas.drawString(
            19 * mm,
            13 * mm,
            f"Documento {document_id[:12]}"
            + (" · RASCUNHO" if draft else "")
            + (" · DEMONSTRAÇÃO" if payload.get("demonstration") else ""),
        )
        canvas.drawRightString(191 * mm, 13 * mm, f"Página {document.page}")
        canvas.restoreState()

    doc.build(parts, onFirstPage=footer, onLaterPages=footer)
    return stream.getvalue()
