from __future__ import annotations

import hashlib
import json
import re
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from cryptography.fernet import Fernet

from consulta.store import Store


def create_backup(store: Store, target: Path):
    if target.exists():
        raise ValueError("O arquivo de destino já existe")
    target.parent.mkdir(parents=True, exist_ok=True)
    manifest = {"format": 1, "created_at": datetime.now(UTC).isoformat(), "files": {}}
    with tempfile.TemporaryDirectory(dir=store.directory) as temp:
        snapshot = Path(temp) / "database.sqlite3"
        with store.connect() as source, sqlite3.connect(snapshot) as destination:
            source.backup(destination)
        snapshot.chmod(0o600)
        with sqlite3.connect(snapshot) as db:
            file_ids = [row[0] for row in db.execute("SELECT id FROM files")]
        entries = {"database.sqlite3": snapshot.read_bytes()}
        entries.update(
            {"files/" + file_id: (store.files_dir / file_id).read_bytes() for file_id in file_ids}
        )
        with zipfile.ZipFile(target, "x", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, data in entries.items():
                archive.writestr(name, data)
                manifest["files"][name] = hashlib.sha256(data).hexdigest()
            archive.writestr("manifest.enc", store.cipher.encrypt(json.dumps(manifest).encode()))
    target.chmod(0o600)
    store.audit("administrator", "backup_created")


def restore_backup(archive_path: Path, destination: Path, key: str):
    if destination.exists():
        raise ValueError("Restaure em um diretório novo para preservar os dados existentes")
    cipher = Fernet(key.encode())
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Backup contém entradas repetidas")
        if any(
            not re.fullmatch(r"database\.sqlite3|manifest\.enc|files/[a-f0-9-]{36}", name)
            for name in names
        ):
            raise ValueError("Backup contém caminhos não permitidos")
        if sum(item.file_size for item in archive.infolist()) > 2 * 1024**3:
            raise ValueError("Backup excede o limite desta ferramenta")
        manifest = json.loads(cipher.decrypt(archive.read("manifest.enc")))
        if manifest.get("format") != 1 or set(manifest["files"]) != set(names) - {"manifest.enc"}:
            raise ValueError("Manifesto incompatível")
        for name, expected in manifest["files"].items():
            if hashlib.sha256(archive.read(name)).hexdigest() != expected:
                raise ValueError("Integridade do backup não confirmada")
        destination.mkdir(parents=True)
        destination.chmod(0o700)
        try:
            (destination / "files").mkdir(mode=0o700)
            for name in manifest["files"]:
                path = destination / ("consulta.sqlite3" if name == "database.sqlite3" else name)
                path.write_bytes(archive.read(name))
                path.chmod(0o600)
            restored = Store(destination, key)
            with restored.connect() as conn:
                if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("Banco restaurado não passou na verificação")
                conn.execute("DELETE FROM sessions")
            for row in restored.rows("SELECT data FROM patients"):
                restored.decode(row["data"])
            for row in restored.rows("SELECT id,sha256 FROM files"):
                if hashlib.sha256(restored.file_bytes(row["id"])).hexdigest() != row["sha256"]:
                    raise ValueError("Arquivo restaurado não passou na verificação")
            restored.audit("administrator", "backup_restored_sessions_invalidated")
        except Exception:
            shutil.rmtree(destination)
            raise
    return restored
