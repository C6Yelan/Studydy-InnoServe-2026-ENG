# Installation and operation

[Documentation](../README.md) · [Testing](testing.md) · [Limitations](limitations.md)

Run commands from this repository root. Container images provide Python, Node, LibreOffice, fonts, and Bubblewrap.

## Host requirements

- x86_64 Linux containers or WSL2, Docker Engine 28.3 or later, and Docker Compose.
- Unprivileged user namespaces and a filesystem supporting Linux ownership and permissions.
- A separately configured semantic model service. Native extraction and conversion do not require a local GPU.

The backend uses the supplied [seccomp profile](../ops/docker/bubblewrap-seccomp.json). It refuses to start if the sandbox is unavailable.

## Configuration

```bash
cp .env.example .env
chmod 600 .env
```

Set POSTGRES_PASSWORD and the model endpoint. Never commit .env, credentials, or persistent data.

| Variable | Purpose |
| --- | --- |
| COMPOSE_PROJECT_NAME | Unique deployment name; default studydy-competition-eng |
| STUDYDY_PORT | Frontend port; default 4177 |
| STUDYDY_PUBLIC_ORIGIN | Complete browser origin; default http://127.0.0.1:4177 |
| STUDYDY_SECURE_COOKIE | false for local HTTP, true for HTTPS |
| STUDYDY_DATA_DIR | Persistent root; default ./.studydy-product/compose |
| STUDYDY_UID / STUDYDY_GID | Data owner; default 1000 |
| POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD | This deployment's database and credentials |
| STUDYDY_SEMANTIC_BASE_URL | Model origin without /v1, credentials, query, or fragment |
| VLLM_API_KEY | Optional model Bearer token |
| COMPOSE_PROFILES | Empty for direct HTTP/HTTPS; ssh for the optional bridge |

Keep the English deployment's database, ports, Compose project, and data separate from other installations. Inside a container, 127.0.0.1 refers to that container. A host service reached through host.docker.internal must listen on an accessible interface.

## Build and run

```bash
docker compose build
docker compose up -d --wait
docker compose ps
```

Open http://127.0.0.1:4177. Nginx proxies /v1 to the backend; the [OpenAPI document](http://127.0.0.1:4177/v1/openapi.json) describes its contracts. The [runtime lock](../local_ai/runtime-lock.json) defines model identity and request settings.

Initialization creates directories and permissions. The backend verifies migration checksums, applies pending migrations, and starts the API and worker. It does not reset existing accounts or data. Login, saved-content reads, upload, and conversion do not need the semantic service.

```bash
docker compose logs --tail 100 backend
docker compose down
```

down preserves mounted data. Public hosting requires TLS, a matching origin, and Secure cookies.

## Optional SSH bridge

For a shell-based model connection:

```dotenv
COMPOSE_PROFILES=ssh
STUDYDY_SEMANTIC_BASE_URL=http://model-bridge:18000
STUDYDY_SSH_HOST=user@host
STUDYDY_SSH_PORT=22
STUDYDY_SSH_MODEL_PORT=18000
```

Place model_key and verified known_hosts under STUDYDY_DATA_DIR/ssh with mode 0600 and the configured owner. Alternatively, provide absolute paths through STUDYDY_SSH_KEY_FILE and STUDYDY_SSH_KNOWN_HOSTS_FILE. Only those files are mounted read-only; unknown host keys are not accepted automatically.

The remote host needs an interactive POSIX shell and Python 3. The bridge forwards fixed model routes, reads VLLM_API_KEY remotely, and does not replay requests with uncertain outcomes. Its local health check does not call the model.

Stop services with the existing configuration before changing connection mode. Endpoint overrides never rewrite saved runtime snapshots or artifact hashes.

## Data, backup, and restore

STUDYDY_DATA_DIR contains artifacts and postgres. Store .env and SSH credentials securely and separately from public reports.

1. Wait for active work to finish and stop product writes. Use pg_dump and save the matching artifact store, private configuration, permissions, and code/image version. Copying live PGDATA is not a database backup.
2. Restore to a clearly named empty product recovery database with matching PostgreSQL and code versions. Use pg_restore --no-owner --no-acl --exit-on-error --single-transaction; restore artifacts to an independent private directory.
3. Verify rows, file hashes, permissions, and the migration ledger before switching. Preserve the original deployment until recovery is verified. Do not overwrite the active database, reset its ledger, change applied checksums, or substitute a test database.

The English database starts fresh. Do not import Chinese-edition product snapshots or relabel their provenance.

## Verification

Use [isolated tests](testing.md) for checks that require no model. The explicit runtime verification command contacts the configured model service and requires authorization:

```bash
docker compose exec backend /app/backend/.venv/bin/python -m runtime.local_runtime verify
```

For startup failures, check backend/init logs, data permissions, PostgreSQL, and sandbox support. For AI failures, check the endpoint, runtime lock, and enabled bridge configuration. Do not print secret-bearing Compose configuration or treat service health as content-quality acceptance.
