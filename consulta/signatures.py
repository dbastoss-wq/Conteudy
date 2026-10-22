from __future__ import annotations

import hashlib
import io
import json
import re
from datetime import UTC, datetime, timedelta

from asn1crypto import crl, pem, x509
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko_certvalidator import ValidationContext
from pypdf import PdfReader
from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject, StreamObject

from consulta.config import Settings

ITI_SOURCE = "https://www.gov.br/iti/pt-br/assuntos/repositorio/repositorio-ac-raiz"


def page_fingerprint(data: bytes):
    reader = PdfReader(io.BytesIO(data), strict=True)
    if reader.is_encrypted or not 1 <= len(reader.pages) <= 500:
        raise ValueError("PDF criptografado ou com quantidade de páginas não suportada")
    catalog = reader.trailer["/Root"]
    if catalog.get("/OpenAction") or catalog.get("/AA") or catalog.get("/Names"):
        raise ValueError("Ações ou anexos ativos não são permitidos")
    count = 0

    def canonical(obj, depth=0):
        nonlocal count
        count += 1
        if depth > 30 or count > 30000:
            raise ValueError("Estrutura PDF excede os limites de verificação")
        if isinstance(obj, IndirectObject):
            obj = obj.get_object()
        if isinstance(obj, StreamObject):
            return {
                "stream": hashlib.sha256(obj.get_data()).hexdigest(),
                "attributes": {
                    str(k): canonical(v, depth + 1)
                    for k, v in obj.items()
                    if str(k) not in {"/Length", "/Filter", "/DecodeParms", "/Parent", "/P"}
                },
            }
        if isinstance(obj, DictionaryObject):
            return {
                str(k): canonical(v, depth + 1)
                for k, v in obj.items()
                if str(k) not in {"/Parent", "/P"}
            }
        if isinstance(obj, (ArrayObject, list)):
            return [canonical(v, depth + 1) for v in obj]
        if isinstance(obj, bytes):
            return {"bytes": obj.hex()}
        return str(obj)

    pages = []
    for page in reader.pages:
        for ref in page.get("/Annots", []):
            annotation = ref.get_object()
            parent = annotation.get("/Parent")
            field_type = annotation.get("/FT") or (
                parent.get_object().get("/FT") if parent else None
            )
            rect = [float(v) for v in annotation.get("/Rect", [0, 0, 0, 0])]
            if field_type != "/Sig" or annotation.get("/A") or annotation.get("/AA"):
                raise ValueError("Anotação não relacionada à assinatura")
            if rect[2] > rect[0] and rect[3] > rect[1]:
                raise ValueError(
                    "Este verificador exige assinatura invisível para preservar o conteúdo visual"
                )
        pages.append(
            {
                key: canonical(page.get(key))
                for key in (
                    "/Contents",
                    "/Resources",
                    "/MediaBox",
                    "/CropBox",
                    "/Rotate",
                    "/UserUnit",
                )
            }
        )
    return hashlib.sha256(json.dumps(pages, sort_keys=True).encode()).hexdigest()


def signer_cpf(certificate):
    alternatives = certificate.subject_alt_name_value
    if alternatives:
        for name in alternatives:
            if name.name == "other_name" and name.chosen["type_id"].dotted == "2.16.76.1.3.1":
                raw = name.chosen["value"].native
                if isinstance(raw, bytes):
                    raw = raw.decode("utf-8", errors="strict")
                digits = re.sub(r"\D", "", str(raw))
                if len(digits) >= 19:
                    return digits[8:19]
    # Alguns certificados também identificam o CPF no CN. Só aceitar o campo delimitado.
    common_name = str(certificate.subject.native.get("common_name", ""))
    match = re.search(r"(?:^|:)\s*(\d{11})\s*$", common_name)
    return match.group(1) if match else None


def trust_context(settings: Settings):
    if not settings.trust_manifest or not settings.revocation_required:
        raise ValueError("Configure raízes ICP-Brasil conferidas e revogação obrigatória")
    manifest = json.loads(__import__("pathlib").Path(settings.trust_manifest).read_text())
    if manifest.get("test_only") and settings.environment != "test":
        raise ValueError("Raízes sintéticas de teste não podem ser usadas neste ambiente")
    if manifest.get("source") != ITI_SOURCE:
        raise ValueError("Manifesto sem referência ao repositório oficial ITI")
    reviewed = datetime.fromisoformat(manifest["reviewed_at"].replace("Z", "+00:00"))
    if reviewed.tzinfo is None or not timedelta(0) <= datetime.now(UTC) - reviewed <= timedelta(
        days=90
    ):
        raise ValueError("Revisão do repositório deve ter ocorrido nos últimos 90 dias")
    roots = []
    for item in manifest["roots"]:
        name = item["file"]
        if __import__("pathlib").Path(name).name != name or item.get("status") != "active":
            raise ValueError("Raiz não aprovada no manifesto")
        data = (settings.trust_dir / name).read_bytes()
        if pem.detect(data):
            data = pem.unarmor(data)[2]
        if hashlib.sha256(data).hexdigest() != item["sha256_der"]:
            raise ValueError("Hash da raiz difere do manifesto conferido")
        roots.append(x509.Certificate.load(data))
    if not roots:
        raise ValueError("Nenhuma raiz ICP-Brasil configurada")
    crls = []
    for path in settings.trust_dir.glob("*.crl"):
        data = path.read_bytes()
        crls.append(crl.CertificateList.load(pem.unarmor(data)[2] if pem.detect(data) else data))
    # Consulta AIA/OCSP fornecida pelo certificado não pode acessar a rede interna.
    # CRLs são provisionadas pelo administrador e a ausência/expiração falha de modo fechado.
    return ValidationContext(
        trust_roots=roots, crls=crls, allow_fetching=False, revocation_mode="hard-fail"
    )


def verify_signed(unsigned: bytes, signed: bytes, doctor_cpf: str, settings: Settings):
    result = {
        "verified": False,
        "status": "not_verified",
        "checked_at": datetime.now(UTC).isoformat(),
        "sha256": hashlib.sha256(signed).hexdigest(),
        "reason": "",
    }
    try:
        if not signed.startswith(unsigned):
            raise ValueError("A assinatura deve ser incremental sobre o PDF final exportado")
        if page_fingerprint(unsigned) != page_fingerprint(signed):
            raise ValueError("O conteúdo visual difere do documento final aprovado")
        reader = PdfFileReader(io.BytesIO(signed), strict=True)
        signatures = reader.embedded_signatures
        if len(signatures) != 1:
            raise ValueError(
                "É necessária uma assinatura PDF verificável; imagem, nome e QR não bastam"
            )
        signature = signatures[0]
        expected_cpf = re.sub(r"\D", "", doctor_cpf)
        if len(expected_cpf) != 11 or signer_cpf(signature.signer_cert) != expected_cpf:
            raise ValueError("O certificado não corresponde ao CPF do médico")
        context = trust_context(settings)
        status = validate_pdf_signature(
            signature, signer_validation_context=context, ts_validation_context=context
        )
        if not status.bottom_line or status.coverage.name != "ENTIRE_FILE":
            raise ValueError(
                "Integridade, cadeia ICP-Brasil, revogação ou cobertura não puderam ser confirmadas"
            )
        result.update(
            verified=True,
            status="verified",
            reason="Integridade, cadeia configurada, revogação, titular e conteúdo conferidos",
        )
    except ValueError as exc:
        result["reason"] = str(exc)
    except Exception:
        # Erros de bibliotecas podem conter dados do certificado: não os expor ou registrar.
        result["reason"] = (
            "A verificação técnica não pôde ser concluída. Confira PDF, cadeia e CRLs."
        )
    return result
