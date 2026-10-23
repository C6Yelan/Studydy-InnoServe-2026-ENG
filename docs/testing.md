# Testing

[Documentation](../README.md) · [Installation](getting-started.md) · [Limitations](limitations.md)

## Choose the scope

| Change | First checks |
| --- | --- |
| Evidence, structures, questions, pure logic | Relevant backend/tests unit tests |
| API, storage, workers, sources, transactions | Relevant backend/tests/runtime area |
| Frontend contracts and routes | Node tests and TypeScript |
| UI interaction and localization | Production build and selected browser cases |
| Documentation and comments | Links, commands, syntax, and behavior preservation |

Do not repeat successful checks unless new changes, failures, or unresolved concerns justify it.

## Offline container checks

```bash
docker compose -p studydy-eng-unit-tests -f compose.test.yaml run --build --rm unit
```

The container has no network or product-data mounts and needs no GPU or model. Frontend image builds run Node tests, TypeScript, and the production build.

Backend and test images default to UID 20003 with GID 1000. Use a unique Compose project and a fresh mktemp directory, never product data. Check init with distinct host-manager/backend UIDs: artifacts must be owned by the backend and remain 0700, while existing data-root and PostgreSQL metadata stay unchanged. Verify artifact writes and controlled reads as the backend UID; direct host-UID reads are intentionally not granted by the shared GID. Test bridge key access only with an isolated fake key owned by its retained UID 1000 and mode 0600, never a real key.

Keep the current permission assertions, NPROC 1024, pids 512, capability drops, no-new-privileges, seccomp, and bwrap isolation. Changing the test UID is not permission to relax these boundaries. The host shared .venv must remain untouched; use the test image for unit and runtime checks.

LibreOffice 26.2.5.2 and Bubblewrap retain their qualified `20261005T060000Z` snapshot. Existing system security packages use exact versions from `20261023T060000Z`; both snapshots and pins are in `ops/docker/backend.Dockerfile`. Verify the runtime package versions after rebuilding rather than replacing LibreOffice or relaxing the sandbox. The English edition has no OCR stage or lxml dependency, so neither is introduced.

CA acceptance follows the official emSign G3 removal. Certifi and system CA stores may retain G1/C1/C3; cloudflared uses its official Go mitigation. The pinned nginx 1.30.6 image currently remains on Alpine 3.24.2: wait for an official rebuild instead of adding an APK upgrade layer.

## Source checks

Prepare backend/.venv and frontend/node_modules using the lock files. Real conversion requires the deployment's LibreOffice, fonts, and Bubblewrap. Never rebuild another checkout's shared environment.

```bash
PYTHONPATH=backend/src:backend/tests backend/.venv/bin/pytest -q backend/tests/test_*.py
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Node's summary may count files rather than individual cases; run a test.mjs directly to inspect its cases. Model HTTP is blocked by the backend test fixtures.

## Isolated API and browser tests

Runtime tests cover accounts, assessments, infrastructure, materials, sources, and study. Fixtures create disposable PostgreSQL 18.6 from the same pinned image as Compose, with per-test databases and artifact roots. Do not use a product database.

STUDYDY_TEST_POSTGRES_DSN, if explicitly supplied, must identify a local test control database named studydy_test*. The fixture checks its version and superuser permissions.

Use independent ports and a dedicated build:

```bash
export STUDYDY_E2E_FRONTEND_DIST="$PWD/.studydy-runtime/test-frontend"
export STUDYDY_E2E_FRONTEND_PORT=4197 STUDYDY_E2E_API_PORT=8017
npm --prefix frontend run build -- --outDir "$STUDYDY_E2E_FRONTEND_DIST" --emptyOutDir

env -u STUDYDY_TEST_POSTGRES_DSN -u STUDYDY_DATABASE_DSN \
  PYTHONPATH=backend/src:backend/tests \
  backend/.venv/bin/pytest -q backend/tests --durations=10
```

- frontend/e2e/mock intercepts APIs to test public contracts, interactions, and representative layouts.
- frontend/e2e/api uses Python fixtures for a real API/database and any required worker. Model responses remain controlled; fault injection is identified separately.
- Fixtures set activation flags. A skipped direct Playwright run is not a passed integration test.

Run mock browser cases with the build and ports above:

```bash
PYTHONPATH=backend/tests/runtime backend/.venv/bin/python - <<'PYTEST'
from browser_e2e_runner import main
raise SystemExit(main("e2e/mock/", timeout_seconds=600))
PYTEST
```

Select a filename or regex for narrower checks. For real API tests, run the corresponding Python fixture, such as sources/test_source_revisions_browser.py.

## Acceptance boundaries

Protect owner/session isolation, private answers, source identity, atomic/idempotent submission, version conflicts, deletion recovery, stale workers, migration checksums, conversion, and page/block locators.

Record commands, scope, results, and limitations. Synthetic tests establish software regression evidence only. Real English acceptance uses the prepared English demo files and actual browser interaction, with independently authorized model calls. Do not register the designated product test account in advance if registration is part of that acceptance flow.

Multilingual literals and binary fixtures intentionally exercise Unicode and source preservation. They are test data, not untranslated interface copy; never translate exact evidence merely to make a language scan pass.
