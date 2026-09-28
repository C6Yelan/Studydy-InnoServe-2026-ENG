# Studydy — English Edition

Turn study materials into a source-linked knowledge map, then practice with concept checks and targeted follow-up questions. Materials, answers, and progress persist across sessions.

**Upload → review sources → analyze → explore the map → practice → review mistakes**

This edition is prepared for the InnoServe international exchange track. It uses English interface text, documentation, and model-generated learning content. Exact source quotations and technical literals are preserved.

## Get started

Docker Compose runs the React frontend, FastAPI backend, PostgreSQL, and isolated document conversion. PyMuPDF extracts native PDF text; this edition does not use OCR. Analysis and question generation use an independently deployed Gemma HTTP service.

- [Installation](docs/getting-started.md): configuration, services, model connections, backups, and restore. Default website: http://127.0.0.1:4177.
- [User guide](docs/usage.md): materials, maps, practice, and progress recovery.
- [Testing](docs/testing.md): basic checks and isolated API/browser tests.

## Documentation

| Topic | Guide |
| --- | --- |
| Components, data flow, and trust boundaries | [Architecture](docs/architecture.md) |
| Conversion, evidence, sources, and revisions | [Material processing](docs/materials.md) |
| Practice sets, grading, and progress | [Learning and assessment](docs/learning.md) |
| Format, model quality, and coverage limits | [Limitations](docs/limitations.md) |

Supported inputs: PDF, DOC/DOCX, PPT/PPTX, UTF-8 TXT, and Markdown. Additional sources create a new map revision; unchanged, uniquely matched points can inherit saved answer evidence.

Original files and persistent data stay on the deployment host. AI operations send necessary content to the configured model service. Generated content must be checked against its sources; software tests do not establish model quality.

Except where otherwise noted, Studydy source code is licensed under the [MIT License](LICENSE). Third-party components, models, and interface assets may be subject to separate terms; see [Third-party content](THIRD_PARTY_CONTENT.md).
