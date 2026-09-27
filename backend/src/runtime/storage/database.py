from __future__ import annotations

import os
from typing import Any

import psycopg
from psycopg import Connection
from psycopg.conninfo import conninfo_to_dict

DATABASE_DSN_ENV = "STUDYDY_DATABASE_DSN"


class DatabaseConfigurationError(RuntimeError):
    """Database configuration is missing or invalid."""


class DatabaseConnectionError(RuntimeError):
    """Database connection failed without including the DSN."""


def resolve_database_dsn(dsn: str | None = None) -> str:
    """Resolve and validate the DSN without exposing the original credential-bearing error."""

    resolved_dsn = dsn if dsn is not None else os.environ.get(DATABASE_DSN_ENV)
    if resolved_dsn is None or not resolved_dsn.strip():
        raise DatabaseConfigurationError("DATABASE_DSN_MISSING")

    try:
        conninfo_to_dict(resolved_dsn)
    except (psycopg.ProgrammingError, TypeError, ValueError):
        raise DatabaseConfigurationError("DATABASE_DSN_INVALID") from None
    return resolved_dsn


def connect_database(
    dsn: str | None = None,
    *,
    autocommit: bool = False,
) -> Connection[Any]:
    """Open PostgreSQL and report a fixed error instead of connection details."""

    resolved_dsn = resolve_database_dsn(dsn)
    try:
        return psycopg.connect(resolved_dsn, autocommit=autocommit)
    except psycopg.Error:
        raise DatabaseConnectionError("DATABASE_CONNECTION_FAILED") from None
