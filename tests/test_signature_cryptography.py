"""PKI sintética exclusiva dos testes: não representa certificação ICP-Brasil real."""

import hashlib
import io
import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi.testclient import TestClient
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.sign import signers
from pyhanko.sign.fields import SigFieldSpec

from consulta.api import create_app
from consulta.signatures import ITI_SOURCE, verify_signed
from tests.conftest import (
    complete_encounter,
    create_encounter,
    make_document,
    patient_client,
    prepare_document,
)


@pytest.fixture
def synthetic_pki(system, tmp_path):
    now = datetime.now(UTC)
    root_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    leaf_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    root_name = x509.Name(
        [x509.NameAttribute(NameOID.COMMON_NAME, "CA SINTETICA DE TESTES - NAO ICP-BRASIL")]
    )
    root = (
        x509.CertificateBuilder()
        .subject_name(root_name)
        .issuer_name(root_name)
        .public_key(root_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=30))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(root_key.public_key()), critical=False
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=None,
                decipher_only=None,
            ),
            critical=True,
        )
        .sign(root_key, hashes.SHA256())
    )
    leaf_name = x509.Name(
        [x509.NameAttribute(NameOID.COMMON_NAME, "Profissional ficticio:" + system.profile["cpf"])]
    )
    leaf = (
        x509.CertificateBuilder()
        .subject_name(leaf_name)
        .issuer_name(root_name)
        .public_key(leaf_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(hours=2))
        .not_valid_after(now + timedelta(days=5))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(leaf_key.public_key()), critical=False
        )
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(root_key.public_key()),
            critical=False,
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=True,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=None,
                decipher_only=None,
            ),
            critical=True,
        )
        .sign(root_key, hashes.SHA256())
    )
    trust = tmp_path / "trust-test"
    trust.mkdir()
    root_der = root.public_bytes(serialization.Encoding.DER)
    (trust / "root.der").write_bytes(root_der)
    (trust / "root.pem").write_bytes(root.public_bytes(serialization.Encoding.PEM))
    (trust / "leaf.pem").write_bytes(leaf.public_bytes(serialization.Encoding.PEM))
    (trust / "leaf.key").write_bytes(
        leaf_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    revocations = (
        x509.CertificateRevocationListBuilder()
        .issuer_name(root_name)
        .last_update(now - timedelta(hours=1))
        .next_update(now + timedelta(days=1))
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(root_key.public_key()), False
        )
        .sign(root_key, hashes.SHA256())
    )
    (trust / "root.crl").write_bytes(revocations.public_bytes(serialization.Encoding.DER))
    manifest = trust / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "test_only": True,
                "source": ITI_SOURCE,
                "reviewed_at": now.isoformat(),
                "roots": [
                    {
                        "file": "root.der",
                        "status": "active",
                        "sha256_der": hashlib.sha256(root_der).hexdigest(),
                    }
                ],
            }
        )
    )
    signer = signers.SimpleSigner.load(
        str(trust / "leaf.key"), str(trust / "leaf.pem"), ca_chain_files=[str(trust / "root.pem")]
    )
    settings = replace(system.settings, trust_dir=trust, trust_manifest=str(manifest))

    def sign(unsigned):
        return signers.sign_pdf(
            IncrementalPdfFileWriter(io.BytesIO(unsigned)),
            signers.PdfSignatureMetadata(field_name="Signature1"),
            signer=signer,
            new_field_spec=SigFieldSpec("Signature1"),
        ).getvalue()

    return settings, sign


def test_actual_cryptographic_signature_checks_and_private_delivery(system, synthetic_pki):
    settings, sign = synthetic_pki
    encounter_id = create_encounter(system)
    complete_encounter(system, encounter_id)
    document_id = make_document(system, encounter_id)
    prepare_document(system, document_id)
    unsigned = system.client.get(f"/api/documents/{document_id}/pdf").content
    signed = sign(unsigned)
    assert signed.startswith(unsigned)
    result = verify_signed(unsigned, signed, system.profile["cpf"], settings)
    assert result["verified"], result
    with TestClient(create_app(settings), base_url=settings.base_url) as client:
        client.cookies.update(system.client.cookies)
        client.headers["X-CSRF-Token"] = system.client.headers["X-CSRF-Token"]
        imported = client.post(
            f"/api/documents/{document_id}/signed-import",
            content=signed,
            headers={"Content-Type": "application/pdf"},
        )
        assert imported.json()["verified"], imported.json()
        assert client.get(f"/api/documents/{document_id}").json()["status"] == "signed"
        assert (
            client.post(
                f"/api/documents/{document_id}/transition",
                json={"revision": 3, "target": "delivered", "medical_review_confirmed": True},
            ).status_code
            == 200
        )
    patient, invitation, _ = patient_client(system, encounter_id)
    delivered = patient.get(f"/api/documents/{document_id}/pdf")
    assert delivered.status_code == 200 and delivered.content == signed
    assert hashlib.sha256(delivered.content).hexdigest() == result["sha256"]
    system.client.delete("/api/invitations/" + invitation["id"])
    assert patient.get(f"/api/documents/{document_id}/pdf").status_code == 401


def test_signature_does_not_accept_wrong_physician_or_unsigned_appendix(system, synthetic_pki):
    settings, sign = synthetic_pki
    encounter_id = create_encounter(system)
    complete_encounter(system, encounter_id)
    document_id = make_document(system, encounter_id)
    prepare_document(system, document_id)
    unsigned = system.client.get(f"/api/documents/{document_id}/pdf").content
    signed = sign(unsigned)
    assert not verify_signed(unsigned, signed, "00000000000", settings)["verified"]
    assert not verify_signed(
        unsigned, signed + b"\n%alteracao-nao-assinada", system.profile["cpf"], settings
    )["verified"]


def test_signed_file_is_not_trusted_without_configured_pki_or_revocation(system, synthetic_pki):
    settings, sign = synthetic_pki
    encounter_id = create_encounter(system)
    complete_encounter(system, encounter_id)
    document_id = make_document(system, encounter_id)
    prepare_document(system, document_id)
    unsigned = system.client.get(f"/api/documents/{document_id}/pdf").content
    signed = sign(unsigned)
    assert not verify_signed(unsigned, signed, system.profile["cpf"], system.settings)["verified"]
    assert not verify_signed(
        unsigned, signed, system.profile["cpf"], replace(settings, revocation_required=False)
    )["verified"]
    assert not verify_signed(
        unsigned,
        signed,
        system.profile["cpf"],
        replace(settings, environment="production", base_url="https://testserver"),
    )["verified"]
