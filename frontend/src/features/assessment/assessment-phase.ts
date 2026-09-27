import type { AssessmentSetSummary } from "../../api/contracts";

export type AssessmentPhase = "preparation" | "preparing" | "intervention" | "question" | "result";

// Resume summaries and full sets share one phase projection to prevent layout flashes.
export function assessmentPhase(
  group?: Pick<AssessmentSetSummary, "status" | "published_count" | "answered_count"> | null,
): AssessmentPhase {
  if (!group) return "preparation";
  if (group.status === "preparing") return "preparing";
  if (group.status === "partial_ready" || group.status === "failed") return "intervention";
  if (
    ["ready", "in_progress"].includes(group.status) &&
    group.answered_count < group.published_count
  )
    return "question";
  return "result";
}
