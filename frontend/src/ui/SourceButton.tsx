import { useEffect, useRef, useState } from "react";
import { errorMessage, type StudydyApiClient } from "../api/client";
import type { EvidenceSourceView, EvidenceView } from "../api/contracts";

export function sourceLinks(evidence: EvidenceView[]): EvidenceView[] {
  // Merge links for the same source/PDF page while preserving representative evidence for resolution.
  const links = new Map<string, EvidenceView>();
  for (const item of evidence) {
    const key = JSON.stringify([
      item.source_id
        ? ["id", item.source_id]
        : item.source_name
          ? ["name", item.source_name]
          : ["evidence", item.evidence_id],
      item.normalized_page ?? item.page,
    ]);
    if (!links.has(key)) links.set(key, item);
  }
  return [...links.values()];
}

export function SourceButton({
  apiClient,
  resolver,
  evidence,
}: {
  apiClient: StudydyApiClient;
  resolver: string;
  evidence: EvidenceView;
}) {
  const [source, setSource] = useState<EvidenceSourceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (source) dialog.current?.showModal();
  }, [source]);
  const open = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setSource(await apiClient.resolveEvidence(resolver, evidence.evidence_id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        ref={opener}
        className="text-button"
        type="button"
        disabled={busy}
        onClick={() => void open()}
        aria-haspopup="dialog"
      >
        {busy
          ? "Loading source…"
          : evidence.source_name
            ? `${evidence.source_name} · PDF page ${evidence.normalized_page ?? evidence.page}`
            : `View source on page ${evidence.normalized_page ?? evidence.page}`}
      </button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {source && (
        <dialog
          ref={dialog}
          className="source-dialog"
          aria-label="Sources"
          onCancel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            dialog.current?.close();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") event.stopPropagation();
          }}
          onClose={() => {
            setSource(null);
            opener.current?.focus();
          }}
        >
          <h2>{source.original_name}</h2>
          <p>{source.label}</p>
          {source.accuracy !== "exact" && (
            <p>
              The location in the original document {source.accuracy === "ambiguous" ? "may match several locations" : "cannot be mapped precisely"}
              . Please refer to the converted PDF.
            </p>
          )}
          {source.format !== "pdf" && <p>This PDF was converted automatically. Check it against the original file.</p>}
          <div className="state-actions">
            <a
              className="primary-button"
              href={source.preview_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open source PDF page
            </a>
            <a
              className="secondary-button"
              href={source.original_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Download original
            </a>
            <button
              className="secondary-button"
              type="button"
              onClick={() => dialog.current?.close()}
            >
              Close
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}
