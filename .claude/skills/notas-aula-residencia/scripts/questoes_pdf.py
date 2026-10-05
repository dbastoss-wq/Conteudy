#!/usr/bin/env python3
"""Gera o PDF das questões estilo residência a partir de um JSON.

Uso: python3 questoes_pdf.py questoes.json saida.pdf

Formato do JSON:
{
  "tema": "Síndrome coronariana aguda",
  "fonte": "Aula Eu Médico Residente",          (opcional)
  "questoes": [
    {
      "enunciado": "Caso clínico + pergunta",
      "alternativas": {"A": "...", "B": "...", "C": "...", "D": "...", "E": "..."},
      "gabarito": "C",
      "comentario": "Por que C está certa.",
      "distratores": {"A": "Por que está errada", ...}   (opcional)
    }
  ]
}
Requer: pip install reportlab
"""
import json
import os
import sys
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer

FONT, FONT_BOLD = "Helvetica", "Helvetica-Bold"
_DEJAVU = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
if os.path.exists(_DEJAVU) and os.path.exists(_DEJAVU.replace(".ttf", "-Bold.ttf")):
    pdfmetrics.registerFont(TTFont("DejaVu", _DEJAVU))
    pdfmetrics.registerFont(TTFont("DejaVu-Bold", _DEJAVU.replace(".ttf", "-Bold.ttf")))
    pdfmetrics.registerFontFamily("DejaVu", normal="DejaVu", bold="DejaVu-Bold")
    FONT, FONT_BOLD = "DejaVu", "DejaVu-Bold"

base = getSampleStyleSheet()["Normal"]
S = {
    "titulo": ParagraphStyle("t", base, fontName=FONT_BOLD, fontSize=16, leading=20, alignment=TA_CENTER, spaceAfter=4),
    "sub": ParagraphStyle("s", base, fontName=FONT, fontSize=9.5, textColor=colors.grey, alignment=TA_CENTER, spaceAfter=14),
    "secao": ParagraphStyle("h", base, fontName=FONT_BOLD, fontSize=13, leading=16, spaceBefore=4, spaceAfter=10,
                            textColor=colors.HexColor("#1f4e79")),
    "num": ParagraphStyle("n", base, fontName=FONT_BOLD, fontSize=11, leading=14, spaceAfter=4),
    "texto": ParagraphStyle("x", base, fontName=FONT, fontSize=10.5, leading=14.5, spaceAfter=6),
    "alt": ParagraphStyle("a", base, fontName=FONT, fontSize=10.5, leading=14, leftIndent=14, firstLineIndent=-14, spaceAfter=3),
    "gab": ParagraphStyle("g", base, fontName=FONT_BOLD, fontSize=11, leading=14, textColor=colors.HexColor("#1b7f3b"), spaceAfter=4),
}


def p(text, style):
    return Paragraph(escape(str(text)).replace("\n", "<br/>"), S[style])


def main(src, out):
    with open(src, encoding="utf-8") as f:
        data = json.load(f)
    tema = data.get("tema", "Questões")
    story = [p(f"Questões estilo residência: {tema}", "titulo"),
             p(data.get("fonte", "Responda antes de consultar o gabarito comentado (próxima página)."), "sub")]

    for i, q in enumerate(data["questoes"], 1):
        bloco = [p(f"Questão {i}", "num"), p(q["enunciado"], "texto")]
        bloco += [p(f"{k}) {v}", "alt") for k, v in sorted(q["alternativas"].items())]
        story += [KeepTogether(bloco), Spacer(1, 12)]

    story += [PageBreak(), p("Gabarito comentado", "secao")]
    for i, q in enumerate(data["questoes"], 1):
        bloco = [p(f"Questão {i}: alternativa {q['gabarito']}", "gab"), p(q["comentario"], "texto")]
        bloco += [p(f"{k}) {v}", "alt") for k, v in sorted(q.get("distratores", {}).items())]
        story += [KeepTogether(bloco), Spacer(1, 10)]

    def rodape(canvas, doc):
        canvas.saveState()
        canvas.setFont(FONT, 8)
        canvas.setFillColor(colors.grey)
        canvas.drawCentredString(A4[0] / 2, 1.2 * cm, f"{tema} · página {doc.page}")
        canvas.restoreState()

    SimpleDocTemplate(out, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=2 * cm,
                      bottomMargin=2 * cm, title=f"Questões: {tema}").build(story, onFirstPage=rodape, onLaterPages=rodape)
    print(out)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
