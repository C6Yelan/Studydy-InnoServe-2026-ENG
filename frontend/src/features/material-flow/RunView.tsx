import { useCallback, useEffect, useRef, useState } from "react";

import { ApiClientError, errorMessage, type StudydyApiClient } from "../../api/client";
import type { MaterialProcessingRunView, MaterialLibraryItem } from "../../api/contracts";
import { writeRoute, type AppRoute } from "../../app/routes";
import { Icon } from "../../ui/Icon";
import { StateView } from "../../ui/StateView";
import { MaterialRunStartControl } from "./MaterialRunStartControl";
import { MaterialRemoveControl } from "./MaterialRemoveControl";
import {
  automaticPollIntervalMs,
  materialElapsedLabel,
  materialFailureMessage,
  materialProgressStageLabel,
  materialProgressStages,
  materialCurrentStagePercent,
  materialOverallProgressPercent,
} from "./material-flow";

function activeRun(run: MaterialProcessingRunView | null): boolean {
  return run?.status === "pending" || run?.status === "running";
}

function canRequestDiscard(run: MaterialProcessingRunView | null): boolean {
  return (
    !!run &&
    activeRun(run) &&
    run.cancel_requested_at === null &&
    ["queued", "evidence", "semantics"].includes(run.progress_stage)
  );
}

export function RunView({
  apiClient,
  route,
}: {
  apiClient: StudydyApiClient;
  route: Extract<AppRoute, { name: "material-run" }>;
}) {
  const [run, setRun] = useState<MaterialProcessingRunView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const currentRun = useRef<MaterialProcessingRunView | null>(null);
  const discardAccepted = useRef(false);
  const [removing, setRemoving] = useState(false);
  const cancelVersion = useRef(0);
  const mounted = useRef(true);
  const cancelInFlight = useRef(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);

  const applyRun = useCallback((next: MaterialProcessingRunView) => {
    const previous = currentRun.current;
    // Stale GET/POST responses must not undo saved cancellation or terminal state.
    if (previous?.cancel_requested_at && next.cancel_requested_at === null) return previous;
    if (previous && !activeRun(previous) && activeRun(next)) return previous;
    currentRun.current = next;
    setRun(next);
    if (!next.base_revision && next.status === "running" && next.cancel_requested_at !== null) {
      discardAccepted.current = true;
      setRemoving(true);
    }
    if (next.cancel_requested_at !== null || !activeRun(next)) {
      setCancelError(null);
      setConfirmingCancel(false);
    }
    return next;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (confirmingCancel) continueButton.current?.focus();
    else cancelButton.current?.focus();
  }, [confirmingCancel]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      if (currentRun.current && !activeRun(currentRun.current) && !discardAccepted.current) return;
      const version = cancelVersion.current;
      try {
        const next = await apiClient.getMaterialRun(route.runId);
        if (cancelled) return;
        if (next.material_id !== route.materialId || next.run_id !== route.runId)
          throw new Error("RUN_MATERIAL_MISMATCH");
        if (version === cancelVersion.current) {
          applyRun(next);
          setMessage(null);
        }
      } catch (error) {
        if (cancelled) return;
        if (
          discardAccepted.current &&
          error instanceof ApiClientError &&
          error.reasonCode === "RESOURCE_NOT_FOUND"
        ) {
          writeRoute({ name: "materials" });
          return;
        }
        if (version === cancelVersion.current) {
          setMessage(errorMessage(error));
          return;
        }
      }
      if (!cancelled && (activeRun(currentRun.current) || discardAccepted.current))
        timer = window.setTimeout(poll, automaticPollIntervalMs);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [apiClient, reload, route.materialId, route.runId, applyRun]);

  const sendDiscard = async () => {
    if (cancelInFlight.current || discardAccepted.current || !canRequestDiscard(currentRun.current))
      return;
    cancelInFlight.current = true;
    setCancelBusy(true);
    setCancelError(null);
    try {
      const next = await apiClient.discardMaterial(route.materialId);
      if (!mounted.current) return;
      cancelVersion.current++;
      discardAccepted.current = true;
      setRemoving(true);
      setMessage(null);
      setConfirmingCancel(false);
      if (next.state === "removed") writeRoute({ name: "materials" });
      else setReload((value) => value + 1);
    } catch (error) {
      if (mounted.current && !discardAccepted.current) {
        if (error instanceof ApiClientError && error.reasonCode === "MATERIAL_NOT_DISCARDABLE") {
          setConfirmingCancel(false);
          setCancelNotice(errorMessage(error));
        } else setCancelError(`Unable to request deletion. Please try again. ${errorMessage(error)}`);
      }
    } finally {
      cancelInFlight.current = false;
      if (mounted.current) setCancelBusy(false);
    }
  };

  useEffect(() => {
    if (!activeRun(run)) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [run?.run_id, run?.status]);

  if (message)
    return (
      <section className="processing-page task-page">
        <StateView
          action={
            <>
              <button
                className="primary-button"
                type="button"
                onClick={() => setReload((value) => value + 1)}
              >
                <Icon name="refresh" />
                Refresh
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => writeRoute({ name: "materials" })}
              >
                Back to library
              </button>
            </>
          }
          description={message}
          image="/assets/studydy/failure-confused.png"
          title="Unable to load processing status"
          tone="failure"
        />
      </section>
    );

  if (!run)
    return (
      <section className="processing-page task-page" aria-live="polite">
        <header className="processing-hero">
          <img src="/assets/studydy/processing-laptop.png" alt="" />
          <div>
            <p className="eyebrow">Material processing</p>
            <h1>Loading processing status</h1>
          </div>
        </header>
      </section>
    );

  if (run.base_revision)
    return (
      <RevisionRun
        apiClient={apiClient}
        run={run}
        now={now}
        onChange={(next) => {
          applyRun(next);
          setReload((value) => value + 1);
        }}
      />
    );

  if (activeRun(run)) {
    const cancellationRequested = removing || run.cancel_requested_at !== null;
    return (
      <section className="processing-page task-page is-processing">
        <header className="processing-hero">
          <div>
            <p className="eyebrow">Material processing</p>
            <h1>
              {cancellationRequested
                ? "Cancelling and deleting material"
                : run.status === "pending"
                  ? "Waiting to start"
                  : "Analyzing material"}
            </h1>
            <p>
              {cancellationRequested
                ? "Deletion requested. Processing will stop safely after the current step, then the material will be deleted."
                : "Studydy extracts content, builds concept relationships, and publishes the completed knowledge map."}
            </p>
          </div>
        </header>
        <div className="processing-grid">
          <section className="surface processing-card">
            <ProcessingProgress run={run} now={now} />
            {!removing && canRequestDiscard(run) && (
              <div className="processing-cancel">
                {confirmingCancel ? (
                  <section
                    aria-labelledby="cancel-confirm-title"
                    className="cancel-confirmation"
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && !cancelBusy) {
                        setConfirmingCancel(false);
                        setCancelError(null);
                      }
                    }}
                  >
                    <h3 id="cancel-confirm-title">Cancel processing and delete this material?</h3>
                    <p>
                      Studydy will safely stop processing and delete the original
                      PDF, processing records, knowledge maps, progress, questions, and answers. This cannot be undone.
                    </p>
                    <div className="state-actions">
                      <button
                        ref={continueButton}
                        className="secondary-button"
                        type="button"
                        disabled={cancelBusy}
                        onClick={() => {
                          setConfirmingCancel(false);
                          setCancelError(null);
                        }}
                      >
                        Continue processing
                      </button>
                      <button
                        className="secondary-button cancel-confirm-button"
                        type="button"
                        disabled={cancelBusy}
                        onClick={() => void sendDiscard()}
                      >
                        Confirm deletion
                      </button>
                    </div>
                  </section>
                ) : (
                  <button
                    ref={cancelButton}
                    className="secondary-button processing-destructive"
                    type="button"
                    onClick={() => {
                      setCancelError(null);
                      setConfirmingCancel(true);
                    }}
                  >
                    Cancel and delete material
                  </button>
                )}
              </div>
            )}
            {cancelBusy && <p role="status">Requesting deletion…</p>}
            {cancelError && (
              <p className="form-error" role="alert">
                {cancelError}
              </p>
            )}
            {cancelNotice && <p role="status">{cancelNotice}</p>}
          </section>
          <ProcessingTimeline run={run} />
        </div>
      </section>
    );
  }

  // Retain accepted deletion state even if publication finishes concurrently.
  if (run.status === "cancelled" || (removing && !activeRun(run)))
    return (
      <section className="processing-page task-page is-cancelled">
        <StateView
          title={removing ? "Deleting material…" : "Analysis cancelled"}
          description={
            removing
              ? "Analysis has stopped. Deleting the PDF and processing records."
              : "Analysis has stopped. You can delete the PDF and processing records if you no longer need this material."
          }
          icon="book"
          tone="empty"
          live
          action={
            !removing && (
              <MaterialRemoveControl
                apiClient={apiClient}
                materialId={route.materialId}
                onAccepted={(state) => {
                  if (state === "removed") writeRoute({ name: "materials" });
                  else {
                    discardAccepted.current = true;
                    setRemoving(true);
                    setReload((value) => value + 1);
                  }
                }}
              />
            )
          }
        />
        <p className="failure-progress">
          Stopped at: {materialProgressStageLabel(run.progress_stage)}
          {run.total_pages !== null && `, ${run.completed_pages} / ${run.total_pages} pages processed`}
        </p>
      </section>
    );

  if (run.status === "failed")
    return (
      <section className="processing-page task-page terminal-failure">
        <StateView
          action={
            <>
              <MaterialRunStartControl
                apiClient={apiClient}
                materialId={run.material_id}
                retryRun={{ runId: run.run_id, saved: !!run.analysis_saved }}
              />
              <button
                className="secondary-button"
                type="button"
                onClick={() => writeRoute({ name: "materials" })}
              >
                Back to library
              </button>
            </>
          }
          description={materialFailureMessage(run.error_code ?? "MATERIAL_ANALYSIS_FAILED")}
          image="/assets/studydy/failure-confused.png"
          title="Analysis failed"
          tone="failure"
        />
        <p className="failure-progress" role="status">
          Last recorded progress: {materialProgressStageLabel(run.progress_stage)}
          {run.total_pages === null ? "" : `, ${run.completed_pages} / ${run.total_pages} pages`}
        </p>
        {run.analysis_saved && (
          <p role="status">
            Completed batches are saved locally. Retry with the same sources and settings to resume; if only map assembly remains, no new inference is needed.
          </p>
        )}
        {run.input_source_set_id && !run.analysis_saved && (
          <p role="status">No saved analysis progress is available. Retrying will analyze the original sources again.</p>
        )}
        {run.input_source_set_id && (
          <button
            className="text-button"
            onClick={() => writeRoute({ name: "material-sources", materialId: run.material_id })}
          >
            Edit sources and analyze again
          </button>
        )}
        {run.error_code && (
          <details className="processing-technical">
            <summary>Technical details</summary>
            <code>{run.error_code}</code>
          </details>
        )}
      </section>
    );

  const binding = run.output_binding!;
  const partial = run.status === "partial";
  return (
    <section className="processing-page task-page is-complete">
      <header className="processing-hero">
        <img src="/assets/studydy/success-jump.png" alt="" />
        <div>
          <p className="eyebrow">Material processing</p>
          <h1>Analysis complete</h1>
          <p>
            {partial
              ? "Your map is available, but some content is incomplete. You can explore the results prepared so far."
              : "Your map is ready. Explore concepts, relationships, sources, and the suggested learning order."}
          </p>
        </div>
      </header>
      <div className="processing-grid">
        <section className="surface processing-card processing-summary">
          <h2>Processing summary</h2>
          <div className="processing-summary-material">
            <span className="file-kind">
              <Icon name="file" />
            </span>
            <div>
              <h3>Material</h3>
              <p>Pages processed: {binding.page_count}</p>
            </div>
          </div>
          <p className={`status-badge ${partial ? "is-partial" : "is-success"}`}>
            {!partial && <Icon name="check" />}
            {partial ? "Partial results available" : "Processing complete"}
          </p>
          <h3>Available content</h3>
          <ul>
            <li>
              <Icon name="check" />
              Concepts and key points linked to their sources
            </li>
            <li>
              <Icon name="check" />
              Relationships between concepts
            </li>
            <li>
              <Icon name="check" />
              Suggested learning order
            </li>
          </ul>
        </section>
        <section className="surface processing-card">
          <h2>Processing stages</h2>
          <ol className="status-timeline">
            {materialProgressStages.slice(0, -1).map((stage) => (
              <li className="is-complete" key={stage}>
                <span>
                  <Icon name="check" />
                </span>
                <div>
                  <strong>{materialProgressStageLabel(stage)}</strong>
                  <p>This stage is complete.</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <div className="surface completion-bar">
        <span className={`completion-icon${partial ? " is-partial" : ""}`}>
          <Icon name={partial ? "map" : "check"} />
        </span>
        <div>
          <strong>{partial ? "Knowledge map created" : "Your knowledge map is ready"}</strong>
          <p>
            {partial
              ? "Explore the concepts, relationships, and sources prepared so far."
              : "Explore concepts, relationships, sources, and the suggested learning order."}
          </p>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() =>
            writeRoute({
              name: "knowledge-map",
              materialId: run.material_id,
              runId: run.run_id,
              structureRevision: binding.knowledge_structure_revision,
            })
          }
        >
          Open knowledge map
          <Icon name="chevron-right" />
        </button>
      </div>
    </section>
  );
}

function ProcessingProgress({ run, now }: { run: MaterialProcessingRunView; now: number }) {
  const currentPercent = materialCurrentStagePercent(run);
  const overallPercent = materialOverallProgressPercent(run);
  const stageLabel = materialProgressStageLabel(run.progress_stage);
  const stageActivity =
    run.progress_stage === "queued"
      ? "Queued"
      : run.progress_stage === "publishing"
        ? "Publishing"
        : "Processing";
  return (
    <>
      <div className="processing-status" aria-live="polite">
        <div className="progress-heading overall-heading">
          <h2>Overall progress (estimated)</h2>
          <strong>{overallPercent === null ? "—" : `${overallPercent}%`}</strong>
        </div>
        <progress
          className="processing-progress"
          max={100}
          value={overallPercent ?? undefined}
          aria-label={
            overallPercent === null
              ? "Overall progress estimate is not yet available"
              : `Overall progress (estimated) ${overallPercent}%`
          }
        />
        <p className="progress-estimate-note">Estimated from stages and pages, not time remaining.</p>
        <section className="processing-current">
          <h3>{currentPercent === null ? "Current status" : "Stage progress"}</h3>
          <div className="progress-heading">
            <strong
              className={`stage-label${currentPercent === null ? " stage-status-label" : ""}`}
            >
              {currentPercent === null && (
                <span className="processing-status-indicator" aria-hidden="true" />
              )}
              {stageLabel}
            </strong>
            <strong>{currentPercent === null ? stageActivity : `${currentPercent}%`}</strong>
          </div>
          {currentPercent === null ? (
            <p>
              {run.progress_stage === "queued"
                ? "Waiting for local processing resources. Progress will update automatically."
                : run.progress_stage === "publishing"
                  ? "Assembling and publishing your knowledge map."
                  : "Processing material content."}
            </p>
          ) : (
            <progress
              className="processing-progress"
              max={100}
              value={currentPercent}
              aria-label={`Stage progress ${currentPercent}%, completed ${run.completed_pages} / ${run.total_pages} pages`}
            />
          )}
          {currentPercent !== null && (
            <p className="stage-pages">
              Completed {run.completed_pages} / {run.total_pages} pages
            </p>
          )}
        </section>
      </div>
      {run.source_names && (
        <div className="processing-sources">
          <h2>Sources for this analysis ({run.source_names.length})</h2>
          <ol>
            {run.source_names.map((name, index) => (
              <li key={index}>{name}</li>
            ))}
          </ol>
        </div>
      )}
      <dl className="processing-times">
        <div>
          <dt>Elapsed time</dt>
          <dd>{materialElapsedLabel(run.created_at, now)}</dd>
        </div>
        <div>
          <dt>Last updated</dt>
          <dd>
            <time dateTime={run.updated_at}>
              {new Date(run.updated_at).toLocaleTimeString("en-US")}
            </time>
          </dd>
        </div>
      </dl>
      <p className="processing-leave-note">Progress is saved automatically. Return from My materials whenever you are ready.</p>
    </>
  );
}

function ProcessingTimeline({ run }: { run: MaterialProcessingRunView }) {
  const currentStageIndex = materialProgressStages.indexOf(run.progress_stage);
  return (
    <section className="surface processing-card processing-timeline">
      <header className="processing-timeline-heading">
        <h2>Processing stages</h2>
        <img src="/assets/studydy/processing-laptop.png" alt="" />
      </header>
      <ol className="status-timeline">
        {materialProgressStages.slice(0, -1).map((stage, index) => (
          <li
            aria-current={index === currentStageIndex ? "step" : undefined}
            className={
              index < currentStageIndex
                ? "is-complete"
                : index === currentStageIndex
                  ? "is-active"
                  : undefined
            }
            key={stage}
          >
            <span>
              <Icon
                name={
                  index < currentStageIndex ? "check" : stage === "semantics" ? "map" : "process"
                }
              />
            </span>
            <div>
              <strong>{materialProgressStageLabel(stage)}</strong>
              <p>
                {index < currentStageIndex
                  ? "Completed"
                  : index === currentStageIndex
                    ? "In progress"
                    : "Not started"}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RevisionRun({
  apiClient,
  run,
  now,
  onChange,
}: {
  apiClient: StudydyApiClient;
  run: MaterialProcessingRunView;
  now: number;
  onChange: (run: MaterialProcessingRunView) => void;
}) {
  const [material, setMaterial] = useState<MaterialLibraryItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void apiClient.getMaterial(run.material_id).then(
      (value) => {
        if (!cancelled) setMaterial(value);
      },
      (failure) => {
        if (!cancelled) setError(errorMessage(failure));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [apiClient, run.material_id, run.status]);
  const currentStructure =
    material?.available_structures.find(
      (item) => item.knowledge_structure_revision === material.head_revision,
    ) ?? material?.available_structures[0];
  const savedSession =
    currentStructure &&
    material?.study_sessions.find(
      (item) => item.knowledge_structure_revision === currentStructure.knowledge_structure_revision,
    );
  const cancelling = run.cancel_requested_at !== null && activeRun(run);
  const completed = run.status === "succeeded" || run.status === "partial";
  const title =
    run.status === "cancelled"
      ? "Update cancelled"
      : cancelling
        ? "Cancelling this update"
        : run.status === "failed"
          ? "Update incomplete"
          : completed
            ? "Material update complete"
            : "Updating material";
  const cancel = async () => {
    if (busy || !run.base_revision) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await apiClient.cancelRevision(run.run_id, run.base_revision));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  const publishedActions = (
    <>
      {currentStructure && (
        <button
          className="primary-button"
          onClick={() =>
            writeRoute({
              name: "knowledge-map",
              materialId: run.material_id,
              runId: currentStructure.run_id,
              structureRevision: currentStructure.knowledge_structure_revision,
            })
          }
        >
          Open current map
        </button>
      )}
      {savedSession && (
        <button
          className="secondary-button"
          onClick={() =>
            writeRoute({
              name: "study-session",
              materialId: run.material_id,
              runId: savedSession.run_id,
              structureRevision: savedSession.knowledge_structure_revision,
              studySessionId: savedSession.study_session_id,
            })
          }
        >
          Continue studying
        </button>
      )}
    </>
  );
  const libraryActions = (
    <>
      <button
        className="text-button"
        onClick={() => writeRoute({ name: "material-sources", materialId: run.material_id })}
      >
        View sources and add files
      </button>
      <button className="text-button" onClick={() => writeRoute({ name: "materials" })}>
        Back to library
      </button>
    </>
  );

  if (activeRun(run))
    return (
      <section className="processing-page task-page is-processing">
        <header className="processing-hero">
          <div>
            <p className="eyebrow">Material update</p>
            <h1>{title}</h1>
            <p>Studydy is analyzing the added content. Your current map and study records remain available during the update.</p>
          </div>
        </header>
        <div className="processing-grid">
          <section className="surface processing-card">
            <ProcessingProgress run={run} now={now} />
            <div className="state-actions">{publishedActions}</div>
            <div className="processing-cancel">
              {cancelling ? (
                <p role="status">
                  Cancellation is recorded and no further results will be applied. The current step may take a moment to stop.
                </p>
              ) : (
                <button className="secondary-button" disabled={busy} onClick={() => void cancel()}>
                  {busy ? "Requesting cancellation…" : "Cancel this update"}
                </button>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </div>
          </section>
          <ProcessingTimeline run={run} />
        </div>
        <div className="state-actions">{libraryActions}</div>
      </section>
    );
  return (
    <section className="processing-page task-page">
      <header className="processing-hero">
        <img
          src={`/assets/studydy/${run.status === "failed" ? "failure-confused" : completed ? "success-jump" : "processing-laptop"}.png`}
          alt=""
        />
        <div>
          <p className="eyebrow">Material update</p>
          <h1>{title}</h1>
          <p>
            {completed
              ? "The updated map is ready. Unchanged points carry forward progress supported by your saved answers."
              : "Your current map and study records are preserved. An updated map becomes available after a successful update."}
          </p>
        </div>
      </header>
      <section className="surface processing-card">
        {run.status === "partial" && (
          <p role="status">Some content needs checking against the sources. You can still use the updated map.</p>
        )}
        {run.source_names && (
          <>
            <h2>Sources for this analysis</h2>
            <ul>
              {run.source_names.map((name, index) => (
                <li key={index}>{name}</li>
              ))}
            </ul>
          </>
        )}
        {run.error_code && (
          <p className="form-error" role="status">
            {run.error_code === "SOURCE_UPDATE_NEEDS_REVIEW"
              ? "Processing stopped on a model review flag; this does not establish a source conflict. Resume the saved results to complete the update."
              : materialFailureMessage(run.error_code)}
          </p>
        )}
        {run.status === "failed" && run.analysis_saved && (
          <p role="status">
            Completed batches are saved locally. Retry with the same sources and settings to resume.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="state-actions">
          {run.status === "failed" && (
            <MaterialRunStartControl
              apiClient={apiClient}
              materialId={run.material_id}
              retryRun={{ runId: run.run_id, saved: !!run.analysis_saved }}
            />
          )}
          {publishedActions}
          {libraryActions}
        </div>
      </section>
    </section>
  );
}
