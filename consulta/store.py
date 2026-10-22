from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from cryptography.fernet import Fernet

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
 profile BLOB NOT NULL, disabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS patients (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), data BLOB NOT NULL,
 created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS encounters (
 id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id),
 owner_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'intake',
 intake BLOB NOT NULL, draft BLOB NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
 intake_revision INTEGER NOT NULL DEFAULT 0, intake_submitted_at REAL,
 started_at REAL, ended_at REAL, created_at REAL NOT NULL, finalized_at REAL
);
CREATE INDEX IF NOT EXISTS encounter_owner ON encounters(owner_id,created_at);
CREATE TABLE IF NOT EXISTS versions (
 id TEXT PRIMARY KEY, encounter_id TEXT NOT NULL REFERENCES encounters(id),
 kind TEXT NOT NULL, revision INTEGER NOT NULL, actor TEXT NOT NULL,
 payload BLOB NOT NULL, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS invitations (
 id TEXT PRIMARY KEY, encounter_id TEXT NOT NULL REFERENCES encounters(id),
 token_hash TEXT UNIQUE NOT NULL, expires_at REAL NOT NULL, revoked_at REAL,
 used_at REAL, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT, role TEXT NOT NULL,
 encounter_id TEXT, invitation_id TEXT, expires_at REAL NOT NULL, last_seen REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
 id TEXT PRIMARY KEY, encounter_id TEXT NOT NULL REFERENCES encounters(id),
 kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', revision INTEGER NOT NULL DEFAULT 0,
 payload BLOB NOT NULL, pdf_id TEXT, signed_file_id TEXT, unsigned_sha256 TEXT,
 signed_sha256 TEXT, verification BLOB, created_at REAL NOT NULL, delivered_at REAL
);
CREATE TABLE IF NOT EXISTS files (
 id TEXT PRIMARY KEY, encounter_id TEXT NOT NULL REFERENCES encounters(id),
 purpose TEXT NOT NULL, metadata BLOB NOT NULL, sha256 TEXT NOT NULL,
 created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS favorites (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, payload BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS favorite_confirmations (
 encounter_id TEXT NOT NULL, medication_id TEXT NOT NULL, favorite_id TEXT NOT NULL,
 actor TEXT NOT NULL, created_at REAL NOT NULL,
 PRIMARY KEY(encounter_id,medication_id,favorite_id)
);
CREATE TABLE IF NOT EXISTS addenda (
 id TEXT PRIMARY KEY, encounter_id TEXT NOT NULL REFERENCES encounters(id),
 actor TEXT NOT NULL, payload BLOB NOT NULL, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
 reference TEXT NOT NULL, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS login_limits (
 key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, first_attempt REAL NOT NULL
);
PRAGMA user_version=1;
"""


class Conflict(Exception):
    pass


class Store:
    def __init__(self, directory: Path, key: str):
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)
        self.directory.chmod(0o700)
        self.files_dir = directory / "files"
        self.files_dir.mkdir(exist_ok=True)
        self.files_dir.chmod(0o700)
        self.path = directory / "consulta.sqlite3"
        self.cipher = Fernet(key.encode())
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(SCHEMA)
        self.path.chmod(0o600)

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.path, timeout=15)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def encode(self, value) -> bytes:
        return self.cipher.encrypt(json.dumps(value, ensure_ascii=False, default=str).encode())

    def decode(self, value):
        return json.loads(self.cipher.decrypt(value))

    def one(self, sql, args=()):
        with self.connect() as conn:
            row = conn.execute(sql, args).fetchone()
            return dict(row) if row else None

    def rows(self, sql, args=()):
        with self.connect() as conn:
            return [dict(row) for row in conn.execute(sql, args).fetchall()]

    def execute(self, sql, args=()):
        with self.connect() as conn:
            return conn.execute(sql, args).rowcount

    def audit(self, actor, action, reference="", conn=None):
        args = (str(uuid4()), actor, action, reference, time.time())
        sql = "INSERT INTO audit VALUES (?,?,?,?,?)"
        if conn is not None:
            conn.execute(sql, args)
        else:
            self.execute(sql, args)

    def version(self, encounter_id, kind, revision, actor, payload, conn):
        conn.execute(
            "INSERT INTO versions VALUES (?,?,?,?,?,?,?)",
            (
                str(uuid4()),
                encounter_id,
                kind,
                revision,
                actor,
                self.encode(payload),
                time.time(),
            ),
        )

    def file(
        self, encounter_id, data: bytes, filename: str, mime: str, purpose="attachment", conn=None
    ):
        file_id = str(uuid4())
        path = self.files_dir / file_id
        path.write_bytes(self.cipher.encrypt(data))
        path.chmod(0o600)
        metadata = self.encode({"filename": filename[:150], "mime": mime, "size": len(data)})
        values = (
            file_id,
            encounter_id,
            purpose,
            metadata,
            hashlib.sha256(data).hexdigest(),
            time.time(),
        )
        if conn is None:
            self.execute("INSERT INTO files VALUES (?,?,?,?,?,?)", values)
        else:
            conn.execute("INSERT INTO files VALUES (?,?,?,?,?,?)", values)
        return file_id

    def file_bytes(self, file_id):
        # Somente IDs previamente carregados do banco, nunca nomes fornecidos pelo visitante.
        if len(file_id) != 36 or str(__import__("uuid").UUID(file_id)) != file_id:
            raise ValueError("Arquivo inválido")
        return self.cipher.decrypt((self.files_dir / file_id).read_bytes())
