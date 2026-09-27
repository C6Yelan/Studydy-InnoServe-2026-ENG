import { useEffect, useRef, useState } from "react";

import { errorMessage, type StudydyApiClient } from "../../api/client";
import type {
  MaterialLibraryItem,
  MaterialStructureLink,
  StudySessionLink,
} from "../../api/contracts";
import { writeRoute } from "../../app/routes";
import { Icon } from "../../ui/Icon";
import { StateView } from "../../ui/StateView";
import { MaterialManagement } from "./MaterialManagement";
import { formatFileSize } from "./material-flow";

function isProcessing(status: string | undefined) {
  return status === "pending" || status === "running";
}

function openStructure(item: MaterialLibraryItem, structure: MaterialStructureLink) {
  writeRoute({
    name: "knowledge-map",
    materialId: item.material_id,
    runId: structure.run_id,
    structureRevision: structure.knowledge_structure_revision,
  });
}

function openStudy(item: MaterialLibraryItem, session: StudySessionLink) {
  writeRoute({
    name: "study-session",
    materialId: item.material_id,
    runId: session.run_id,
    structureRevision: session.knowledge_structure_revision,
    studySessionId: session.study_session_id,
  });
}

export function MaterialLibrary({ apiClient }: { apiClient: StudydyApiClient }) {
  const [items, setItems] = useState<MaterialLibraryItem[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [startingMaterialId, setStartingMaterialId] = useState<string | null>(null);
  const startCurrentStudy = async (item: MaterialLibraryItem, structure: MaterialStructureLink) => {
    if (startingMaterialId) return;
    setStartingMaterialId(item.material_id);
    try {
      const session = await apiClient.createStudySession({
        schema: "study-session-create/v1",
        material_id: item.material_id,
        knowledge_structure_revision: structure.knowledge_structure_revision,
      });
      writeRoute({
        name: "study-session",
        materialId: item.material_id,
        runId: structure.run_id,
        structureRevision: structure.knowledge_structure_revision,
        studySessionId: session.study_session_id,
      });
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setStartingMaterialId(null);
    }
  };
  const [searchQuery, setSearchQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const pendingRemovals = useRef(new Set<string>());
  const mutationVersion = useRef(0);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const read = async () => {
      const version = mutationVersion.current;
      try {
        const materials = (await apiClient.listMaterials()).materials;
        if (cancelled) return;
        if (version !== mutationVersion.current) {
          timer = window.setTimeout(read, 3000);
          return;
        }
        setItems(materials);
        setMessage(null);
        for (const id of pendingRemovals.current) {
          if (!materials.some((item) => item.material_id === id))
            pendingRemovals.current.delete(id);
        }
        if (
          pendingRemovals.current.size > 0 ||
          materials.some(
            (item) =>
              isProcessing(item.latest_attempt?.status) || isProcessing(item.source?.status),
          )
        ) {
          timer = window.setTimeout(read, 3000);
        }
      } catch (error) {
        if (!cancelled) {
          if (version === mutationVersion.current) setMessage(errorMessage(error));
          else timer = window.setTimeout(read, 3000);
        }
      }
    };
    void read();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apiClient, reload]);

  const libraryClass = "material-library is-collection";
  if (message || items === null) {
    const state = message ? (
      <StateView
        title="Unable to load materials"
        description={message}
        tone="failure"
        action={
          <>
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                setMessage(null);
                setItems(null);
                setReload((value) => value + 1);
              }}
            >
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
      />
    ) : (
      <StateView
        title="Loading your library"
        description="Loading your materials and published results."
        tone="loading"
        live
      />
    );
    return <section className={libraryClass}>{state}</section>;
  }
  const normalize = (text: string) => text.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
  const query = normalize(searchQuery);
  const filteredItems = items.filter((item) => normalize(item.display_name).includes(query));
  const restoreLibraryFocus = () =>
    (searchInput.current ?? heading.current)?.focus({ preventScroll: true });
  const handleRenamed = (updated: MaterialLibraryItem) => {
    mutationVersion.current++;
    setItems(
      (previous) =>
        previous?.map((saved) => (saved.material_id === updated.material_id ? updated : saved)) ??
        null,
    );
    if (!normalize(updated.display_name).includes(query)) restoreLibraryFocus();
  };
  return (
    <section className={libraryClass}>
      <header className="library-header">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            My materials
          </h1>
          <p className="library-subtitle">
            {items.length === 0
              ? "Upload materials to view analysis results and continue studying here."
              : `Saved materials: ${items.length}. Continue studying anytime.`}
          </p>
        </div>
        {items.length > 0 && (
          <div className="state-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => writeRoute({ name: "upload" })}
            >
              Upload materials
            </button>
          </div>
        )}
      </header>
      {items.length > 0 && (
        <form className="library-search" role="search" onSubmit={(event) => event.preventDefault()}>
          <input
            ref={searchInput}
            type="search"
            aria-label="Search material names"
            placeholder="Search material names…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              // Prevent Chromium's Escape-to-clear behavior while retaining the native clear button.
              if (event.key === "Escape") event.preventDefault();
            }}
          />
        </form>
      )}
      {items.length > 0 && query && filteredItems.length === 0 && (
        <div className="library-search-empty" role="status">
          <h2>No materials match “{query}”</h2>
          <p>Try a different material name.</p>
        </div>
      )}
      {items.length === 0 && (
        <section className="library-empty surface" aria-label="Empty library guidance">
          <div className="library-empty-illustration">
            <img src="/assets/studydy/empty-disappointed.png" alt="Studydy sitting beside an empty box" />
          </div>
          <h2>Your library is empty</h2>
          <p>Upload your first document to start learning with Studydy.</p>
          <button
            className="primary-button"
            type="button"
            onClick={() => writeRoute({ name: "upload" })}
          >
            <Icon name="upload" size={18} />
            Upload your first material
          </button>
        </section>
      )}
      <div className="library-grid">
        {filteredItems.map((item) => {
          const latest = item.latest_attempt;
          const available = item.available_structures;
          const structure =
            available.find((value) => value.knowledge_structure_revision === item.head_revision) ??
            available[0];
          const savedSession =
            structure &&
            item.study_sessions.find(
              (state) =>
                state.run_id === structure.run_id &&
                state.knowledge_structure_revision === structure.knowledge_structure_revision,
            );
          const isProcessingRun = isProcessing(latest?.status);
          const studyAction = savedSession ? (
            <button
              className="primary-button"
              type="button"
              onClick={() => openStudy(item, savedSession)}
            >
              {savedSession.status === "completed" ? "View study results" : "Continue studying"}
            </button>
          ) : (
            structure?.base_revision &&
            item.study_sessions.length > 0 && (
              <button
                className="primary-button"
                disabled={startingMaterialId !== null}
                onClick={() => void startCurrentStudy(item, structure)}
              >
                {startingMaterialId === item.material_id ? "Resuming study…" : "Continue with the updated material"}
              </button>
            )
          );
          const mapAction = structure && (
            <button
              className={!studyAction ? "primary-button" : "secondary-button"}
              type="button"
              onClick={() => openStructure(item, structure)}
            >
              Open knowledge map
            </button>
          );
          const deleting = pendingRemovals.current.has(item.material_id);
          return (
            <article
              className={`surface library-item${deleting ? " is-deleting" : ""}`}
              key={item.material_id}
              aria-label={item.display_name}
            >
              <span className="library-file-icon" aria-hidden="true">
                <Icon name="file" size={25} />
              </span>
              <MaterialManagement
                item={item}
                apiClient={apiClient}
                deleting={deleting}
                onRenamed={handleRenamed}
                onDeleted={(state) => {
                  mutationVersion.current++;
                  if (state === "removed") {
                    pendingRemovals.current.delete(item.material_id);
                    setItems(
                      (previous) =>
                        previous?.filter((saved) => saved.material_id !== item.material_id) ?? null,
                    );
                    if (items.length === 1) heading.current?.focus({ preventScroll: true });
                    else restoreLibraryFocus();
                  } else pendingRemovals.current.add(item.material_id);
                  setReload((value) => value + 1);
                }}
              />
              <p className="library-metadata">
                {new Date(item.created_at).toLocaleDateString("en-US")} ·{" "}
                {(item.source_count ?? 1) > 1
                  ? `Files: ${item.source_count}`
                  : formatFileSize(item.size_bytes)}
              </p>
              {isProcessingRun ? (
                <p className="library-state">Building the knowledge map…</p>
              ) : (
                latest?.status === "failed" && (
                  <p className="library-state is-failed">Knowledge map creation failed</p>
                )
              )}
              <fieldset className="state-actions" disabled={deleting}>
                {studyAction}
                {mapAction}
                {latest && (isProcessingRun || latest.status === "failed") ? (
                  <button
                    className={structure ? "text-button" : "primary-button"}
                    type="button"
                    onClick={() =>
                      writeRoute({
                        name: "material-run",
                        materialId: item.material_id,
                        runId: latest.run_id,
                      })
                    }
                  >
                    {isProcessingRun ? "View progress" : "View issue"}
                  </button>
                ) : (
                  !structure && (
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() =>
                        writeRoute({ name: "material-sources", materialId: item.material_id })
                      }
                    >
                      Build a knowledge map
                    </button>
                  )
                )}
              </fieldset>
            </article>
          );
        })}
      </div>
    </section>
  );
}
