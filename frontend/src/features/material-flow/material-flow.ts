import type { FormatCapability, MaterialProcessingRunView } from "../../api/contracts";

export const automaticPollIntervalMs = 1_500;
export const materialProgressStages = [
  "queued",
  "evidence",
  "semantics",
  "publishing",
  "completed",
] as const;

export function materialProgressStageLabel(
  stage: MaterialProcessingRunView["progress_stage"],
): string {
  if (stage === "queued") return "Waiting for processing resources";
  if (stage === "evidence") return "Extracting pages and source evidence";
  if (stage === "semantics") return "Building concepts, relationships, and learning order";
  if (stage === "publishing") return "Publishing the knowledge map";
  return "Processing complete";
}

type ProcessingProgress = Pick<
  MaterialProcessingRunView,
  "status" | "progress_stage" | "completed_pages" | "total_pages"
>;

export function materialCurrentStagePercent(run: ProcessingProgress): number | null {
  if (run.status === "cancelled") return null;
  if (
    run.progress_stage === "completed" &&
    (run.status === "succeeded" || run.status === "partial")
  )
    return 100;
  if (run.progress_stage !== "evidence" && run.progress_stage !== "semantics") return null;
  const total = run.total_pages;
  if (
    total === null ||
    !Number.isSafeInteger(total) ||
    total <= 0 ||
    !Number.isFinite(run.completed_pages)
  )
    return null;
  return Math.round((Math.max(0, Math.min(total, run.completed_pages)) / total) * 100);
}

export function materialOverallProgressPercent(run: ProcessingProgress): number | null {
  if (run.status === "cancelled") return null;
  if (
    run.progress_stage === "completed" &&
    (run.status === "succeeded" || run.status === "partial")
  )
    return 100;
  if (run.progress_stage === "queued") return 0;
  const total = run.total_pages;
  if (
    total === null ||
    !Number.isSafeInteger(total) ||
    total <= 0 ||
    !Number.isFinite(run.completed_pages)
  )
    return null;
  const completed = Math.max(0, Math.min(total, run.completed_pages));
  let done: number;
  if (run.progress_stage === "evidence") done = completed;
  else if (run.progress_stage === "semantics") done = total + completed;
  else if (run.progress_stage === "publishing") done = total * 2;
  else return null;
  // Page extraction and semantics each contribute one pass; publication adds one unit, not a time estimate.
  return Math.min(99, Math.round((done / (total * 2 + 1)) * 100));
}

export function materialElapsedLabel(createdAt: string, now: number): string {
  const startedAt = Date.parse(createdAt);
  if (!Number.isFinite(startedAt) || now < startedAt) return "Just started";
  const totalSeconds = Math.floor((now - startedAt) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function validateSourceFile(
  file: Pick<File, "name" | "size" | "type">,
  formats: FormatCapability[],
): string | null {
  const format = formats.find((item) => file.name.toLowerCase().endsWith(item.extension));
  if (!format) return "This file format is not supported.";
  if (file.type && file.type !== "application/octet-stream" && file.type !== format.media_type)
    return "The file extension does not match its type.";
  if (file.size === 0) return "The file must not be empty.";
  if (file.size > format.max_bytes) return "Each file must be no larger than 100 MiB.";
  return null;
}

export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024 * 1024) return `${Math.max(1, Math.round(sizeBytes / 1024))} KiB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function materialFailureMessage(errorCode: string): string {
  if (errorCode === "KNOWLEDGE_STRUCTURE_INVALID")
    return "The analysis did not pass structural validation during map assembly. No map was published.";
  if (errorCode === "ANALYSIS_ARTIFACT_WRITE_FAILED")
    return "The analysis could not be saved to local storage. Processing has stopped.";
  if (errorCode === "ANALYSIS_CHECKPOINT_INVALID")
    return "Saved analysis data failed integrity checks. Processing stopped without restarting automatically.";
  if (errorCode === "ANALYSIS_RUNTIME_CHANGED")
    return "Saved progress does not match the current analysis settings. Resuming stopped without restarting analysis automatically.";
  if (errorCode === "NO_USABLE_ADDED_CONTENT")
    return "The added sources produced no usable knowledge content. Your current map and study records are preserved.";
  if (errorCode === "SEMANTIC_INPUT_TOO_LARGE")
    return "The source content and concept catalog exceed the analysis input limit. No map was published. Review the analysis settings before retrying.";
  if (errorCode === "SEMANTIC_BUDGET_EXHAUSTED")
    return "The configured test request budget has been reached. No map was published. Check the budget before retrying.";
  if (errorCode === "RESTART_INTERRUPTED") return "Processing was interrupted by a service restart.";
  if (errorCode === "MATERIAL_CONFIGURATION_INVALID" || errorCode === "RUNTIME_BINDING_INVALID") {
    return "The local processing environment did not pass safety checks.";
  }
  if (errorCode === "NO_USABLE_EVIDENCE" || errorCode === "NO_USABLE_CONCEPT") {
    return "No concepts with verifiable source evidence could be produced.";
  }
  return "Analysis could not be completed safely. No knowledge map was published.";
}
