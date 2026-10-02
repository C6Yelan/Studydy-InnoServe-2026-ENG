import { useEffect, useRef, useState } from "react";
import { errorMessage, type StudydyApiClient } from "../../api/client";
import type { FormatCapability } from "../../api/contracts";
import { writeRoute } from "../../app/routes";
import { Icon } from "../../ui/Icon";
import { formatFileSize, validateSourceFile } from "./material-flow";

type QueuedFile = {
  file: File;
  key: string;
  status: "pending" | "uploading" | "uploaded" | "failed";
  error: string | null;
};

export function UploadView({ apiClient }: { apiClient: StudydyApiClient }) {
  const [formats, setFormats] = useState<FormatCapability[]>([]);
  const [formatsReady, setFormatsReady] = useState(false);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [selectionError, setSelectionError] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const draft = useRef<{ key: string; name: string; id: string | null } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const clearDrag = () => {
    dragDepth.current = 0;
    setIsDragging(false);
  };
  useEffect(() => {
    let cancelled = false;
    void apiClient.sourceCapabilities().then(
      (value) => {
        if (!cancelled) {
          setFormats(value.formats);
          setFormatsReady(true);
        }
      },
      () => {
        if (!cancelled) {
          setCapabilityError("Upload limits could not be loaded. Refresh the page and try again.");
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [apiClient]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearDrag();
    };
    const input = fileInput.current;
    input?.addEventListener("cancel", clearDrag);
    window.addEventListener("keydown", cancel);
    window.addEventListener("drop", clearDrag);
    window.addEventListener("dragend", clearDrag);
    window.addEventListener("blur", clearDrag);
    return () => {
      input?.removeEventListener("cancel", clearDrag);
      window.removeEventListener("keydown", cancel);
      window.removeEventListener("drop", clearDrag);
      window.removeEventListener("dragend", clearDrag);
      window.removeEventListener("blur", clearDrag);
    };
  }, []);
  const chooseFiles = (files: FileList | null) => {
    if (submitting.current || !files?.length) return;
    if (!formatsReady) {
      setSelectionError("Wait for supported formats to load, then select your files again.");
      return;
    }
    const additions: QueuedFile[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(files)) {
      const problem = validateSourceFile(file, formats);
      if (problem) rejected.push(`“${file.name}”: ${problem}`);
      else additions.push({ file, key: crypto.randomUUID(), status: "pending", error: null });
    }
    // Reject invalid files without replacing errors on already queued valid files.
    setSelectionError(rejected.join(" "));
    if (additions.length) {
      setQueue((previous) => [...previous, ...additions]);
      setError(null);
    }
  };
  const submit = async () => {
    if (submitting.current || !queue.length) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    clearDrag();
    try {
      // Reuse draft and per-file intents so partial failure or response loss cannot duplicate saved sources.
      draft.current ??= { key: crypto.randomUUID(), name: queue[0].file.name, id: null };
      const intent = draft.current;
      intent.id ??= (await apiClient.createDraft(intent.name, intent.key)).material_id;
      let failed = false;
      for (const item of queue.filter((item) => item.status !== "uploaded")) {
        setQueue((previous) =>
          previous.map((value) =>
            value.key === item.key ? { ...value, status: "uploading", error: null } : value,
          ),
        );
        try {
          const format = formats.find((value) =>
            item.file.name.toLowerCase().endsWith(value.extension),
          )!;
          await apiClient.uploadSource(intent.id, item.file, format.media_type, item.key);
          setQueue((previous) =>
            previous.map((value) =>
              value.key === item.key ? { ...value, status: "uploaded", error: null } : value,
            ),
          );
        } catch (failure) {
          failed = true;
          setQueue((previous) =>
            previous.map((value) =>
              value.key === item.key
                ? { ...value, status: "failed", error: errorMessage(failure) }
                : value,
            ),
          );
        }
      }
      if (!failed) writeRoute({ name: "material-sources", materialId: intent.id });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const hasNonPdf = queue.some(({ file }) =>
    formats.some(
      (format) => format.extension !== ".pdf" && file.name.toLowerCase().endsWith(format.extension),
    ),
  );
  return (
    <section className="upload-page task-page" aria-labelledby="upload-title">
      <header className="upload-hero">
        <img src="/assets/studydy/upload-guide.png" alt="" />
        <div>
          <p className="eyebrow">Study materials</p>
          <h1 id="upload-title">Upload materials</h1>
          <p>Choose one or more files. Review the sources before starting analysis.</p>
        </div>
      </header>
      <div className="upload-layout">
        <section className="surface upload-card" aria-label="Upload material files">
          <label
            className={`file-drop${queue.length ? " has-file" : ""}${busy || !formatsReady ? " is-disabled" : ""}${isDragging ? " is-dragging" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              if (!submitting.current && event.dataTransfer.types.includes("Files")) {
                dragDepth.current++;
                setIsDragging(true);
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect =
                !submitting.current && event.dataTransfer.types.includes("Files") ? "copy" : "none";
            }}
            onDragLeave={() => {
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (!dragDepth.current) setIsDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              clearDrag();
              if (submitting.current) return;
              const folder = Array.from(event.dataTransfer.items).some(
                (item) => item.webkitGetAsEntry?.()?.isDirectory,
              );
              if (folder || !event.dataTransfer.types.includes("Files"))
                setSelectionError(
                  folder ? "Folders are not supported. Select individual files." : "Drop files here. Text and URLs are not supported.",
                );
              else chooseFiles(event.dataTransfer.files);
            }}
          >
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={formats.map((format) => format.extension).join(",")}
              aria-label="Choose material files"
              aria-describedby={selectionError ? "upload-selection-error" : undefined}
              disabled={busy || !formatsReady}
              onClick={(event) => {
                event.currentTarget.value = "";
              }}
              onChange={(event) => chooseFiles(event.currentTarget.files)}
            />
            <span className="file-drop__icon">
              <Icon name="upload" size={28} />
            </span>
            <strong>
              {queue.length ? "Drop or click to add more files" : "Drop your files here, or click to browse"}
            </strong>
            <span>
              {formats.map((format) => format.extension.slice(1).toUpperCase()).join(", ")} ·
              Multiple files · {formatsReady ? `Up to ${formatFileSize(Math.min(...formats.map((format) => format.max_bytes)))} each` : "Loading upload limits"}
            </span>
          </label>
          {selectionError && (
            <p id="upload-selection-error" className="form-error" role="alert">
              {selectionError}
            </p>
          )}
          {queue.map((item) => {
            return (
              <div className="chosen-file" aria-label={`Selected ${item.file.name}`} key={item.key}>
                <span className="file-kind">
                  <Icon name="file" />
                </span>
                <div>
                  <strong>{item.file.name}</strong>
                  <small role="status">
                    {formatFileSize(item.file.size)} ·{" "}
                    {
                      {
                        pending: "Ready to upload",
                        uploading: "Uploading",
                        uploaded: "Uploaded",
                        failed: "Upload failed. Retry available.",
                      }[item.status]
                    }
                  </small>
                  {item.error && (
                    <p className="form-error" role="alert">
                      {item.error}
                    </p>
                  )}
                </div>
                <button
                  className="text-button"
                  disabled={busy || item.status === "uploaded"}
                  aria-label={`Remove ${item.file.name}`}
                  onClick={() => {
                    setQueue((previous) => previous.filter((value) => value.key !== item.key));
                    setError(null);
                  }}
                >
                  Remove
                </button>
              </div>
            );
          })}
          {queue.length > 0 && (
            <p className="conversion-note">
              Files: {queue.length} ·{" "}
              {formatFileSize(queue.reduce((total, item) => total + item.file.size, 0))}
            </p>
          )}
          {capabilityError && (
            <p className="conversion-note" role="status">
              {capabilityError}
            </p>
          )}
          {hasNonPdf && (
            <p className="conversion-note">Non-PDF files are converted to PDF. Check the conversion on the next screen.</p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary-button full-button"
            disabled={!queue.length || busy}
            onClick={() => void submit()}
          >
            <Icon name="upload" size={18} />
            {busy
              ? "Uploading…"
              : queue.every((item) => item.status === "uploaded") && queue.length
                ? "Continue to sources"
                : queue.some((item) => item.status === "failed")
                  ? "Retry incomplete uploads"
                  : "Upload and review sources"}
          </button>
        </section>
        <aside className="upload-aside" aria-label="How processing works">
          <section className="surface guide-card">
            <h2>How Studydy processes your materials</h2>
            <ol>
              <li>
                <span>1</span>
                <div>
                  <strong>Prepare your files</strong>
                  <p>Each source is saved separately. Non-PDF files are converted into PDFs for analysis.</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Extract content and sources</strong>
                  <p>Extract the text layer and keep the original PDF for reference. Text in images and scans is not recognized automatically.</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Organize concepts</strong>
                  <p>Organize key concepts, relationships, and a suggested learning order from your sources.</p>
                </div>
              </li>
              <li>
                <span>4</span>
                <div>
                  <strong>Build a knowledge map</strong>
                  <p>Explore the results in a knowledge map and trace each concept back to its sources.</p>
                </div>
              </li>
            </ol>
          </section>
        </aside>
      </div>
    </section>
  );
}
