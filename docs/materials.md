# Material processing

[Documentation](../README.md) · [User guide](usage.md) · [Architecture](architecture.md)

## Sources and conversion

A material is a named collection of source files. Each original and converted PDF is limited to 100 MiB. The /v1/source-capabilities endpoint declares supported formats.

| Format | Conversion and source location |
| --- | --- |
| PDF | Validate the original and map its existing page numbers |
| DOCX | LibreOffice Writer conversion; paragraph matches can be ambiguous |
| PPTX | LibreOffice Impress conversion excluding hidden slides and notes; preserve original slide numbers |
| DOC/PPT | Validate binary Office format; expose converted PDF pages only |
| UTF-8 TXT | Bounded line layout with original line and PDF-page mapping |
| Markdown | Restricted HTML layout, literal raw HTML, unloaded images, and block/page mapping |

Originals, PDFs, and mappings have separate hashes. Original downloads use their original MIME type and attachment disposition. Parsing runs in an offline Bubblewrap subprocess with read-only runtime/input mounts and writable output/temporary directories. Limits and prohibited active content are defined in [converter.py](../backend/src/document_normalization/converter.py) and [renderer.py](../backend/src/document_normalization/renderer.py).

## Drafts and snapshots

Each file upload has its own idempotency key and conversion job. After the user confirms ready sources and their order, one transaction freezes the SourceSet, bundle manifest, and processing run. Later uploads do not join an existing run automatically.

Replaying an intent does not duplicate it; conflicting content, order, or base revisions are rejected. Unused sources can be removed. Sources referenced only by failed/cancelled work can leave the active list while archived originals and bindings remain intact. Active and published references stay protected. Reuploading uses a new intent, and removed normalizations cannot enter new analysis.

## Evidence and analysis

Only native PDF text becomes evidence. Images and scans remain in the original PDF for reference. Unreadable pages are excluded; a source without usable evidence is rejected. No visual evidence is invented and no OCR fallback is available.

Evidence retains source identity, one-based pages, blocks, geometry, and technical literals. Line merging respects layout rather than guessing across columns.

Requests are packed by sections and evidence. The actual tokenizer checks the full prompt, concept catalog, and output budget. The model selects complete evidence handles; code restores source bindings and validates claims, relations, and paths.

Generated labels, reasons, and question wording are English. Exact source quotations, answer spans, code, formulas, and identifiers remain unchanged even when a source uses another language.

## Review and publication

Initial and appended content undergo material review. Proposed grouping, examples, aliases, text, and relation changes must satisfy coverage, ownership, prerequisite, and literal checks. Coverage/ownership errors permit bounded repair; unsupported edits keep the source text or block publication.

Partial or needs_review results with usable new content can publish. No usable new content, cancellation, or failure preserves the current head. A review-only revision is available through /v1/materials/{material_id}/review, without a dedicated UI action.

## Append and resume

Appending analyzes only new sources before reviewing the combined map. Publication updates the structure, run, and material head atomically. The library opens the head; study history resolves its exact revision. Referenced structures remain available and source files are reused across revisions.

Checkpoints save evidence, accumulated state, cursors, and execution snapshots. Matching explicit retries can reuse completed batches. Deterministic assembly/publication needs no extra inference. Corrupt checkpoints or incompatible settings stop instead of silently restarting all analysis.

Private analysis archives distinguish reused responses from new requests. Checkpoint cleanup follows committed publication and can be retried; stale workers cannot recreate completed work.

## Cancellation and deletion

Cancelling an update preserves the published map and study history. Deleting a material records intent, blocks new work and late publication, then cleans sources, analysis, and study data. Files enter quarantine before database commit; rollback restores them and committed deletion removes them.

Cancellation cannot guarantee an external service immediately stops an in-flight request. Renaming changes only the display title.
