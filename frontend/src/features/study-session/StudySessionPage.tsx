import { useEffect, useRef, useState } from "react";

import { ApiClientError, errorMessage, type StudydyApiClient } from "../../api/client";
import type {
  AssessmentSetSummary,
  KnowledgeStructureView,
  LearnerProgressView,
  StudySessionView,
} from "../../api/contracts";
import { writeRoute, type AppRoute } from "../../app/routes";
import { Icon } from "../../ui/Icon";
import { SourceButton, sourceLinks } from "../../ui/SourceButton";
import { StateView } from "../../ui/StateView";
import { assessmentPhase, type AssessmentPhase } from "../assessment/assessment-phase";
import { AssessmentSetPanel } from "../assessment/AssessmentSetPanel";
import "./styles.css";

type StudyData = {
  progress: LearnerProgressView;
  session: StudySessionView;
  view: KnowledgeStructureView;
  assessmentSets: AssessmentSetSummary[];
  selectedSetId: string | null;
};

function validBinding(data: StudyData): boolean {
  const concepts = new Set(data.view.concepts.map((concept) => concept.concept_id));
  return (
    data.assessmentSets.every((group) => concepts.has(group.target_concept_id)) &&
    data.progress.assessment_cycles.every((cycle) => concepts.has(cycle.concept_id)) &&
    data.progress.concept_states.length === concepts.size &&
    data.progress.concept_states.every((state) => concepts.has(state.concept_id)) &&
    (data.progress.current_concept_id === null || concepts.has(data.progress.current_concept_id)) &&
    data.progress.next_action.prerequisite_concept_ids.every((id) => concepts.has(id))
  );
}

export function StudySessionPage({
  apiClient,
  route,
}: {
  apiClient: StudydyApiClient;
  route: Extract<AppRoute, { name: "study-session" }>;
}) {
  const [data, setData] = useState<StudyData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [panelPhase, setPanelPhase] = useState<AssessmentPhase | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);
  const activePage = useRef(false);
  const pageVersion = useRef(0);

  const load = async () => {
    const restored = await apiClient.resumeStudy(route);
    const next = {
      view: restored.knowledge_structure,
      session: restored.session,
      progress: restored.progress,
      assessmentSets: restored.assessment_sets,
      selectedSetId: restored.selected_set_id,
    };
    if (!validBinding(next)) throw new Error("STUDY_BINDING_MISMATCH");
    return next;
  };

  useEffect(() => {
    let cancelled = false;
    activePage.current = true;
    pageVersion.current += 1;
    setPanelPhase(null);
    setData(null);
    setMessage(null);
    setRefreshMessage(null);
    setContinuing(false);
    setContinueError(null);
    void load().then(
      (next) => {
        if (cancelled) return;
        if (next.selectedSetId && !route.assessmentSetId && next.session.status !== "completed") {
          writeRoute({ ...route, assessmentSetId: next.selectedSetId }, true);
          return;
        }
        setData(next);
      },
      (error) => {
        if (!cancelled) setMessage(errorMessage(error));
      },
    );
    return () => {
      cancelled = true;
      activePage.current = false;
    };
  }, [apiClient, reload, route]);

  const refresh = async () => {
    const version = pageVersion.current;
    try {
      const next = await load();
      if (!activePage.current || pageVersion.current !== version) return;
      setData(next);
      setRefreshMessage(null);
    } catch (error) {
      if (pageVersion.current === version) setRefreshMessage(errorMessage(error));
    }
  };

  const back = () =>
    writeRoute({
      name: "knowledge-map",
      materialId: route.materialId,
      runId: route.runId,
      structureRevision: route.structureRevision,
    });

  if (message)
    return (
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
        title="Unable to open study progress"
        tone="failure"
      />
    );
  if (!data)
    return (
      <StateView
        description="Restoring the material structure and your progress."
        live
        title="Loading study progress"
        tone="loading"
      />
    );

  const completed = data.session.status === "completed";
  const historySets = data.assessmentSets.filter(
    (group) => group.published_count > 0 || ["completed", "cancelled"].includes(group.status),
  );
  const selectedSet = data.assessmentSets.find((group) => group.set_id === data.selectedSetId);
  // History displays each set's concept; continuing study still follows current progress.
  const visibleConceptId = route.assessmentSetId
    ? selectedSet?.target_concept_id
    : data.progress.current_concept_id;
  const visibleConcept = data.view.concepts.find(
    (concept) => concept.concept_id === visibleConceptId,
  );
  if (!visibleConcept)
    return (
      <StateView
        action={
          <button className="secondary-button" type="button" onClick={back}>
            Back to knowledge map
          </button>
        }
        description="No verified concepts are available to display."
        image="/assets/studydy/empty-disappointed.png"
        title="No study content available"
        tone="empty"
      />
    );

  const initialSetPhase = assessmentPhase(selectedSet);
  const layoutMode = panelPhase ?? initialSetPhase;
  const preparing = layoutMode === "preparing" || layoutMode === "intervention";
  const showMaterial = !preparing && layoutMode !== "question";
  const showRail = !preparing && historySets.length > 0;
  const currentCycle = data.progress.assessment_cycles.find(
    (item) => item.concept_id === data.progress.current_concept_id,
  );
  const inheritedCheck = !selectedSet && currentCycle?.inherited_from ? currentCycle : null;
  const nextAction = data.progress.next_action;
  const completesSession = nextAction.action === "complete";
  const nextConcept =
    nextAction.action === "advance"
      ? data.view.concepts.find((item) => item.concept_id === nextAction.target_concept_id)
      : undefined;
  const currentResult =
    !completed &&
    !refreshMessage &&
    ((layoutMode === "result" && selectedSet?.status === "completed") || inheritedCheck) &&
    currentCycle &&
    !currentCycle.active_set_id &&
    ["passed", "incomplete"].includes(currentCycle.outcome);
  const canContinue =
    currentResult &&
    (nextConcept || completesSession) &&
    !data.assessmentSets.some(
      (item) =>
        ["preparing", "partial_ready", "ready", "in_progress"].includes(item.status) &&
        (completesSession || item.target_concept_id === data.progress.current_concept_id),
    );
  const continueLearning = async () => {
    if (!canContinue || continuing) return;
    const version = pageVersion.current;
    setContinuing(true);
    setContinueError(null);
    try {
      await apiClient.applyGuidance(route.studySessionId, {
        schema: "guidance-apply/v1",
        guidance_revision: data.progress.guidance_revision,
      });
      if (!activePage.current || pageVersion.current !== version) return;
      setData(null);
      setPanelPhase(null);
      writeRoute(
        {
          name: "study-session",
          materialId: route.materialId,
          runId: route.runId,
          structureRevision: route.structureRevision,
          studySessionId: route.studySessionId,
        },
        true,
      );
      setReload((value) => value + 1);
    } catch (error) {
      if (!activePage.current || pageVersion.current !== version) return;
      if (error instanceof ApiClientError && error.reasonCode === "LEARNER_GUIDANCE_STALE") {
        setContinueError("Your progress has changed. Check the latest next step before continuing.");
        await refresh();
      } else setContinueError(errorMessage(error));
    } finally {
      if (activePage.current && pageVersion.current === version) setContinuing(false);
    }
  };
  const continuation = canContinue
    ? {
        busy: continuing,
        onContinue: continueLearning,
        label: completesSession
          ? continuing
            ? "Finishing…"
            : "Finish this session"
          : continuing
            ? "Opening the next concept…"
            : `Next concept: ${nextConcept!.label}`,
      }
    : undefined;
  const position = data.view.initial_learning_path.find(
    (step) => step.concept_id === visibleConcept.concept_id,
  )?.position;
  const sourceEvidence = sourceLinks(visibleConcept.claims.flatMap((claim) => claim.evidence));
  const materialCard = (
    <article className="surface current-concept-card" aria-labelledby="study-content-title">
      <p className="eyebrow">Key points</p>
      <h2 id="study-content-title">{visibleConcept.label}</h2>
      <ul className="study-claims">
        {visibleConcept.claims.map((claim) => (
          <li key={claim.claim_id}>{claim.text}</li>
        ))}
      </ul>
      <section className="study-sources" aria-label="Sources">
        <h3>Sources</h3>
        <div>
          {sourceEvidence.map((evidence) => (
            <SourceButton
              key={evidence.evidence_id}
              apiClient={apiClient}
              resolver={data.view.source_resolver}
              evidence={evidence}
            />
          ))}
        </div>
      </section>
    </article>
  );
  return (
    <section className="study-session-page">
      <header className="study-header">
        <div>
          <p className="eyebrow">Study progress</p>
          <h1>{completed ? "Study session completed" : visibleConcept.label}</h1>
          <p>
            {position !== undefined &&
              `Concept ${position} / ${data.view.initial_learning_path.length}`}
            {showMaterial && " · Study progress is saved automatically."}
          </p>
        </div>
      </header>
      {continueError && (
        <div className="assessment-error" role="alert">
          {continueError}
        </div>
      )}
      {refreshMessage && (
        <div className="assessment-error" role="alert">
          {refreshMessage}
          <button className="text-button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      )}
      <div className={`study-workspace is-${layoutMode}-mode${!showRail ? " without-rail" : ""}`}>
        <div className="study-main">
          <div className={`study-learning-grid is-${layoutMode}-mode is-set-mode`}>
            {showMaterial &&
              (layoutMode === "preparation" ? (
                materialCard
              ) : (
                <details className="surface study-material-summary">
                  <summary>Key points and sources</summary>
                  {materialCard}
                </details>
              ))}
            <div className="study-current-action" id="assessment-panel">
              {inheritedCheck ? (
                <section className="surface assessment-cycle inherited-check" aria-label="Carried-over check">
                  <h2>Check passed</h2>
                  <p>All key points and their sources are unchanged. Your passed check carries over from the earlier version.</p>
                  <div className="assessment-set-actions assessment-result-navigation">
                    <button className="secondary-button" onClick={() => writeRoute({
                      name: "study-session",
                      materialId: route.materialId,
                      runId: inheritedCheck.inherited_from!.run_id,
                      structureRevision: inheritedCheck.inherited_from!.knowledge_structure_revision,
                      studySessionId: inheritedCheck.inherited_from!.study_session_id,
                      assessmentSetId: inheritedCheck.diagnostic_set_id,
                    })}>View original result</button>
                    {continuation && (
                      <button className="primary-button" disabled={continuation.busy}
                        onClick={() => void continuation.onContinue()}>{continuation.label}</button>
                    )}
                  </div>
                </section>
              ) : <AssessmentSetPanel
                apiClient={apiClient}
                studySessionId={route.studySessionId}
                selectedSetId={data.selectedSetId}
                concept={visibleConcept}
                view={data.view}
                completed={completed}
                onSetSelected={(id) => writeRoute({ ...route, assessmentSetId: id })}
                onProgressChanged={refresh}
                onBackToMap={back}
                initialPhase={initialSetPhase}
                onPhaseChange={setPanelPhase}
                continuation={continuation}
              />}
            </div>
          </div>
        </div>
        {showRail && (
          <aside className="study-rail" aria-label="Study history">
            <details className="surface assessment-set-history" open>
              <summary>Practice set history({historySets.length})</summary>
              <ol>
                {historySets.map((group, index) => {
                  const label =
                    data.view.concepts.find(
                      (concept) => concept.concept_id === group.target_concept_id,
                    )?.label ?? "Concept";
                  return (
                    <li key={group.set_id}>
                      <button
                        className="text-button"
                        aria-current={group.set_id === data.selectedSetId ? "true" : undefined}
                        onClick={() => {
                          setContinueError(null);
                          writeRoute({ ...route, assessmentSetId: group.set_id });
                        }}
                      >
                        Set {historySets.length - index} ·{" "}
                        {group.kind === "remediation" ? "Follow-up" : "Initial check"} · {label} ·{" "}
                        {group.published_count === 0
                          ? "This practice set has ended"
                          : group.answered_count === 0
                            ? "Not answered"
                            : `Answered ${group.answered_count}/${group.published_count}`}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </details>
          </aside>
        )}
      </div>
    </section>
  );
}
