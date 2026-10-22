from __future__ import annotations

import io
import warnings

from PIL import Image
from pypdf import PdfReader


def validate_attachment(data: bytes, mime: str):
    """Validação estrutural limitada; não substitui antivírus ou análise de conteúdo."""
    try:
        if mime == "application/pdf" and data.startswith(b"%PDF-"):
            reader = PdfReader(io.BytesIO(data), strict=True)
            if reader.is_encrypted or not 1 <= len(reader.pages) <= 500:
                raise ValueError("PDF protegido ou com quantidade de páginas não suportada")
            catalog = reader.trailer["/Root"]
            names = catalog.get("/Names")
            if (
                catalog.get("/OpenAction")
                or catalog.get("/AA")
                or (names and names.get_object().get("/JavaScript"))
            ):
                raise ValueError("PDF com ações automáticas não é aceito")
            return
        expected = {"image/png": "PNG", "image/jpeg": "JPEG"}.get(mime)
        if expected:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(data)) as image:
                    if image.format != expected or image.width * image.height > 25_000_000:
                        raise ValueError("Formato ou dimensões de imagem não suportados")
                    image.verify()
            return
    except Exception as exc:
        # Erros de parsers podem reproduzir o conteúdo do anexo.
        raise ValueError(
            "Arquivo inválido, protegido, ativo ou fora dos limites suportados"
        ) from exc
    raise ValueError("Envie um PDF, PNG ou JPEG válido e compatível com seu conteúdo")
