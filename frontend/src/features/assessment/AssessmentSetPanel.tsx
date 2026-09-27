import { useEffect, useLayoutEffect, useRef, useState, type SubmitEvent } from "react";
import { ApiClientError, errorMessage, type StudydyApiClient } from "../../api/client";
import type {
  AssessmentPlanView,
  AssessmentRecordView,
  AssessmentSetAction,
  AssessmentSetAnswer,
  AssessmentSetView,
  KnowledgeStructureView,
} from "../../api/contracts";
import { AssessmentPanel } from "./AssessmentPanel";
import { SourceButton, sourceLinks } from "../../ui/SourceButton";
import { Icon } from "../../ui/Icon";
import { assessmentPhase, type AssessmentPhase } from "./assessment-phase";
import "./sets.css";

type Concept = KnowledgeStructureView["concepts"][number];

export function AssessmentSetPanel({
  apiClient,
  studySessionId,
  selectedSetId,
  concept,
  view,
  completed,
  onSetSelected,
  onProgressChanged,
  onBackToMap,
  initialPhase,
  onPhaseChange,
  continuation,
}: {
  apiClient: StudydyApiClient;
  studySessionId: string;
  selectedSetId: string | null;
  concept: Concept;
  view: KnowledgeStructureView;
  completed: boolean;
  onSetSelected: (id: string) => void;
  onProgressChanged: () => Promise<void>;
  onBackToMap: () => void;
  initialPhase: AssessmentPhase;
  onPhaseChange: (phase: AssessmentPhase) => void;
  continuation?: { label: string; busy: boolean; onContinue: () => Promise<void> };
}) {
  const [plan, setPlan] = useState<AssessmentPlanView | null>(null);
  const [group, setGroup] = useState<AssessmentSetView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const preparationTitle = useRef<HTMLHeadingElement>(null);
  const [reload, setReload] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submissionNeedsRefresh, setSubmissionNeedsRefresh] = useState(false);
  const rejectedSubmission = useRef(false);
  const latestGroup = useRef<AssessmentSetView | null>(null);
  const submissionIntent = useRef<{
    key: string;
    version: number;
    answers: AssessmentSetAnswer[];
  } | null>(null);
  const createIntent = useRef<string | null>(null);
  const actionIntent = useRef<{
    id: string;
    action: AssessmentSetAction;
    key: string;
    version: number;
  } | null>(null);
  const cycleIntent = useRef<{ signature: string; key: string; version: number } | null>(null);
  const alive = useRef(true);
  const selected = useRef(selectedSetId);
  selected.current = selectedSetId;
  const scopeKey = `${studySessionId}/${concept.concept_id}/${selectedSetId ?? ""}`;
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  // Stale responses must not change the current concept or clear another set's selections.
  const isCurrent = () => alive.current && currentScope.current === scopeKey;

  const accept = (next: AssessmentSetView) => {
    if (!isCurrent() || (selected.current && next.set_id !== selected.current)) return false;
    if (
      next.knowledge_structure_revision !== view.knowledge_structure_revision ||
      next.target_concept_id !== concept.concept_id
    ) {
      throw new Error("This practice set does not match the current concept. Reopen your study session.");
    }
    const previous = latestGroup.current;
    if (
      previous?.set_id === next.set_id &&
      (previous.set_version > next.set_version ||
        previous.cycle.set_version > next.cycle.set_version)
    )
      return false;
    latestGroup.current = next;
    if (rejectedSubmission.current || !next.can_complete) {
      submissionIntent.current = null;
      rejectedSubmission.current = false;
      setSubmissionNeedsRefresh(false);
      setSubmissionError(null);
    }
    setGroup(next);
    return true;
  };
  const refresh = async () => {
    if (!group) {
      setReload((value) => value + 1);
      await onProgressChanged();
      return;
    }
    try {
      const next = await apiClient.readAssessmentSet(studySessionId, group.set_id);
      if (accept(next)) {
        setMessage(null);
        return next;
      }
    } catch (error) {
      if (isCurrent()) setMessage(errorMessage(error));
    }
  };

  useEffect(() => {
    let cancelled = false;
    alive.current = true;
    setGroup(null);
    setPlan(null);
    setMessage(null);
    setSelections({});
    setSubmissionError(null);
    submissionIntent.current = null;
    latestGroup.current = null;
    rejectedSubmission.current = false;
    setSubmissionNeedsRefresh(false);
    setBusy(false);
    setStarting(false);
    createIntent.current = null;
    actionIntent.current = null;
    cycleIntent.current = null;
    void (async () => {
      try {
        if (selectedSetId) {
          const restored = await apiClient.readAssessmentSet(studySessionId, selectedSetId);
          if (!cancelled) accept(restored);
        } else if (!completed) {
          const nextPlan = await apiClient.readAssessmentPlan(studySessionId, concept.concept_id);
          if (nextPlan.knowledge_structure_revision !== view.knowledge_structure_revision)
            throw new Error("This practice set does not match the material version.");
          if (!cancelled) setPlan(nextPlan);
        }
      } catch (error) {
        if (!cancelled) setMessage(errorMessage(error));
      }
    })();
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [apiClient, studySessionId, selectedSetId, concept.concept_id, reload]);

  useEffect(() => {
    if (!group || group.status !== "preparing") return;
    const id = group.set_id;
    let cancelled = false,
      fetching = false;
    const timer = window.setInterval(async () => {
      if (fetching) return;
      fetching = true;
      try {
        const next = await apiClient.readAssessmentSet(studySessionId, id);
        if (!cancelled) {
          accept(next);
          setMessage(null);
          if (next.status !== "preparing") await onProgressChanged();
        }
      } catch (error) {
        if (!cancelled) setMessage(errorMessage(error));
      } finally {
        fetching = false;
      }
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [apiClient, studySessionId, group?.set_id, group?.status]);

  const phase = starting ? "preparing" : group ? assessmentPhase(group) : initialPhase;
  const answering = phase === "question";
  useLayoutEffect(() => {
    onPhaseChange(phase);
  }, [phase, onPhaseChange]);
  useEffect(() => {
    preparationTitle.current?.focus();
  }, [phase]);

  const create = async () => {
    if (busy || completed) return;
    setBusy(true);
    setStarting(true);
    setMessage(null);
    if (!createIntent.current) createIntent.current = crypto.randomUUID();
    try {
      const next = await apiClient.createAssessmentSet(
        studySessionId,
        concept.concept_id,
        createIntent.current,
      );
      if (!isCurrent()) return;
      accept(next);
      createIntent.current = null;
      onSetSelected(next.set_id);
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof ApiClientError && error.reasonCode === "ASSESSMENT_SET_ACTIVE") {
        createIntent.current = null;
        try {
          const sets = await apiClient.listAssessmentSets(studySessionId);
          if (!isCurrent()) return;
          if (sets.knowledge_structure_revision !== view.knowledge_structure_revision)
            throw new Error("This practice set does not match the material version.");
          const existing = sets.sets.find(
            (item) =>
              item.target_concept_id === concept.concept_id &&
              sets.active_set_ids.includes(item.set_id),
          );
          if (existing) {
            onSetSelected(existing.set_id);
            return;
          }
          setMessage("The latest state is loaded. You can start this practice set for this concept again.");
        } catch (readError) {
          if (isCurrent()) setMessage(errorMessage(readError));
        }
      } else setMessage(errorMessage(error));
    } finally {
      if (isCurrent()) {
        setBusy(false);
        setStarting(false);
      }
    }
  };

  const action = async (kind: AssessmentSetAction) => {
    if (!group || busy) return;
    setBusy(true);
    setStarting(kind === "retry");
    setMessage(null);
    if (actionIntent.current?.id !== group.set_id || actionIntent.current.action !== kind) {
      actionIntent.current = {
        id: group.set_id,
        action: kind,
        key: crypto.randomUUID(),
        version: group.set_version,
      };
    }
    const intent = actionIntent.current;
    try {
      accept(
        await apiClient.changeAssessmentSet(
          studySessionId,
          group.set_id,
          kind,
          intent.version,
          intent.key,
        ),
      );
      actionIntent.current = null;
      await onProgressChanged();
    } catch (error) {
      if (!isCurrent()) return;
      setMessage(errorMessage(error));
      if (error instanceof ApiClientError && error.reasonCode === "ASSESSMENT_SET_CONFLICT") {
        actionIntent.current = null;
        await refresh();
      }
    } finally {
      if (isCurrent()) {
        setBusy(false);
        setStarting(false);
      }
    }
  };

  const startRemediation = async () => {
    if (!group || busy) return;
    const cycle = group.cycle;
    const signature = cycle.diagnostic_set_id;
    if (cycleIntent.current?.signature !== signature) {
      cycleIntent.current = { signature, key: crypto.randomUUID(), version: cycle.set_version };
    }
    const intent = cycleIntent.current;
    setBusy(true);
    setStarting(true);
    setMessage(null);
    try {
      const next = await apiClient.createRemediationSet(
        studySessionId,
        cycle.diagnostic_set_id,
        intent.version,
        intent.key,
      );
      if (!isCurrent()) return;
      cycleIntent.current = null;
      onSetSelected(next.set_id);
    } catch (error) {
      if (!isCurrent()) return;
      setMessage(errorMessage(error));
      if (error instanceof ApiClientError && error.reasonCode === "ASSESSMENT_SET_CONFLICT") {
        cycleIntent.current = null;
        await refresh();
      }
    } finally {
      if (isCurrent()) {
        setBusy(false);
        setStarting(false);
      }
    }
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!group?.can_complete || busy || submissionNeedsRefresh) return;
    if (!submissionIntent.current) {
      const answers = group.items.flatMap(({ assessment, feedback }) =>
        assessment
          ? [
              {
                assessment_revision: assessment.assessment_revision,
                question_id: assessment.question_id,
                selected_option_id:
                  feedback?.selected_option_id ?? selections[assessment.assessment_revision],
              },
            ]
          : [],
      );
      if (answers.some((answer) => !answer.selected_option_id)) {
        setSubmissionError("Answer every question before submitting the set.");
        return;
      }
      submissionIntent.current = { key: crypto.randomUUID(), version: group.set_version, answers };
    }
    const intent = submissionIntent.current;
    setBusy(true);
    setSubmissionError(null);
    try {
      accept(
        await apiClient.submitAssessmentSet(
          studySessionId,
          group.set_id,
          intent.answers,
          intent.version,
          intent.key,
        ),
      );
      submissionIntent.current = null;
      await onProgressChanged();
    } catch (error) {
      if (!isCurrent()) return;
      if (
        error instanceof ApiClientError &&
        error.status === 409 &&
        error.reasonCode === "ASSESSMENT_SET_CONFLICT"
      ) {
        // Replace a submission intent only after explicit rejection; preserve it when the network result is unknown.
        rejectedSubmission.current = true;
        setSubmissionNeedsRefresh(true);
        const updated = await refresh();
        if (!isCurrent()) return;
        if (updated?.can_complete)
          setSubmissionError("The set is up to date and your selections are preserved. Review them and submit again.");
        else if (!updated) setSubmissionError("The latest set is unavailable. Retrieve your submission result before continuing.");
        if (updated) await onProgressChanged();
      } else setSubmissionError(errorMessage(error));
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };

  const afterAnswer = async () => {
    await refresh();
    await onProgressChanged();
  };
  const closed = group?.status === "completed";
  const prepared = !!group && group.published_count > 0;
  const isRemediation = group?.kind === "remediation";
  const cycleFinished = !!group && ["passed", "incomplete"].includes(group.cycle.outcome);
  const questions: AssessmentRecordView[] =
    group?.items.flatMap((item) =>
      item.assessment && item.created_at
        ? [{ assessment: item.assessment, feedback: item.feedback, can_submit: item.can_submit }]
        : [],
    ) ?? [];
  const selectedCount = questions.filter(
    (record) => record.feedback || selections[record.assessment.assessment_revision],
  ).length;
  const unavailable = group
    ? group.requested_count - group.published_count + group.excluded_count
    : 0;
  const readError = message && (
    <div className="assessment-error" role="alert">
      <span>{message}</span>
      <button className="text-button" onClick={() => void refresh()}>
        Refresh practice set
      </button>
    </div>
  );
  const waiting = phase === "preparing" || phase === "intervention";
  const progressGroup = starting ? null : group;
  const total = progressGroup?.requested_count ?? 0;
  const ready = progressGroup?.verified_count ?? 0;
  const intervention = phase === "intervention";
  const progressText = total > 0 ? `Questions ready: ${ready} / ${total}` : "Loading preparation progress…";
  const reviewClaims =
    group?.cycle.points.flatMap((point) => {
      if (point.result !== "needs_review") return [];
      const claim = concept.claims.find((claim) => claim.claim_id === point.claim_id);
      return claim ? [claim] : [];
    }) ?? [];
  const paper = group && prepared && (
    <form
      className="assessment-paper"
      aria-label="Practice set"
      onSubmit={(event) => void submit(event)}
    >
      <div className="assessment-set-items">
        {questions.map((record, index) => {
          const assessment = record.assessment;
          return (
            <article
              className="assessment-set-item"
              key={assessment.assessment_revision}
              aria-label={`Question ${index + 1}`}
            >
              <p className="assessment-set-number">
                Question {index + 1}
                {record.feedback
                  ? " · Saved"
                  : selections[assessment.assessment_revision]
                    ? " · Selected"
                    : " · Not selected"}
              </p>
              <AssessmentPanel
                apiClient={apiClient}
                record={record}
                completed={closed || completed}
                answerSelection={{
                  value:
                    record.feedback?.selected_option_id ??
                    selections[assessment.assessment_revision] ??
                    null,
                  disabled: busy || !!submissionIntent.current,
                  onChange: (optionId) => {
                    if (!submissionIntent.current) {
                      setSelections((previous) => ({
                        ...previous,
                        [assessment.assessment_revision]: optionId,
                      }));
                      setSubmissionError(null);
                    }
                  },
                }}
                view={view}
              />
            </article>
          );
        })}
      </div>
      {group.can_complete && !completed && (
        <footer className="assessment-set-submit surface">
          {submissionError && (
            <div className="assessment-error" role="alert">
              <span>{submissionError}</span>
              <button className="text-button" type="button" onClick={() => void afterAnswer()}>
                Retrieve submission result
              </button>
            </div>
          )}
          <div className="assessment-set-submit-row">
            <p>
              Selected{" "}
              <strong>
                {selectedCount}/{questions.length}
              </strong>{" "}
               questions<span>Answers are saved and results shown after submission</span>
            </p>
            <button
              className="primary-button"
              type="submit"
              disabled={busy || submissionNeedsRefresh || selectedCount !== questions.length}
              aria-busy={busy}
            >
              {busy ? "Submitting…" : submissionError ? "Submit again" : "Submit and view results"}
            </button>
          </div>
        </footer>
      )}
    </form>
  );
  return (
    <section className="assessment-set-panel" aria-label={`Practice set for ${concept.label}`}>
      {(!closed || waiting) && (
        <header className={`surface assessment-set-header${waiting ? " is-preparing" : ""}`}>
          {waiting ? (
            <>
              <div className="preparation-heading">
                <p className="eyebrow">{isRemediation ? "Targeted follow-up practice" : "Concept check"}</p>
                <h2 ref={preparationTitle} tabIndex={-1}>
                  {starting
                    ? "Starting practice…"
                    : intervention
                      ? ready > 0
                        ? "Some questions are ready"
                        : "The questions are not ready yet."
                      : "Preparing your practice set"}
                </h2>
              </div>
              {intervention && (
                <p>
                  {ready > 0
                    ? `Ready questions: ${ready}${group?.can_publish_partial ? "; you can start with these questions" : ""}${group?.can_retry ? ", or retry the remaining questions" : ""}.`
                    : "Try again later or return to the knowledge map."}
                </p>
              )}
              {!intervention && (
                <div className="preparation-progress">
                  <div className="preparation-progress-heading">
                    <h3>Preparation progress</h3>
                    <p role="status">{total > 0 ? `${ready} / ${total} questions` : progressText}</p>
                  </div>
                  <div
                    className={`preparation-progress-track${total > 0 ? "" : " is-indeterminate"}`}
                    role="progressbar"
                    aria-label="Preparation progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={total > 0 ? Math.round((ready / total) * 100) : undefined}
                    aria-valuetext={progressText}
                  >
                    <span style={total > 0 ? { width: `${(ready / total) * 100}%` } : undefined} />
                  </div>
                </div>
              )}
              {readError}
              {intervention && (
                <div className="assessment-set-actions">
                  {group?.can_publish_partial && (
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() => void action("publish-partial")}
                    >
                      Start ready questions ({ready})
                    </button>
                  )}
                  {group?.can_retry && (
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void action("retry")}
                    >
                      Try again
                    </button>
                  )}
                </div>
              )}
              {!intervention && (
                <p className="preparation-note">Questions appear when ready. You can leave and return later.</p>
              )}
              <div className="assessment-set-actions preparation-navigation">
                <button className="text-button" onClick={onBackToMap}>
                  <Icon name="arrow-left" size={16} />
                  Back to knowledge map
                </button>
              </div>
            </>
          ) : (
            <>
              <div>
                <p className="eyebrow">{isRemediation ? "Targeted follow-up practice" : "Concept check"}</p>
                <h2>
                  {isRemediation
                    ? `Revisit the points you missed in ${concept.label}`
                    : `Check the key points in ${concept.label}`}
                </h2>
                {answering && (
                  <p>
                    Answer every question, then submit the set to view results and follow-up practice. You can change your selections before submitting; unsubmitted selections are not saved.
                  </p>
                )}
              </div>
              {readError}
              {!group && !plan && !message && !completed && (
                <p role="status">Loading the scope of this concept check…</p>
              )}
              {!group && completed && <p>This study session has ended. You can review its questions and answers.</p>}
              {plan && !group && (
                <>
                  {plan.requested_count > 0 && <p>Answer all questions, then submit the set to view your results.</p>}
                  {plan.excluded.length > 0 && (
                    <p>Key points not included in this check: {plan.excluded.length}.</p>
                  )}
                  <button
                    className="primary-button"
                    disabled={busy || plan.requested_count === 0}
                    aria-busy={busy}
                    onClick={() => void create()}
                  >
                    <Icon name="learning" />
                    {busy ? "Creating practice set…" : `Start practice (${plan.requested_count})`}
                  </button>
                </>
              )}
              {group && prepared && (
                <p className="assessment-set-count">
                  Questions in this set: {group.published_count}
                  {unavailable > 0 &&
                    ` · Planned questions: ${group.requested_count}; unassessed points: ${unavailable}`}
                </p>
              )}
              {group && (
                <div className="assessment-set-actions">
                  <button className="text-button" onClick={onBackToMap}>
                    Back to knowledge map
                  </button>
                </div>
              )}
            </>
          )}
        </header>
      )}
      {!waiting && group && closed && (
        <section className="surface assessment-cycle" aria-label="Concept check and follow-up">
          <p className="eyebrow">{isRemediation ? "Targeted follow-up practice" : "Concept check"}</p>
          <h2>{isRemediation ? "Follow-up results" : "Check results"}</h2>
          {readError}
          {group.cycle.outcome === "passed" ? (
            <p className="assessment-cycle-result">You passed this check. This result applies only to the points assessed here.</p>
          ) : group.cycle.outcome === "incomplete" ? (
            <p className="assessment-cycle-result">Some points have not been answered or assessed.</p>
          ) : (
            group.cycle.pending_count > 0 && <p>Review the points you missed, then check your understanding with new questions.</p>
          )}
          <div className="assessment-set-summary" aria-label="Check summary">
            <span>
              {isRemediation ? "Follow-up passed" : "Correct"}
              <strong>
                {group.passed_count} / {group.published_count} questions
              </strong>
            </span>
            {group.cycle.pending_count > 0 && (
              <span>
                {isRemediation ? "Still needs practice" : "Needs practice"}
                <strong>Points: {group.cycle.pending_count}</strong>
              </span>
            )}
            <span>
              {isRemediation ? "Follow-up completed" : "Completed"}
              <strong>
                {group.answered_count} / {group.published_count} questions
              </strong>
            </span>
            {group.kind === "diagnostic" && group.cycle.remediation_passed_count > 0 && (
              <span>
                Improved through follow-up<strong>Points: {group.cycle.remediation_passed_count}</strong>
              </span>
            )}
            {group.cycle.unanswered_count > 0 && (
              <span>
                Unanswered<strong>Points: {group.cycle.unanswered_count}</strong>
              </span>
            )}
            {group.cycle.unavailable_count > 0 && (
              <span>
                Not assessed<strong>Points: {group.cycle.unavailable_count}</strong>
              </span>
            )}
          </div>
          {group.cycle.active_set_id && group.cycle.active_set_id !== group.set_id && (
            <button
              className="primary-button"
              onClick={() => onSetSelected(group.cycle.active_set_id!)}
            >
              Resume follow-up
            </button>
          )}
          {reviewClaims.length > 0 && (
            <section className="assessment-review-section" aria-label="Points to practice">
              <h3>Points to practice</h3>
              <div className="assessment-review-points">
                {reviewClaims.map((claim) => {
                  const references = sourceLinks(claim.evidence);
                  return (
                    <article
                      className="assessment-review-point"
                      key={claim.claim_id}
                      aria-label="Points needing practice"
                    >
                      <p>{claim.text}</p>
                      <div className="assessment-set-actions">
                        {references.map((reference) => (
                          <SourceButton
                            key={reference.evidence_id}
                            apiClient={apiClient}
                            resolver={view.source_resolver}
                            evidence={reference}
                          />
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
          <div className="assessment-set-actions">
            {group.cycle.can_create_remediation && (
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void startRemediation()}
              >
                Start follow-up ({group.cycle.pending_count})
              </button>
            )}
            {cycleFinished && !group.cycle.active_set_id && continuation && (
              <button
                className="primary-button assessment-continue"
                disabled={busy || continuation.busy}
                aria-busy={continuation.busy}
                onClick={() => void continuation.onContinue()}
              >
                {continuation.label}
              </button>
            )}
          </div>
          {!cycleFinished && (
            <div className="assessment-set-actions assessment-result-navigation">
              <button className="text-button" onClick={onBackToMap}>
                Back to knowledge map
              </button>
            </div>
          )}
        </section>
      )}
      {!waiting &&
        group &&
        prepared &&
        (closed ? (
          <details key={group.set_id} className="surface assessment-answer-review">
            <summary>Review answers to the {group.published_count} questions</summary>
            {paper}
          </details>
        ) : (
          paper
        ))}
    </section>
  );
}
