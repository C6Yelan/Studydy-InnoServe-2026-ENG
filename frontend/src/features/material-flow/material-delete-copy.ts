import type { MaterialLibraryItem, SourceView } from "../../api/contracts";

export function materialDeleteCopy(material?: MaterialLibraryItem | null, sources?: SourceView[]) {
  const hasMap = (material?.available_structures.length ?? 0) > 0;
  const hasHistory = (material?.study_sessions.length ?? 0) > 0;
  const knownSources = sources ?? (material?.source ? [material.source] : []);
  const processing = [material?.latest_attempt, ...knownSources].some(
    (value) => value?.status === "pending" || value?.status === "running",
  );
  const notice = processing
    ? `The current ${hasMap ? "update" : "analysis"} will stop before this material is deleted.`
    : undefined;
  let scope = "This deletes the material and its related content. This cannot be undone.";
  if (hasHistory) {
    scope = `This deletes the material${hasMap ? " and knowledge map" : ""}, together with its study records, questions, and answers. This cannot be undone.`;
  } else if (hasMap) {
    scope = "This deletes the material and its knowledge map. This cannot be undone.";
  } else if (material) {
    const files = sources?.length ? `${sources.length} source files` : "source files";
    const converted = knownSources.some(
      (source) => source.media_type !== "application/pdf" && source.normalized_artifact_id,
    );
    const conversion = converted ? " and their converted files" : "";
    scope = `This deletes the uploaded ${files}${conversion}. This cannot be undone.`;
  }
  return { notice, scope };
}
