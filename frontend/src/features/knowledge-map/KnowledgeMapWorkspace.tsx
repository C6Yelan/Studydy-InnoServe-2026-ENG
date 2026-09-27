import { SourceButton, sourceLinks } from "../../ui/SourceButton";
import { useEffect, useMemo, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import {
  Background,
  MarkerType,
  Handle,
  Position,
  Controls,
  ReactFlowProvider,
  useReactFlow,
  useNodesInitialized,
  useUpdateNodeInternals,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { StudydyApiClient } from "../../api/client";
import type {
  KnowledgeStructureView,
  RelationType,
  LearnerProgressView,
  StudySessionView,
} from "../../api/contracts";
import { ConceptContent } from "../../ui/ConceptContent";
import { Icon } from "../../ui/Icon";
import { StateView } from "../../ui/StateView";
import { learningNavigationItems, focusGraph, initialFocusConceptId } from "./knowledge-map";

type Concept = KnowledgeStructureView["concepts"][number];
type Mode = "focus" | "review";
type RestoreFocus = () => void;

const modes: { id: Mode; label: string }[] = [
  { id: "focus", label: "Concept map" },
  { id: "review", label: "Review points" },
];

const relationStyles: Record<RelationType, { label: string; color: string; dashed: boolean }> = {
  prerequisite: { label: "Prerequisite", color: "#5B8DEF", dashed: false },
  part_of: { label: "Part of", color: "#22C55E", dashed: false },
  application: { label: "Application", color: "#06B6D4", dashed: true },
  example: { label: "Example", color: "#F59E0B", dashed: false },
  contrast: { label: "Contrast", color: "#EF4444", dashed: true },
};

const fitViewOptions = { padding: 0.18, minZoom: 0.001, maxZoom: 1.1 };

const learningLabels = {
  not_started: "Not practiced",
  learning: "Learning",
  needs_review: "Needs review",
  mastered: "Mastered",
} as const;

function LearningBadge({
  conceptId,
  progress,
}: {
  conceptId: string;
  progress: LearnerProgressView | null;
}) {
  const state = progress?.concept_states.find((item) => item.concept_id === conceptId);
  const cycle = progress?.assessment_cycles.find((item) => item.concept_id === conceptId);
  const label =
    cycle?.outcome === "passed" && state?.status !== "mastered"
      ? "Check passed"
      : cycle?.pending_count
        ? "Needs practice"
        : state
          ? learningLabels[state.status]
          : null;
  return state && label ? (
    <span className={`map-learning-badge is-${state.status}`}>{label}</span>
  ) : null;
}

function DetailPanel({
  label,
  focusKey,
  close,
  children,
}: {
  label: string;
  focusKey: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const panel = ref.current!;
    const mobile = window.matchMedia("(max-width: 900px)");
    const update = () => {
      if (panel.open) panel.close();
      if (mobile.matches) panel.showModal();
      else panel.show();
    };
    update();
    mobile.addEventListener("change", update);
    return () => {
      mobile.removeEventListener("change", update);
      panel.close();
    };
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      ref.current?.focus({ preventScroll: true });
      ref.current?.scrollTo(0, 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusKey]);
  return (
    <dialog
      ref={ref}
      className="detail-panel"
      aria-label={label}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.target === event.currentTarget &&
          (event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom)
        )
          close();
      }}
    >
      {children}
    </dialog>
  );
}

function nodeKeyboardAction(open: () => void, title: string) {
  return {
    title,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    },
  };
}

function ConceptDetail({
  apiClient,
  concept,
  close,
  view,
  progress,
  studyAction,
}: {
  view: KnowledgeStructureView;
  progress: LearnerProgressView | null;
  apiClient: StudydyApiClient;
  concept: Concept;
  close: () => void;
  studyAction: ReactNode;
}) {
  return (
    <DetailPanel label="Concept details" focusKey={concept.concept_id} close={close}>
      <header>
        <div>
          <span className="detail-kicker">Source concept</span>
          <h2>{concept.label}</h2>
        </div>
        <button aria-label="Close concept details" className="panel-close" type="button" onClick={close}>
          ×
        </button>
      </header>
      <LearningBadge conceptId={concept.concept_id} progress={progress} />
      {studyAction}
      <section>
        <h3>Key points</h3>
        <ConceptContent
          claims={concept.claims}
          apiClient={apiClient}
          sourceResolver={view.source_resolver}
        />
      </section>
    </DetailPanel>
  );
}

type ConceptHandle = {
  id: string;
  type: "source" | "target";
  position: Position.Left | Position.Right;
  offset: number;
};
type ConceptNode = Node<{ label: ReactNode; handles: ConceptHandle[] }, "concept">;

function ConceptMapNode({ data }: NodeProps<ConceptNode>) {
  // ResizeObserver measures nodes; MapGraph batches topology changes.
  return (
    <>
      {data.handles.map((handle) => (
        <Handle
          key={handle.id}
          id={handle.id}
          type={handle.type}
          position={handle.position}
          style={{ top: `${handle.offset}%` }}
        />
      ))}
      {data.label}
    </>
  );
}
const nodeTypes = { concept: ConceptMapNode };

function LearningNavigator({
  view,
  selectedConceptId,
  focusConcept,
  progress,
}: {
  progress: LearnerProgressView | null;
  view: KnowledgeStructureView;
  selectedConceptId: string;
  focusConcept: (id: string) => void;
}) {
  const items = useMemo(() => learningNavigationItems(view), [view]);
  const states = useMemo(
    () => new Map(progress?.concept_states.map((state) => [state.concept_id, state])),
    [progress],
  );
  const firstStep = items[0]?.step;
  const currentStep = view.initial_learning_path.find(
    (step) => step.concept_id === progress?.current_concept_id,
  );
  const mastered =
    progress?.concept_states.filter((state) => state.status === "mastered").length ?? 0;
  const nextId =
    progress && ["advance", "review_prerequisite", "resume"].includes(progress.next_action.action)
      ? progress.next_action.target_concept_id
      : null;
  const list = useRef<HTMLDivElement>(null);
  const selectedRow = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const rail = list.current!;
    const reveal = () => {
      if (!selectedRow.current || !rail.clientHeight) return;
      const item = selectedRow.current.getBoundingClientRect();
      const bounds = rail.getBoundingClientRect();
      if (item.top < bounds.top) rail.scrollTop += item.top - bounds.top;
      else if (item.bottom > bounds.bottom) rail.scrollTop += item.bottom - bounds.bottom;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [selectedConceptId]);
  return (
    <nav className="focus-navigator surface" aria-label="Learning guide">
      <header>
        <h2>Learning guide</h2>
        <span>Concepts: {view.concepts.length}</span>
      </header>
      {(progress || firstStep) && (
        <p className="navigator-summary">
          {progress ? (
            <>
              {currentStep &&
                `Step ${currentStep.position} / ${view.initial_learning_path.length} · `}
              Mastered: {mastered}
            </>
          ) : (
            `Start with concept ${firstStep!.position}`
          )}
        </p>
      )}
      <div className="navigator-list" id="focus-concept-list" ref={list}>
        <ul>
          {items.map(({ concept, step }) => {
            const selected = concept.concept_id === selectedConceptId;
            const learningCurrent = concept.concept_id === progress?.current_concept_id;
            const status = states.get(concept.concept_id)?.status;
            const next = concept.concept_id === nextId && !learningCurrent;
            const stateLabel =
              status === "mastered" ? "Mastered" : status === "needs_review" ? "Needs review" : "";
            const name = [
              `Concept ${step.position}: ${concept.label}`,
              learningCurrent && "Current study",
              stateLabel,
              next && "Next step",
            ]
              .filter(Boolean)
              .join("；");
            return (
              <li key={concept.concept_id}>
                <button
                  ref={selected ? selectedRow : undefined}
                  type="button"
                  aria-label={name}
                  aria-current={selected ? "true" : undefined}
                  className={[
                    selected && "is-selected",
                    learningCurrent && "is-learning-current",
                    status === "mastered" && "is-mastered",
                    status === "needs_review" && "is-needs-review",
                    next && "is-next-suggested",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => focusConcept(concept.concept_id)}
                >
                  <span className="navigator-position" aria-hidden="true">
                    {step.position}
                  </span>
                  <span className="navigator-concept">
                    <span className="navigator-label">{concept.label}</span>
                    {(learningCurrent || next) && (
                      <span className="navigator-notes">
                        {learningCurrent ? (
                          <span className="navigator-current">Current study</span>
                        ) : (
                          <span>Next step</span>
                        )}
                      </span>
                    )}
                  </span>
                  {stateLabel && (
                    <span className="navigator-state" title={stateLabel} aria-hidden="true">
                      <Icon name={status === "mastered" ? "check" : "warning"} size={15} />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

function MapGraph({
  openConcept,
  selectedConceptId,
  view,
  openRelation,
  progress,
  selectedRelationId,
  detail,
}: {
  detail: ReactNode;
  selectedRelationId: string | null;
  progress: LearnerProgressView | null;
  openConcept: (id: string, restoreFocus?: RestoreFocus) => void;
  selectedConceptId: string;
  view: KnowledgeStructureView;
  openRelation: (id: string, restoreFocus?: RestoreFocus) => void;
}) {
  const conceptById = useMemo(
    () => new Map(view.concepts.map((concept) => [concept.concept_id, concept])),
    [view.concepts],
  );
  const selected = conceptById.get(selectedConceptId) ?? view.concepts[0];
  const highlightedRelation = view.relations.find(
    (relation) => relation.relation_id === selectedRelationId,
  );
  const graphElement = useRef<HTMLDivElement>(null);
  // Measurement may recreate edges; restore focus by stable ID instead of retaining a removed SVG node.
  const restoreGraphFocus = (id: string) => {
    const element = graphElement.current?.querySelector<HTMLElement | SVGElement>(
      `[data-id="${CSS.escape(id)}"]`,
    );
    (element ?? navigatorToggle.current)?.focus({ preventScroll: true });
  };
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const navigatorToggle = useRef<HTMLButtonElement>(null);
  const graph = useReactFlow();
  const initialized = useNodesInitialized();
  // Retain React Flow dimensions on controlled nodes so detail updates do not restart measurement forever.
  const [measurements, setMeasurements] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const measureNodes = (changes: NodeChange[]) => {
    setMeasurements((previous) => {
      let next = previous;
      for (const change of changes) {
        if (change.type !== "dimensions" || !change.dimensions) continue;
        const before = previous[change.id];
        if (
          before?.width === change.dimensions.width &&
          before?.height === change.dimensions.height
        )
          continue;
        if (next === previous) next = { ...previous };
        next[change.id] = change.dimensions;
      }
      return next;
    });
  };
  const [canvasReady, setCanvasReady] = useState(false);
  const fittedConcept = useRef<string | null>(null);
  const projection = useMemo(
    () => focusGraph(view, selected.concept_id),
    [view, selected.concept_id],
  );
  const layout = projection.nodes;
  const updateNodeInternals = useUpdateNodeInternals();
  const measuredLayout = useRef<typeof layout | null>(null);
  useEffect(() => {
    if (!initialized || measuredLayout.current === layout) return;
    measuredLayout.current = layout;
    // Update handles only for focus/data changes, not each measured dimension write.
    updateNodeInternals(layout.map((node) => node.id));
  }, [layout, initialized, updateNodeInternals]);
  const { nodes, edges } = useMemo(() => {
    const layoutById = new Map(layout.map((node) => [node.id, node]));
    // Share handle ordering for bidirectional relations so parallel labels and arrows remain distinct.
    const pairRelations = new Map<string, KnowledgeStructureView["relations"]>();
    for (const relation of projection.relations) {
      const key = [relation.source_concept_id, relation.target_concept_id].sort().join("|");
      const group = pairRelations.get(key) ?? [];
      group.push(relation);
      pairRelations.set(key, group);
    }
    const handlesByNode = new Map<string, ConceptHandle[]>();
    const minimumHeights = new Map<string, number>();
    for (const group of pairRelations.values()) {
      group.sort((a, b) => a.relation_id.localeCompare(b.relation_id));
      group.forEach((relation, index) => {
        const source = layoutById.get(relation.source_concept_id)!;
        const target = layoutById.get(relation.target_concept_id)!;
        const sourcePosition = source.x < target.x ? Position.Right : Position.Left;
        const targetPosition = sourcePosition === Position.Right ? Position.Left : Position.Right;
        for (const [nodeId, type, position] of [
          [source.id, "source", sourcePosition],
          [target.id, "target", targetPosition],
        ] as const) {
          // Separate parallel labels by at least 24px to avoid overlap on short cards.
          minimumHeights.set(
            nodeId,
            Math.max(minimumHeights.get(nodeId) ?? 110, (group.length + 1) * 24),
          );
          const handles = handlesByNode.get(nodeId) ?? [];
          handles.push({
            id: `${relation.relation_id}:${type}`,
            type,
            position,
            offset: ((index + 1) * 100) / (group.length + 1),
          });
          handlesByNode.set(nodeId, handles);
        }
      });
    }
    const nodes: Node[] = layout.map((node) => {
      const concept = conceptById.get(node.id)!;
      const current = node.id === selected.concept_id;
      return {
        id: node.id,
        type: "concept",
        position: { x: node.x, y: node.y },
        width: node.width,
        measured: measurements[node.id],
        style: {
          width: node.width,
          minHeight: minimumHeights.get(node.id),
          opacity:
            highlightedRelation &&
            ![
              highlightedRelation.source_concept_id,
              highlightedRelation.target_concept_id,
            ].includes(node.id)
              ? 0.5
              : 1,
        },
        data: {
          handles: handlesByNode.get(node.id) ?? [],
          label: (
            <>
              <strong>{concept.label}</strong>
              <p>{concept.claims[0]?.text}</p>
              <LearningBadge conceptId={concept.concept_id} progress={progress} />
            </>
          ),
        },
        className: `concept-flow-node${current ? " is-focus" : ""}${node.depth === 2 ? " is-secondary" : ""}`,
        ariaLabel: `Source concept: ${concept.label}`,
        ariaRole: "button",
        domAttributes: nodeKeyboardAction(
          () => openConcept(node.id, () => restoreGraphFocus(node.id)),
          `${concept.label}: view the concept and sources`,
        ),
        draggable: false,
        focusable: true,
      };
    });
    const edges: Edge[] = projection.relations.map((relation) => {
      const source = layoutById.get(relation.source_concept_id)!;
      const target = layoutById.get(relation.target_concept_id)!;
      const { label, color, dashed } = relationStyles[relation.type];
      return {
        id: relation.relation_id,
        source: source.id,
        target: target.id,
        type: "default",
        sourceHandle: `${relation.relation_id}:source`,
        targetHandle: `${relation.relation_id}:target`,
        label,
        selected: relation.relation_id === selectedRelationId,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color,
          width: 18,
          height: 18,
        },
        style: {
          stroke: color,
          strokeWidth: 1.5,
          strokeDasharray: dashed ? "6 4" : undefined,
        },
        labelStyle: { fill: color, fontSize: 11 },
        labelBgPadding: [4, 2],
        className: `concept-flow-edge is-relation is-${relation.type}`,
        ariaLabel: `${label}: ${relation.learner_reason}`,
        focusable: true,
        domAttributes: {
          onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openRelation(relation.relation_id, () => restoreGraphFocus(relation.relation_id));
            }
          },
        },
      };
    });
    return { nodes, edges };
  }, [
    layout,
    projection.relations,
    selected.concept_id,
    highlightedRelation,
    conceptById,
    progress,
    openConcept,
    openRelation,
    measurements,
  ]);
  // Resizing preserves the world-coordinate center; only an explicit fit action changes the scale.
  useEffect(() => {
    const element = graphElement.current!;
    let width = element.clientWidth;
    let height = element.clientHeight;
    const observer = new ResizeObserver(() => {
      const nextWidth = element.clientWidth,
        nextHeight = element.clientHeight;
      setCanvasReady(nextWidth > 0 && nextHeight > 0);
      if (
        width &&
        height &&
        nextWidth &&
        nextHeight &&
        (width !== nextWidth || height !== nextHeight)
      ) {
        const viewport = graph.getViewport();
        void graph.setViewport({
          ...viewport,
          x: viewport.x + (nextWidth - width) / 2,
          y: viewport.y + (nextHeight - height) / 2,
        });
      }
      width = nextWidth;
      height = nextHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [graph]);
  useEffect(() => {
    if (!initialized || !canvasReady || fittedConcept.current === selected.concept_id) return;
    const frame = requestAnimationFrame(() => {
      fittedConcept.current = selected.concept_id;
      void graph.fitView(fitViewOptions);
    });
    return () => cancelAnimationFrame(frame);
  }, [initialized, canvasReady, graph, selected.concept_id]);
  return (
    <section
      className={`focus-workspace${detail ? " has-inspector" : ""}`}
      aria-label="Concept map workspace"
    >
      <div
        className="focus-graph surface"
        ref={graphElement}
        aria-label={`Two-hop neighborhood of ${selected.label}`}
      >
        <ReactFlow
          nodeTypes={nodeTypes}
          nodes={nodes}
          edges={edges}
          onNodesChange={measureNodes}
          proOptions={{ hideAttribution: true }}
          ariaLabelConfig={{
            "controls.zoomIn.ariaLabel": "Zoom in",
            "controls.zoomOut.ariaLabel": "Zoom out",
            "controls.fitView.ariaLabel": "Fit to view",
            "node.a11yDescription.default": "Press Enter or Space to view this concept.",
            "edge.a11yDescription.default": "Press Enter or Space to view this relationship.",
          }}
          minZoom={0.001}
          maxZoom={1.8}
          zoomOnScroll={true}
          preventScrolling={true}
          nodesConnectable={false}
          nodesDraggable={false}
          edgesReconnectable={false}
          onNodeClick={(_, node) => openConcept(node.id, () => restoreGraphFocus(node.id))}
          onEdgeClick={(_, edge) => openRelation(edge.id, () => restoreGraphFocus(edge.id))}
        >
          <Background color="var(--border)" gap={28} size={1} />
          <Controls
            aria-label="Map zoom controls"
            showInteractive={false}
            fitViewOptions={fitViewOptions}
          />
        </ReactFlow>
        <div
          className="map-navigation"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setNavigatorOpen(false);
              navigatorToggle.current?.focus();
            }
          }}
        >
          <button
            ref={navigatorToggle}
            className="secondary-button"
            type="button"
            aria-expanded={navigatorOpen}
            aria-controls="map-navigator"
            onClick={() => {
              navigatorToggle.current?.focus();
              setNavigatorOpen((value) => !value);
            }}
          >
            Learning guide
          </button>
          <div id="map-navigator" hidden={!navigatorOpen}>
            <LearningNavigator
              progress={progress}
              view={view}
              selectedConceptId={selected.concept_id}
              focusConcept={(id) => {
                setNavigatorOpen(false);
                openConcept(id, () => navigatorToggle.current?.focus());
              }}
            />
          </div>
        </div>
        {(nodes.length < projection.totalNodes || edges.length < projection.totalRelations) && (
          <p className="map-limit-note" role="status">
            Two-hop view: {nodes.length}/{projection.totalNodes} concepts, {edges.length}/
            {projection.totalRelations}  relationships.  Use search or the learning guide to explore more related content.
          </p>
        )}
        <div className="relation-legend" aria-label="Relationship legend">
          {Object.entries(relationStyles).map(([type, { label, color, dashed }]) => (
            <span key={type} style={{ color }}>
              <i className={`relation-swatch${dashed ? " is-dashed" : ""}`} aria-hidden="true" />
              {label}
            </span>
          ))}
        </div>
      </div>
      {detail && (
        <aside className="focus-context surface" aria-label="Map details">
          {detail}
        </aside>
      )}
    </section>
  );
}

function RelationDetail({
  relation,
  view,
  apiClient,
  close,
  openConcept,
}: {
  relation: KnowledgeStructureView["relations"][number];
  view: KnowledgeStructureView;
  apiClient: StudydyApiClient;
  close: () => void;
  openConcept: (id: string) => void;
}) {
  const evidence = view.concepts
    .flatMap((concept) => concept.claims.flatMap((claim) => claim.evidence))
    .filter((item) => relation.evidence_refs.includes(item.evidence_id));
  return (
    <DetailPanel label="Relationship details" focusKey={relation.relation_id} close={close}>
      <header>
        <div>
          <span className="detail-kicker">Relationship between concepts</span>
          <h2>{relationStyles[relation.type].label}</h2>
        </div>
        <button className="panel-close" type="button" aria-label="Close relationship details" onClick={close}>
          ×
        </button>
      </header>
      <section className="relation-direction">
        {[relation.source_concept_id, relation.target_concept_id].map((id, index) => (
          <div key={index}>
            {index === 1 && <span aria-hidden="true">↓</span>}
            <button className="detail-related" type="button" onClick={() => openConcept(id)}>
              <small>{index === 0 ? "Source concept" : "Target concept"}</small>
              <strong>{view.concepts.find((concept) => concept.concept_id === id)?.label}</strong>
            </button>
          </div>
        ))}
      </section>
      <section>
        <h3>Why are these concepts related?</h3>
        <p className="claim-text">{relation.learner_reason}</p>
      </section>
      <section>
        <h3>Sources</h3>
        {sourceLinks(evidence).map((item) => (
          <SourceButton
            key={item.evidence_id}
            apiClient={apiClient}
            resolver={view.source_resolver}
            evidence={item}
          />
        ))}
        {evidence.length === 0 && <p>Open either concept to view the relevant sources.</p>}
      </section>
    </DetailPanel>
  );
}

function ReviewView({
  view,
  progress,
  startStudy,
  busyLabel,
  studyLabel,
  selectedId,
  onSelect,
  showNavigator,
  apiClient,
  loading,
}: {
  view: KnowledgeStructureView;
  progress: LearnerProgressView | null;
  selectedId: string;
  onSelect: (id: string) => void;
  startStudy: (id: string) => void;
  busyLabel: string | null;
  studyLabel: string;
  showNavigator: () => void;
  apiClient: StudydyApiClient;
  loading: boolean;
}) {
  const conceptById = useMemo(
    () => new Map(view.concepts.map((concept) => [concept.concept_id, concept])),
    [view.concepts],
  );
  const weakStates =
    progress?.concept_states.filter((state) => state.status === "needs_review") ?? [];
  const selectedState =
    weakStates.find((state) => state.concept_id === selectedId) ?? weakStates[0];
  const concept = selectedState && conceptById.get(selectedState.concept_id);
  const points =
    concept?.claims.filter((claim) => selectedState.weak_claim_ids.includes(claim.claim_id)) ?? [];
  return (
    <section aria-labelledby="review-title">
      <div className="view-heading">
        <div>
          <h2 id="review-title">Review points</h2>
          <p>Based on your latest results, start by reviewing these concepts.</p>
        </div>
      </div>
      {loading && !progress ? (
        <p role="status">Loading review points…</p>
      ) : !concept ? (
        <div className="review-empty">
          <div>
            <h3>{progress ? "No concepts need review right now" : "Practice to discover what to review"}</h3>
            <p>
              {progress
                ? "Return to the learning guide to explore another concept."
                : "Study a concept and answer its questions to see points that need more practice."}
            </p>
            <button className="secondary-button" type="button" onClick={showNavigator}>
              Open learning guide
            </button>
          </div>
        </div>
      ) : (
        <div className="review-workspace">
          <nav className="review-list" aria-label="Concepts to review">
            <h3>
              Needs review <small>Concepts: {weakStates.length}</small>
            </h3>
            <ul>
              {weakStates.map((state) => {
                const item = conceptById.get(state.concept_id)!;
                return (
                  <li key={state.concept_id}>
                    <button
                      type="button"
                      aria-current={state.concept_id === concept.concept_id ? "true" : undefined}
                      onClick={() => onSelect(state.concept_id)}
                    >
                      <strong>{item.label}</strong>
                      <Icon name="chevron-right" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          <header className="review-context">
            <h3>{concept.label}</h3>
          </header>
          <section
            className="review-points"
            aria-label="Review points for the selected concept"
            key={concept.concept_id}
          >
            <h3>Points to practice</h3>
            <ol>
              {points.map((claim) => (
                <li key={claim.claim_id}>
                  <p>{claim.text}</p>
                  <div className="review-claim-sources" role="group" aria-label="Sources">
                    {sourceLinks(claim.evidence).map((evidence) => (
                      <SourceButton
                        key={evidence.evidence_id}
                        apiClient={apiClient}
                        resolver={view.source_resolver}
                        evidence={evidence}
                      />
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </section>
          <aside className="review-actions" aria-label="Review actions">
            <h3>What to do next</h3>
            <button
              className="primary-button"
              type="button"
              disabled={!!busyLabel}
              onClick={() => startStudy(concept.concept_id)}
            >
              {busyLabel ?? studyLabel}
            </button>
            <button className="text-button" type="button" onClick={showNavigator}>
              Open learning guide
              <Icon name="chevron-right" />
            </button>
          </aside>
        </div>
      )}
    </section>
  );
}

export function KnowledgeMapWorkspace({
  apiClient,
  progress,
  isLoadingProgress,
  learningStateStatus,
  progressMessage,
  onReloadProgress,
  isStartingStudy,
  onReturnToRun,
  onAddSources,
  onStartStudy,
  startMessage,
  view,
}: {
  apiClient: StudydyApiClient;
  progress: LearnerProgressView | null;
  learningStateStatus: StudySessionView["status"] | null;
  isLoadingProgress: boolean;
  progressMessage: string | null;
  onReloadProgress: () => void;
  isStartingStudy: boolean;
  onReturnToRun: () => void;
  onAddSources: () => void;
  onStartStudy: (conceptId: string) => void;
  startMessage: string | null;
  view: KnowledgeStructureView;
}) {
  const initialConceptId = progress?.current_concept_id ?? initialFocusConceptId(view);
  // Remember presentation in browser history only; the API owns authentication, answers, and progress.
  const [restored] = useState(() => {
    const saved = window.history.state?.knowledgeMap;
    if (saved?.revision !== view.knowledge_structure_revision) return null;
    const conceptId = (id: unknown) =>
      typeof id === "string" && view.concepts.some((concept) => concept.concept_id === id)
        ? id
        : null;
    return {
      mode: saved.mode === "review" ? ("review" as const) : ("focus" as const),
      search: typeof saved.search === "string" ? saved.search : "",
      concept: conceptId(saved.concept),
      review: conceptId(saved.review),
      detail: conceptId(saved.detail),
      relation:
        typeof saved.relation === "string" &&
        view.relations.some((relation) => relation.relation_id === saved.relation)
          ? (saved.relation as string)
          : null,
    };
  });
  const [mode, setMode] = useState<Mode>(restored?.mode ?? "focus");
  const [searchQuery, setSearchQuery] = useState(restored?.search ?? "");
  const [selectedConceptId, setSelectedConceptId] = useState(restored?.concept ?? initialConceptId);
  const [reviewConceptId, setReviewConceptId] = useState(restored?.review ?? initialConceptId);
  const [detailConceptId, setDetailConceptId] = useState<string | null>(restored?.detail ?? null);
  const [relationId, setRelationId] = useState<string | null>(restored?.relation ?? null);
  useEffect(() => {
    window.history.replaceState(
      {
        ...window.history.state,
        knowledgeMap: {
          revision: view.knowledge_structure_revision,
          mode,
          search: searchQuery,
          concept: selectedConceptId,
          review: reviewConceptId,
          detail: detailConceptId,
          relation: relationId,
        },
      },
      "",
      window.location.href,
    );
  }, [
    view.knowledge_structure_revision,
    mode,
    searchQuery,
    selectedConceptId,
    reviewConceptId,
    detailConceptId,
    relationId,
  ]);
  const opener = useRef<RestoreFocus | null>(null);
  const restoreFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(restoreFrame.current), []);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchResultsElement = useRef<HTMLDivElement>(null);
  const tabs = useRef(new Map<Mode, HTMLButtonElement>());
  const hasBrowsed = useRef(!!restored?.concept);
  useEffect(() => {
    if (
      !hasBrowsed.current &&
      progress?.current_concept_id &&
      view.concepts.some((concept) => concept.concept_id === progress.current_concept_id)
    ) {
      setSelectedConceptId(progress.current_concept_id);
    }
  }, [progress?.study_session_id, progress?.current_concept_id, view.concepts]);
  const selectedRelation = view.relations.find((relation) => relation.relation_id === relationId);
  const query = searchQuery.trim().toLocaleLowerCase();
  const searchResults = query
    ? view.concepts.filter((concept) =>
        [concept.label, ...concept.aliases, ...concept.claims.map((claim) => claim.text)].some(
          (text) => text.toLocaleLowerCase().includes(query),
        ),
      )
    : [];
  const selectedConcept = useMemo(
    () => view.concepts.find((concept) => concept.concept_id === detailConceptId) ?? null,
    [detailConceptId, view.concepts],
  );

  if (view.concepts.length === 0)
    return (
      <StateView
        action={
          <div className="state-actions">
            <button className="secondary-button" type="button" onClick={onReturnToRun}>
              <Icon name="arrow-left" />
              View processing status
            </button>
          </div>
        }
        description="This material has no concepts available for study. Return to the processing result for details."
        image="/assets/studydy/empty-disappointed.png"
        title="This knowledge map is empty"
        tone="empty"
      />
    );
  const rememberOpener = (restoreFocus?: RestoreFocus) => {
    // A delayed focus restore from a closed panel must not steal focus from a newly opened one.
    cancelAnimationFrame(restoreFrame.current);
    if (restoreFocus) {
      opener.current = restoreFocus;
      return;
    }
    const element = document.activeElement as HTMLElement | null;
    if (element?.closest(".detail-panel")) return;
    opener.current = () => {
      if (element?.isConnected) element.focus({ preventScroll: true });
      else tabs.current.get(mode)?.focus({ preventScroll: true });
    };
  };
  const openConceptDetail = (id: string, restoreFocus?: RestoreFocus) => {
    hasBrowsed.current = true;
    rememberOpener(restoreFocus);
    setSelectedConceptId(id);
    setDetailConceptId(id);
    setRelationId(null);
  };
  const chooseSearchResult = (id: string) => {
    setMode("focus");
    openConceptDetail(id);
    setSearchQuery("");
    searchInput.current?.focus({ preventScroll: true });
  };
  const openRelation = (id: string, restoreFocus?: RestoreFocus) => {
    rememberOpener(restoreFocus);
    setRelationId(id);
    setDetailConceptId(null);
  };
  const closeDetail = () => {
    const closingFocus = document.activeElement;
    setDetailConceptId(null);
    setRelationId(null);
    // Wait for the next React Flow measurement frame before restoring node or edge focus.
    cancelAnimationFrame(restoreFrame.current);
    restoreFrame.current = requestAnimationFrame(() => {
      restoreFrame.current = requestAnimationFrame(() => {
        // Do not steal focus after the user starts a new action such as search.
        if (document.activeElement !== closingFocus && document.activeElement !== document.body)
          return;
        if (opener.current) opener.current();
        else tabs.current.get(mode)?.focus({ preventScroll: true });
      });
    });
  };
  const selectMode = (nextMode: Mode) => {
    cancelAnimationFrame(restoreFrame.current);
    setMode(nextMode);
    setDetailConceptId(null);
    setRelationId(null);
    window.requestAnimationFrame(() => tabs.current.get(nextMode)?.focus());
  };
  const busyStudyLabel = isLoadingProgress ? "Loading progress…" : isStartingStudy ? "Starting…" : null;
  const focusStudyConceptId = selectedConceptId;
  const canResume = learningStateStatus === "active" || learningStateStatus === "no_safe";
  const selectedIsCurrentSessionConcept =
    canResume && progress?.current_concept_id === focusStudyConceptId;
  const focusStudyButtonLabel =
    busyStudyLabel ??
    (learningStateStatus === "completed"
      ? "View study results"
      : selectedIsCurrentSessionConcept
        ? "Continue studying"
        : canResume
          ? "Continue from this concept"
          : "Start studying");
  const focusStudyAction = (
    <section className="concept-study-action" aria-label="Study actions">
      <button
        className="primary-button"
        disabled={isStartingStudy || isLoadingProgress}
        type="button"
        onClick={() => onStartStudy(focusStudyConceptId)}
      >
        <Icon name="learning" />
        {focusStudyButtonLabel}
      </button>
    </section>
  );
  const detail =
    selectedRelation || selectedConcept ? (
      <>
        {selectedRelation && (
          <RelationDetail
            relation={selectedRelation}
            view={view}
            apiClient={apiClient}
            close={closeDetail}
            openConcept={openConceptDetail}
          />
        )}
        {selectedConcept && (
          <ConceptDetail
            apiClient={apiClient}
            close={closeDetail}
            view={view}
            concept={selectedConcept}
            studyAction={focusStudyAction}
            progress={progress}
          />
        )}
      </>
    ) : null;
  return (
    <section
      className={`map-workspace${mode === "focus" ? " is-focus-mode" : ""}${selectedConcept || selectedRelation ? " has-detail" : ""}`}
    >
      <header className="map-header">
        <div>
          <div className="map-title-row">
            <h1>Knowledge map</h1>
          </div>
        </div>
        <form
          className="map-search"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setSearchQuery("");
              searchInput.current?.focus();
            }
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setSearchQuery("");
          }}
          role="search"
          aria-label="Search source concepts"
          onSubmit={(event) => {
            event.preventDefault();
            if (searchResults[0]) chooseSearchResult(searchResults[0].concept_id);
          }}
        >
          <input
            ref={searchInput}
            type="search"
            aria-label="Search concepts or keywords"
            placeholder="Search concepts or keywords…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setSearchQuery("");
              if (event.key === "ArrowDown") {
                event.preventDefault();
                searchResultsElement.current?.querySelector<HTMLButtonElement>("button")?.focus();
              }
            }}
          />
          {query && (
            <div ref={searchResultsElement} className="map-search-results">
              <p role="status">
                {searchResults.length
                  ? `${searchResults.length} concepts found${searchResults.length > 8 ? "; showing the first 8. Add keywords to narrow your search" : ""}`
                  : "No matching concepts. Try another keyword."}
              </p>
              {searchResults.slice(0, 8).map((concept) => (
                <button
                  key={concept.concept_id}
                  type="button"
                  onClick={() => chooseSearchResult(concept.concept_id)}
                >
                  <strong>{concept.label}</strong>
                  <small>{concept.claims[0]?.text}</small>
                </button>
              ))}
            </div>
          )}
        </form>
        <div className="map-header-actions">
          <button className="secondary-button" type="button" onClick={onAddSources}>
            Add sources
          </button>
          <div className="map-facts" aria-label="Map summary">
            <span>
              <strong>{view.concepts.length}</strong>Concepts
            </span>
            <span>
              <strong>{view.document_tree.sections.length}</strong>Sections
            </span>
            <span>
              <strong>{view.relations.length}</strong>Relations
            </span>
          </div>
        </div>
      </header>
      {progressMessage && (
        <div className="partial-banner" role="status">
          <span>{progressMessage}</span>
          <button className="text-button" type="button" onClick={onReloadProgress}>
            Refresh progress
          </button>
        </div>
      )}
      {startMessage && (
        <p className="map-start-error" role="alert">
          {startMessage}
        </p>
      )}
      <div className="map-tabs" role="tablist" aria-label="Knowledge map views">
        {modes.map((item) => (
          <button
            ref={(element) => {
              if (element) tabs.current.set(item.id, element);
              else tabs.current.delete(item.id);
            }}
            aria-selected={mode === item.id}
            aria-controls={`map-panel-${item.id}`}
            className={mode === item.id ? "is-active" : undefined}
            id={`map-tab-${item.id}`}
            key={item.id}
            role="tab"
            tabIndex={mode === item.id ? 0 : -1}
            type="button"
            onClick={() => selectMode(item.id)}
            onKeyDown={(event) => {
              const currentIndex = modes.findIndex((entry) => entry.id === item.id);
              let nextIndex = currentIndex;
              if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % modes.length;
              else if (event.key === "ArrowLeft")
                nextIndex = (currentIndex - 1 + modes.length) % modes.length;
              else if (event.key === "Home") nextIndex = 0;
              else if (event.key === "End") nextIndex = modes.length - 1;
              else return;
              event.preventDefault();
              selectMode(modes[nextIndex].id);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {view.excluded_pages.length > 0 && (
        <p className="form-error" role="status">
          Excluded pages: {view.excluded_pages.map((item) => item.page).join(", ")}{" "}
          — This content is not included in the map or practice. Read it in the original source.
        </p>
      )}
      <div className="map-content">
        <div
          aria-labelledby={`map-tab-${mode}`}
          className="map-view"
          id={`map-panel-${mode}`}
          role="tabpanel"
          tabIndex={0}
        >
          {mode === "focus" && (
            <ReactFlowProvider>
              <MapGraph
                selectedRelationId={relationId}
                progress={progress}
                openRelation={openRelation}
                openConcept={openConceptDetail}
                selectedConceptId={selectedConceptId}
                detail={detail}
                view={view}
              />
            </ReactFlowProvider>
          )}
          {mode === "review" &&
            (progressMessage ? (
              <div className="review-empty">
                <div>
                  <h2>Review points are temporarily unavailable</h2>
                  <p>Refresh your progress to see the latest review suggestions.</p>
                  <button className="primary-button" type="button" onClick={onReloadProgress}>
                    Refresh progress
                  </button>
                </div>
              </div>
            ) : (
              <ReviewView
                loading={isLoadingProgress}
                view={view}
                progress={progress}
                startStudy={onStartStudy}
                busyLabel={busyStudyLabel}
                studyLabel={learningStateStatus === "completed" ? "View study results" : "Continue this concept"}
                selectedId={reviewConceptId}
                onSelect={setReviewConceptId}
                showNavigator={() => selectMode("focus")}
                apiClient={apiClient}
              />
            ))}
        </div>
      </div>
    </section>
  );
}
