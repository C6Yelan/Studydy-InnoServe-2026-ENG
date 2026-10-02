import { useEffect, useRef, useState } from "react";
import { ApiClientError, errorMessage, type StudydyApiClient } from "../../api/client";
import type { SourceListView, MaterialLibraryItem, FormatCapability } from "../../api/contracts";
import { writeRoute } from "../../app/routes";
import { Icon } from "../../ui/Icon";
import { StateView } from "../../ui/StateView";
import { MaterialRemoveControl } from "./MaterialRemoveControl";
import { automaticPollIntervalMs, formatFileSize, validateSourceFile } from "./material-flow";

type QueuedFile = {
  file: File;
  key: string;
  mediaType: string;
  error: string | null;
  status: "pending" | "uploading" | "failed" | "uploaded";
};

export function SourceView({
  apiClient,
  materialId,
}: {
  apiClient: StudydyApiClient;
  materialId: string;
}) {
  const [sourceList, setSourceList] = useState<SourceListView | null>(null);
  const [material, setMaterial] = useState<MaterialLibraryItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const discardAccepted = useRef(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [reload, setReload] = useState(0);
  const [selectionError, setSelectionError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const seenSources = useRef(new Set<string>());
  const uploadedKeys = useRef(new Set<string>());
  const intent = useRef({ signature: "", key: crypto.randomUUID() });
  const [formats, setFormats] = useState<FormatCapability[]>([]);
  const [formatsReady, setFormatsReady] = useState(false);
  const [capabilityError, setCapabilityError] = useState("");
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
    let cancelled = false;
    let timer: number | undefined;
    const read = async () => {
      // Clear only uploads completed before this GET started so stale polling cannot drop new queue items.
      const refreshedKeys = new Set(uploadedKeys.current);
      try {
        const [sources, item] = await Promise.all([
          apiClient.getSources(materialId),
          apiClient.getMaterial(materialId),
        ]);
        if (cancelled) return;
        if ([...uploadedKeys.current].some((key) => !refreshedKeys.has(key))) {
          timer = window.setTimeout(read, automaticPollIntervalMs);
          return;
        }
        const staged = sources.sources.filter((source) => !source.included);
        const added = staged
          .filter((source) => !seenSources.current.has(source.normalization_id))
          .map((source) => source.normalization_id);
        setSelectedIds((previous) => [
          ...previous.filter((id) => staged.some((source) => source.normalization_id === id)),
          ...added,
        ]);
        seenSources.current = new Set(sources.sources.map((source) => source.normalization_id));
        setSourceList(sources);
        setMaterial(item);
        setQueue((previous) => previous.filter((item) => !refreshedKeys.has(item.key)));
        for (const key of refreshedKeys) uploadedKeys.current.delete(key);
        if (sources.discard_requested) {
          discardAccepted.current = true;
          setRemoving(true);
        }
        if (
          discardAccepted.current ||
          sources.sources.some(
            (source) => source.status === "pending" || source.status === "running",
          ) ||
          item.latest_attempt?.status === "running" ||
          item.latest_attempt?.status === "pending"
        )
          timer = window.setTimeout(read, automaticPollIntervalMs);
      } catch (failure) {
        if (cancelled) return;
        if (
          discardAccepted.current &&
          failure instanceof ApiClientError &&
          failure.reasonCode === "RESOURCE_NOT_FOUND"
        ) {
          writeRoute({ name: "materials" });
          return;
        }
        setError(errorMessage(failure));
      }
    };
    void read();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apiClient, materialId, reload]);
  const currentStructure =
    material?.available_structures.find(
      (item) => item.knowledge_structure_revision === material.head_revision,
    ) ?? material?.available_structures[0];
  const baseRevision = currentStructure?.knowledge_structure_revision ?? null;
  const run = material?.latest_attempt;
  const hasActiveRun = run?.status === "pending" || run?.status === "running";
  const staged = sourceList?.sources.filter((source) => !source.included) ?? [];
  const selectedSources = selectedIds.flatMap((id) =>
    staged.filter((source) => source.normalization_id === id),
  );
  const displayedSources = currentStructure ? (sourceList?.sources ?? []) : selectedSources;
  const sourcesReady =
    selectedSources.length > 0 && selectedSources.every((source) => source.status === "ready");
  const hasUploads = currentStructure ? staged.length > 0 : (sourceList?.sources.length ?? 0) > 0;
  const flowStarted =
    !!run &&
    run.status !== "failed" &&
    run.status !== "cancelled" &&
    (!currentStructure || !!run.base_revision);
  const flowComplete = flowStarted && (run?.status === "succeeded" || run?.status === "partial");
  const openMap = () => {
    if (currentStructure)
      writeRoute({
        name: "knowledge-map",
        materialId,
        runId: currentStructure.run_id,
        structureRevision: currentStructure.knowledge_structure_revision,
      });
  };
  const perform = async (action: () => Promise<void>) => {
    if (submitting.current || discardAccepted.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const start = () =>
    perform(async () => {
      if (!sourcesReady || hasActiveRun || queue.length > 0) return;
      const ids = selectedSources.map((source) => source.normalization_id);
      const signature = JSON.stringify([baseRevision, ids]);
      if (intent.current.signature !== signature)
        intent.current = { signature, key: crypto.randomUUID() };
      const created = await apiClient.createRevision(
        materialId,
        ids,
        intent.current.key,
        baseRevision,
      );
      writeRoute({ name: "material-run", materialId, runId: created.run_id });
    });
  const chooseFiles = (files: FileList | null) => {
    if (!files?.length || submitting.current || discardAccepted.current) return;
    if (!formatsReady) {
      setSelectionError("Wait for supported formats to load, then select your files again.");
      return;
    }
    const newFiles: QueuedFile[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(files)) {
      const problem = validateSourceFile(file, formats);
      if (problem) rejected.push(`“${file.name}”: ${problem}`);
      else
        newFiles.push({
          file,
          key: crypto.randomUUID(),
          mediaType: formats.find((format) => file.name.toLowerCase().endsWith(format.extension))!
            .media_type,
          status: "pending",
          error: null,
        });
    }
    setSelectionError(rejected.join(" "));
    if (newFiles.length) setQueue((previous) => [...previous, ...newFiles]);
  };
  const updateQueuedFile = (
    key: string,
    status: QueuedFile["status"],
    error: string | null = null,
  ) =>
    setQueue((previous) =>
      previous.map((item) => (item.key === key ? { ...item, status, error } : item)),
    );
  const upload = () =>
    perform(async () => {
      for (const item of queue.filter((item) => item.status !== "uploaded")) {
        updateQueuedFile(item.key, "uploading");
        try {
          await apiClient.uploadSource(materialId, item.file, item.mediaType, item.key);
          uploadedKeys.current.add(item.key);
          updateQueuedFile(item.key, "uploaded");
        } catch (failure) {
          updateQueuedFile(item.key, "failed", errorMessage(failure));
        }
      }
      setReload((value) => value + 1);
    });
  const moveSource = (index: number, offset: -1 | 1) =>
    setSelectedIds((previous) => {
      const next = [...previous];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
  if (!sourceList && !error)
    return (
      <StateView
        title="Loading conversion status"
        description="Uploaded originals are preserved. Refreshing does not repeat conversion."
        tone="loading"
        live
      />
    );
  const waiting = selectedSources.filter(
    (source) => source.status === "pending" || source.status === "running",
  ).length;
  const failed = selectedSources.filter((source) => source.status === "failed").length;
  const prepared = selectedSources.filter((source) => source.status === "ready").length;
  const pendingUploads = queue.filter((item) => item.status === "pending").length;
  const failedUploads = queue.filter((item) => item.status === "failed").length;
  const uploading = queue.filter((item) => item.status === "uploading").length;
  const uploaded = queue.filter((item) => item.status === "uploaded").length;
  const uploadNeeded = pendingUploads + failedUploads + uploading > 0;
  const summary =
    queue.length === 0 && sourcesReady
      ? `Files: ${selectedSources.length} · Pages: ${selectedSources.reduce((sum, source) => sum + (source.page_count ?? 0), 0)}`
      : selectedSources.length === 0 && queue.length === 0
        ? "Files: 0"
        : [
            `${prepared} ${failed ? "available" : "ready"}`,
            waiting > 0 && `${waiting} converting`,
            failed > 0 && `${failed} conversion failed`,
            pendingUploads > 0 && `${pendingUploads} waiting to upload`,
            uploading > 0 && `${uploading} uploading`,
            failedUploads > 0 && `${failedUploads} upload failed`,
            uploaded > 0 && `${uploaded} uploaded`,
          ]
            .filter(Boolean)
            .join(" · ");
  return (
    <section className="task-page source-page">
      <header className="upload-hero">
        <img src="/assets/studydy/upload-guide.png" alt="" />
        <div>
          <h1>{currentStructure ? "Add sources" : "Review material"}</h1>
          <p>
            {currentStructure
              ? "Add sources to update the map while preserving progress for unchanged content."
              : "Preview your sources, arrange their order, then start building your knowledge map."}
          </p>
        </div>
      </header>
      {error && (
        <div role="alert" className="surface source-request-error">
          <p className="form-error">{error}</p>
          <button
            className="secondary-button"
            onClick={() => {
              setError(null);
              setReload((value) => value + 1);
            }}
          >
            Refresh
          </button>
        </div>
      )}
      <div className="upload-layout">
        <div>
          <section className="surface source-list-card" aria-label="Sources">
            <header className="source-list-header">
              <div>
                <h2 ref={heading} tabIndex={-1}>
                  Sources
                </h2>
                <p>
                  Files: {displayedSources.length + queue.length}
                  {queue.length === 0 &&
                    displayedSources.length > 0 &&
                    displayedSources.every((source) => source.status === "ready") &&
                    ` · Pages: ${displayedSources.reduce((sum, source) => sum + (source.page_count ?? 0), 0)}`}
                </p>
              </div>
              {currentStructure && (
                <button className="secondary-button" onClick={openMap}>
                  Open current map
                </button>
              )}
            </header>
            {removing && <p role="status">Deleting material…</p>}
            <ol className="source-list">
              {displayedSources.map((source, index) => (
                <li className="source-row" key={source.source_id} aria-label={source.original_name}>
                  <div className="source-order">
                    <span className="source-number">{index + 1}</span>
                  </div>
                  <div className="source-content">
                    <strong className="source-name">{source.original_name}</strong>
                    <div className="source-metadata">
                      {source.page_count !== null && <span>Pages: {source.page_count}</span>}
                      {currentStructure && source.included && <span>Used in the current map</span>}
                    </div>
                    {source.status !== "ready" && (
                      <p
                        className={source.status === "failed" ? "form-error" : "source-progress"}
                        role="status"
                      >
                        {source.status === "pending"
                          ? "Waiting for conversion"
                          : source.status === "running"
                            ? "Converting…"
                            : "Conversion failed"}
                      </p>
                    )}
                    <div className="source-row-actions">
                      {source.normalized_artifact_id && (
                        <a
                          className="text-button"
                          href={
                            removing
                              ? undefined
                              : `/v1/artifacts/${encodeURIComponent(source.normalized_artifact_id)}`
                          }
                          aria-disabled={removing || undefined}
                          tabIndex={removing ? -1 : undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Preview PDF
                        </a>
                      )}
                      <a
                        className="text-button source-download"
                        href={
                          removing
                            ? undefined
                            : `/v1/artifacts/${source.original_artifact_id}/download`
                        }
                        aria-disabled={removing || undefined}
                        tabIndex={removing ? -1 : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Download original
                      </a>
                      {!source.included && !removing && (
                        <>
                          <button
                            className="text-button source-remove"
                            type="button"
                            disabled={busy || hasActiveRun || source.status === "running"}
                            onClick={() =>
                              void perform(async () => {
                                await apiClient.removeStagedSource(materialId, source.source_id);
                                setReload((value) => value + 1);
                                heading.current?.focus({ preventScroll: true });
                              })
                            }
                          >
                            Remove
                          </button>
                          {currentStructure && (
                            <label>
                              <input
                                type="checkbox"
                                checked={selectedIds.includes(source.normalization_id)}
                                disabled={busy || hasActiveRun}
                                onChange={(event) =>
                                  setSelectedIds((previous) =>
                                    event.target.checked
                                      ? [...previous, source.normalization_id]
                                      : previous.filter((id) => id !== source.normalization_id),
                                  )
                                }
                              />{" "}
                              Include in this update
                            </label>
                          )}
                          {source.status === "failed" && (
                            <button
                              className="secondary-button"
                              disabled={busy}
                              onClick={() =>
                                void perform(async () => {
                                  await apiClient.retryNormalization(
                                    materialId,
                                    source.normalization_id,
                                  );
                                  setReload((value) => value + 1);
                                })
                              }
                            >
                              Retry conversion
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    {source.error_code && (
                      <details className="processing-technical source-technical">
                        <summary>Error details</summary>
                        <code>{source.error_code}</code>
                      </details>
                    )}
                  </div>
                  {!currentStructure &&
                    !source.included &&
                    !removing &&
                    selectedSources.length > 1 && (
                      <div className="source-reorder">
                        <button
                          type="button"
                          disabled={busy || hasActiveRun || index === 0}
                          aria-label={`Move up ${source.original_name}`}
                          onClick={() => moveSource(index, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={busy || hasActiveRun || index === selectedSources.length - 1}
                          aria-label={`Move down ${source.original_name}`}
                          onClick={() => moveSource(index, 1)}
                        >
                          ↓
                        </button>
                      </div>
                    )}
                </li>
              ))}
              {queue.map((item, index) => (
                <li
                  className="source-row source-upload-row"
                  key={item.key}
                  aria-label={item.file.name}
                >
                  <div className="source-order">
                    <span className="source-number">{displayedSources.length + index + 1}</span>
                  </div>
                  <div className="source-content">
                    <strong className="source-name">{item.file.name}</strong>
                    <div className="source-metadata">
                      <span>{formatFileSize(item.file.size)}</span>
                      <span className={`source-upload-status is-${item.status}`} role="status">
                        {
                          {
                            pending: "Waiting to upload",
                            uploading: "Uploading…",
                            failed: "Upload failed",
                            uploaded: "Uploaded",
                          }[item.status]
                        }
                      </span>
                    </div>
                    {item.error && (
                      <p className="form-error" role="alert">
                        {item.error}
                      </p>
                    )}
                    {!removing && (
                      <div className="source-row-actions">
                        <button
                          className="text-button source-remove"
                          disabled={busy || item.status === "uploaded"}
                          onClick={() =>
                            setQueue((previous) =>
                              previous.filter((value) => value.key !== item.key),
                            )
                          }
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            {!removing && !hasActiveRun && (
              <div className="source-add-area">
                <label className="source-add-control">
                  ＋ Add sources
                  <input
                    type="file"
                    multiple
                    accept={formats.map((format) => format.extension).join(",")}
                    aria-label="Choose files to add"
                    aria-describedby={selectionError ? "source-selection-error" : undefined}
                    disabled={busy || !formatsReady}
                    onChange={(event) => {
                      chooseFiles(event.currentTarget.files);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                {capabilityError && (
                  <p className="conversion-note" role="status">
                    {capabilityError}
                  </p>
                )}
                {selectionError && (
                  <p id="source-selection-error" className="form-error" role="alert">
                    {selectionError}
                  </p>
                )}
              </div>
            )}
            {!removing && (
              <footer className="source-list-footer">
                <div>
                  <p className="source-summary">
                    {currentStructure ? "Added for this update: " : ""}
                    {summary}
                  </p>
                  {!hasActiveRun && !uploadNeeded && uploaded > 0 && (
                    <p role="status">Updating sources…</p>
                  )}
                  {!hasActiveRun && queue.length === 0 && waiting > 0 && (
                    <p role="status">Waiting for file conversion</p>
                  )}
                  {failed > 0 && (
                    <p className="form-error" role="status">
                      Retry conversion or remove{currentStructure ? " or uncheck" : ""} the failed sources.
                    </p>
                  )}
                </div>
                <div className="source-primary-actions">
                  {hasActiveRun && run ? (
                    <button
                      className="primary-button"
                      onClick={() =>
                        writeRoute({ name: "material-run", materialId, runId: run.run_id })
                      }
                    >
                      View processing status
                    </button>
                  ) : uploadNeeded ? (
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() => void upload()}
                    >
                      {uploading ? "Uploading…" : failedUploads ? "Retry upload" : "Upload added files"}
                    </button>
                  ) : (
                    queue.length === 0 &&
                    sourcesReady && (
                      <button
                        className="primary-button"
                        disabled={busy}
                        onClick={() => void start()}
                      >
                        {busy
                          ? "Starting analysis…"
                          : currentStructure
                            ? "Confirm sources and update map"
                            : "Start analysis"}
                      </button>
                    )
                  )}
                  {run && !hasActiveRun && (
                    <button
                      className="text-button"
                      onClick={() =>
                        writeRoute({ name: "material-run", materialId, runId: run.run_id })
                      }
                    >
                      View processing result
                    </button>
                  )}
                </div>
              </footer>
            )}
          </section>
          <div className="source-footer">
            <button className="text-button" onClick={() => writeRoute({ name: "materials" })}>
              <Icon name="arrow-left" />
              Back to library
            </button>
            <MaterialRemoveControl
              inActionRow
              material={material}
              sources={sourceList?.sources}
              apiClient={apiClient}
              materialId={materialId}
              onAccepted={(state) => {
                if (state === "removed") writeRoute({ name: "materials" });
                else {
                  discardAccepted.current = true;
                  setRemoving(true);
                  setReload((value) => value + 1);
                }
              }}
            />
          </div>
        </div>
        <aside className="surface guide-card source-guide">
          <h2>{currentStructure ? "Update material" : "From sources to a knowledge map"}</h2>
          <ol>
            <li
              className={hasUploads || flowStarted ? "is-complete" : "is-active"}
              aria-current={!hasUploads && !flowStarted ? "step" : undefined}
            >
              <span>1</span>
              <div>
                <strong>Upload materials</strong>
                <p>Keep each original file and its PDF preview.</p>
              </div>
            </li>
            <li
              className={flowStarted ? "is-complete" : hasUploads ? "is-active" : undefined}
              aria-current={hasUploads && !flowStarted ? "step" : undefined}
            >
              <span>2</span>
              <div>
                <strong>Review sources</strong>
                <p>Preview and select the sources to include.</p>
              </div>
            </li>
            <li
              className={flowComplete ? "is-complete" : flowStarted ? "is-active" : undefined}
              aria-current={flowStarted && !flowComplete ? "step" : undefined}
            >
              <span>3</span>
              <div>
                <strong>{currentStructure ? "Update the map" : "Start analysis"}</strong>
                <p>Analysis starts when you confirm. Existing data is preserved if it fails.</p>
              </div>
            </li>
          </ol>
        </aside>
      </div>
    </section>
  );
}
