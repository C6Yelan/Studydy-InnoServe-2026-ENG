from __future__ import annotations

import base64
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from hashlib import scrypt, sha256
import re
import secrets
from uuid import UUID, uuid4

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from .storage.database import DatabaseConfigurationError
from .storage.tables import Learner, LearnerSession, database_session

IDLE_LIFETIME = timedelta(days=7)
ABSOLUTE_LIFETIME = timedelta(days=30)
_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")
_EMAIL_ADDRESS = TypeAdapter(EmailStr)
_CURRENT_SCRYPT = (2**14, 8, 5)
_SCRYPT_MAXMEM = {
    _CURRENT_SCRYPT: 32 * 1024 * 1024,
    (2**17, 8, 1): 256 * 1024 * 1024,
}


class SessionError(RuntimeError):
    """Session storage failed; messages contain no token, DSN, or SQL."""


@dataclass(frozen=True)
class TrustedLearner:
    learner_id: UUID


@dataclass(frozen=True)
class CreatedSession:
    learner_id: UUID
    raw_token: str = field(repr=False)


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _encode_token(token_bytes: bytes) -> str:
    return base64.urlsafe_b64encode(token_bytes).rstrip(b"=").decode("ascii")


def _token_digest(raw_token: str | None) -> bytes | None:
    if not isinstance(raw_token, str) or _TOKEN_PATTERN.fullmatch(raw_token) is None:
        return None
    try:
        token_bytes = base64.urlsafe_b64decode(raw_token + "=")
    except (ValueError, UnicodeError):
        return None
    if len(token_bytes) != 32 or _encode_token(token_bytes) != raw_token:
        return None
    return sha256(token_bytes).digest()


def _add_session(session: Session, learner_id: UUID) -> CreatedSession:
    """Create a login session for the specified learner."""
    token_bytes = secrets.token_bytes(32)
    now = _utc_now()
    session.add(LearnerSession(
        session_id=uuid4(), learner_id=learner_id,
        token_sha256=sha256(token_bytes).digest(), created_at=now,
        idle_expires_at=now + IDLE_LIFETIME,
        absolute_expires_at=now + ABSOLUTE_LIFETIME,
        revoked_at=None, updated_at=now,
    ))
    return CreatedSession(learner_id=learner_id, raw_token=_encode_token(token_bytes))


def _credentials(email: str, password: str) -> str:
    # EmailStr validates syntax and normalizes Unicode/domain names without DNS lookup.
    # Login identifiers are case-insensitive; mailbox ownership is not verified.
    try:
        email = _EMAIL_ADDRESS.validate_python(email).lower()
    except ValidationError:
        raise SessionError("REQUEST_INVALID") from None
    if not isinstance(password, str) or not 15 <= len(password) <= 128:
        raise SessionError("REQUEST_INVALID")
    return email


def _password_digest(password: str, salt: bytes, profile: tuple[int, int, int] = _CURRENT_SCRYPT) -> bytes:
    # Default hashing uses about 16 MiB; verification uses saved parameters without truncating passwords.
    n, r, p = profile
    return scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p,
                  maxmem=_SCRYPT_MAXMEM[profile], dklen=32)


def _password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    n, r, p = _CURRENT_SCRYPT
    return f"scrypt${n}${r}${p}${salt.hex()}${_password_digest(password, salt).hex()}"


def register_account(email: str, password: str, *, dsn: str | None = None) -> CreatedSession:
    """Create the account and its login session in one transaction."""
    email = _credentials(email, password)
    password_hash = _password_hash(password)
    learner_id = uuid4()
    try:
        with database_session(dsn) as session:
            session.add(Learner(learner_id=learner_id, created_at=_utc_now(),
                                email=email, password_hash=password_hash))
            session.flush()
            created = _add_session(session, learner_id)
    except IntegrityError as error:
        if getattr(error.orig, "sqlstate", None) == "23505":
            raise SessionError("ACCOUNT_UNAVAILABLE") from None
        raise SessionError("SESSION_CREATE_FAILED") from None
    except (DatabaseConfigurationError, SQLAlchemyError):
        raise SessionError("SESSION_CREATE_FAILED") from None
    return created


def login_account(email: str, password: str, *, dsn: str | None = None) -> CreatedSession:
    """Verify the password and create a session without reviving expired tokens."""
    email = _credentials(email, password)
    try:
        with database_session(dsn) as session:
            learner = session.scalar(select(Learner).where(Learner.email == email))
            # Hash even for missing accounts to reduce account-existence timing differences.
            stored = learner.password_hash if learner is not None else None
            parts = stored.split("$") if stored else None
            try:
                profile = tuple(map(int, parts[1:4])) if parts else _CURRENT_SCRYPT
                if parts and (len(parts) != 6 or parts[0] != "scrypt" or profile not in _SCRYPT_MAXMEM):
                    raise ValueError
                salt = bytes.fromhex(parts[4]) if parts else bytes(16)
            except (TypeError, ValueError):
                raise SessionError("INVALID_CREDENTIALS") from None
            digest = _password_digest(password, salt, profile)
            if stored is None or not secrets.compare_digest(digest.hex(), parts[5]):
                raise SessionError("INVALID_CREDENTIALS")
            if profile != _CURRENT_SCRYPT:
                learner.password_hash = _password_hash(password)
            created = _add_session(session, learner.learner_id)
    except (DatabaseConfigurationError, SQLAlchemyError):
        raise SessionError("SESSION_STORAGE_FAILED") from None
    return created


def resolve_session(
    raw_token: str | None,
    *,
    dsn: str | None = None,
) -> TrustedLearner | None:
    """Resolve a valid exact token without extending the session."""

    token_digest = _token_digest(raw_token)
    if token_digest is None:
        return None
    now = _utc_now()
    try:
        with database_session(dsn) as session:
            learner_id = session.scalar(
                select(LearnerSession.learner_id)
                .join(Learner, Learner.learner_id == LearnerSession.learner_id)
                .where(
                    LearnerSession.token_sha256 == token_digest,
                    LearnerSession.revoked_at.is_(None),
                    LearnerSession.idle_expires_at > now,
                    LearnerSession.absolute_expires_at > now,
                )
            )
    except (DatabaseConfigurationError, SQLAlchemyError):
        raise SessionError("SESSION_STORAGE_FAILED") from None
    if learner_id is None:
        return None
    return TrustedLearner(learner_id=learner_id)


def refresh_session(
    raw_token: str | None,
    *,
    dsn: str | None = None,
) -> TrustedLearner | None:
    """Lock and revalidate the session before extending its idle deadline."""

    token_digest = _token_digest(raw_token)
    if token_digest is None:
        return None
    try:
        with database_session(dsn) as session:
            stored = session.scalar(
                select(LearnerSession)
                .where(LearnerSession.token_sha256 == token_digest)
                .with_for_update()
            )
            if stored is None:
                return None
            now = _utc_now()
            if stored.revoked_at is not None:
                return None
            if stored.idle_expires_at <= now or stored.absolute_expires_at <= now:
                return None
            stored.idle_expires_at = min(
                max(stored.idle_expires_at, now + IDLE_LIFETIME),
                stored.absolute_expires_at,
            )
            stored.updated_at = now
            learner_id = stored.learner_id
    except (DatabaseConfigurationError, SQLAlchemyError):
        raise SessionError("SESSION_STORAGE_FAILED") from None
    return TrustedLearner(learner_id=learner_id)


def revoke_session(
    raw_token: str | None,
    *,
    dsn: str | None = None,
) -> bool:
    """Revoke the exact token idempotently without restoring access."""

    token_digest = _token_digest(raw_token)
    if token_digest is None:
        return False
    try:
        with database_session(dsn) as session:
            stored = session.scalar(
                select(LearnerSession)
                .where(LearnerSession.token_sha256 == token_digest)
                .with_for_update()
            )
            if stored is None:
                return False
            if stored.revoked_at is None:
                now = _utc_now()
                stored.revoked_at = now
                stored.updated_at = now
    except (DatabaseConfigurationError, SQLAlchemyError):
        raise SessionError("SESSION_STORAGE_FAILED") from None
    return True
