# Assets and third-party content

## Interface assets

Character illustrations are AI-generated and stored under [mascot](frontend/public/assets/mascot/) and [interface assets](frontend/public/assets/studydy/). The generation tool, applicable terms, and redistribution permissions require maintainer confirmation.

## Test documents

[Synthetic fixtures](backend/tests/fixtures/README.md) are project-created documents for conversion, content preservation, and source-location tests.

## Sandbox profile

The [Bubblewrap seccomp profile](ops/docker/bubblewrap-seccomp.json) derives from [Moby profiles](https://github.com/moby/profiles/blob/65adc7e022c97f55e45c054ff012988027733b87/seccomp/default.json), with namespace operations required by the sandbox. The upstream license is Apache License 2.0; its text is retained in [MOBY-LICENSE](ops/docker/MOBY-LICENSE).

## Dependencies, models, and project license

Versions are recorded in the [Python lock](backend/uv.lock), [npm lock](frontend/package-lock.json), and [runtime lock](local_ai/runtime-lock.json). Each dependency and model retains its publisher's terms.

Except where otherwise noted, original Studydy source code is licensed under the [MIT License](LICENSE). Third-party components, models, and interface assets retain their applicable terms and are not relicensed merely because the project uses the MIT License.
