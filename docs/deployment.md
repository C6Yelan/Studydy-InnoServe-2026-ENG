# English InnoServe public deployment

The canonical repository is Studydy-InnoServe-2026-ENG, branch main. Use this
checkout's compose.yaml plus compose.tunnel.yaml with project studydy-competition-eng.
Never use the main or Chinese edition's database, artifacts, connector, or token.

- Public origin: https://innoserve-en.studydy.net; Secure cookies enabled.
- Maintenance: 127.0.0.1:4177 only. Do not allow localhost mutations against the HTTPS origin.
- The connector joins only this project's edge network. Frontend provides the
  innoserve-en-frontend alias there, matching http://innoserve-en-frontend:8080.
- Frontend retains application membership; backend/model networks remain unchanged.
  The database network remains internal, with no host publishing.
- The token file is /home/jerry/.config/studydy/cloudflared-innoserve-en-token,
  outside all repositories/build contexts, mode 0600 with the configured runtime
  UID/GID; its parent is 0700. Only the file path belongs in .env, never its contents.
- STUDYDY_UPLOAD_MAX_BYTES=94371840 is shared by API and Nginx; UI limits come from
  capabilities. Existing artifact hard limits stay unchanged. Capability failures
  block new file selection rather than falling back to a hardcoded limit.
- Nginx rejects unknown Host values, removes unused forwarded/identity headers,
  preserves exact Origin and Cookie semantics, and uses relative redirects.
- English branding, native-text-only ingestion, runtime lock, migrations, and data
  identities are preserved. No OCR or real-IP trust chain is introduced.

Public Internet deployment is approved; Access is optional. Start the connector
only after local smoke passes, using:

```bash
docker compose -f compose.yaml -f compose.tunnel.yaml --profile tunnel up -d --no-deps cloudflared
```

Keep both Compose files for subsequent frontend/backend maintenance. Base-only
commands would omit the deployment's HTTPS settings and edge membership.

Deployment checks: ops/tests/compose_boundary.py (explicit STUDYDY_TEST_ENV_FILE),
ops/tests/nginx_boundary.py (explicit frontend/backend test images, loopback 4183),
and backend/tests/runtime/infrastructure/test_https_deployment.py. Database tests
use disposable data and no model network access.

Before cutover, preserve old image identities and private configuration, verify
migration checksums and idle work, then stop writes and back up DB/artifacts.
Replace only this edition's frontend/backend. On failure, stop its connector and
restore its previous images/config; preserve data and all other deployments.

Verify public HTTPS, authentication, ownership, upload, conversion/download, and
private no-store responses without AI. Real generation, retry, and map generation
remain DEFERRED_AI_VALIDATION.
