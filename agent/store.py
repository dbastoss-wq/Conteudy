from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS contacts (
    email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, sender TEXT NOT NULL,
    sender_name TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
    internet_id TEXT NOT NULL, reference_ids TEXT NOT NULL, headers TEXT NOT NULL,
    received_at REAL NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
    reason TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS outbox (
    message_id TEXT PRIMARY KEY REFERENCES messages(id), outgoing_id TEXT UNIQUE NOT NULL,
    recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
    status TEXT NOT NULL, provider_id TEXT, attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at REAL NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL, updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
    invitee_uri TEXT PRIMARY KEY, event_uri TEXT NOT NULL, email TEXT NOT NULL,
    name TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
    timezone TEXT NOT NULL, status TEXT NOT NULL, cancel_url TEXT, reschedule_url TEXT,
    previous_invitee_uri TEXT, next_invitee_uri TEXT, source_updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bookings_contact ON bookings(email, starts_at);
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at REAL NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '', created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at REAL NOT NULL,
    kind TEXT NOT NULL, reference TEXT NOT NULL, detail TEXT NOT NULL
);
PRAGMA user_version = 1;
"""


class Store:
    def __init__(self, path: str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(SCHEMA)

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    @contextmanager
    def exclusive_runtime(self):
        # Uma instância por banco: protege também contra dois workers do Uvicorn.
        import fcntl

        with self.path.with_suffix(".lock").open("a") as lock:
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise RuntimeError(
                    "Já existe um agente usando este banco; use um único worker"
                ) from exc
            try:
                yield
            finally:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)

    def rows(self, sql: str, params: tuple = ()) -> list[dict]:
        with self.connect() as conn:
            return [dict(row) for row in conn.execute(sql, params).fetchall()]

    def one(self, sql: str, params: tuple = ()) -> dict | None:
        rows = self.rows(sql, params)
        return rows[0] if rows else None

    def execute(self, sql: str, params: tuple = ()) -> int:
        with self.connect() as conn:
            return conn.execute(sql, params).rowcount

    def get(self, key: str, default: str = "") -> str:
        row = self.one("SELECT value FROM metadata WHERE key=?", (key,))
        return row["value"] if row else default

    def set(self, key: str, value: str) -> None:
        self.execute("INSERT OR REPLACE INTO metadata VALUES (?, ?)", (key, value))

    def audit(self, kind: str, reference: str = "", detail: str = "") -> None:
        self.execute(
            "INSERT INTO audit(created_at,kind,reference,detail) VALUES (?,?,?,?)",
            (time.time(), kind, reference, detail),
        )

    def add_message(self, message) -> bool:
        with self.connect() as conn:
            result = conn.execute(
                """INSERT OR IGNORE INTO messages
                (id,thread_id,sender,sender_name,subject,body,internet_id,reference_ids,
                 headers,received_at) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    message.id,
                    message.thread_id,
                    message.sender,
                    message.sender_name,
                    message.subject,
                    message.body,
                    message.internet_id,
                    message.reference_ids,
                    json.dumps(message.headers),
                    message.received_at,
                ),
            )
            if message.sender:
                conn.execute(
                    "INSERT OR IGNORE INTO contacts VALUES (?,?,?)",
                    (message.sender.lower(), message.sender_name, time.time()),
                )
            return result.rowcount == 1

    def add_notification(self, key: str, payload: dict) -> bool:
        return (
            self.execute(
                "INSERT OR IGNORE INTO notifications(id,payload,created_at) VALUES (?,?,?)",
                (key, json.dumps(payload, ensure_ascii=False), time.time()),
            )
            == 1
        )

    def save_booking(self, booking: dict) -> None:
        booking = dict(booking)
        with self.connect() as conn:
            old = conn.execute(
                "SELECT * FROM bookings WHERE invitee_uri=?", (booking["invitee_uri"],)
            ).fetchone()
            # Um invitee cancelado nunca volta a ativo: reagendar cria outro invitee.
            if old and (
                (old["status"] != "active" and booking["status"] == "active")
                or old["source_updated_at"] > booking["source_updated_at"]
            ):
                return
            successor = conn.execute(
                "SELECT invitee_uri FROM bookings WHERE previous_invitee_uri=? LIMIT 1",
                (booking["invitee_uri"],),
            ).fetchone()
            following = (
                successor["invitee_uri"]
                if successor
                else (booking.get("next_invitee_uri") or (old["next_invitee_uri"] if old else None))
            )
            if following:
                booking["status"] = "rescheduled"
                booking["next_invitee_uri"] = following
            columns = ",".join(booking)
            placeholders = ",".join("?" for _ in booking)
            conn.execute(
                f"INSERT OR REPLACE INTO bookings ({columns}) VALUES ({placeholders})",
                tuple(booking.values()),
            )
            conn.execute(
                "INSERT OR IGNORE INTO contacts VALUES (?,?,?)",
                (booking["email"], booking["name"], time.time()),
            )
            previous = booking.get("previous_invitee_uri")
            if previous:
                conn.execute(
                    "UPDATE bookings SET status='rescheduled',next_invitee_uri=? WHERE invitee_uri=?",
                    (booking["invitee_uri"], previous),
                )

    def recover(self) -> None:
        self.execute("UPDATE outbox SET status='uncertain' WHERE status='sending'")
        self.execute("UPDATE notifications SET status='pending' WHERE status='processing'")
