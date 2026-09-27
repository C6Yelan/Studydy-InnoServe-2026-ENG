import type { LearnerIdentity } from "./contracts";
import { identity as isLearnerIdentity } from "./response-validation.ts";

const sessionHintKey = "studydy.session-hint";

// A UI restoration hint contains no token and cannot replace cookie/owner authorization.
export function readSessionHint(): LearnerIdentity | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(sessionHintKey) ?? "null");
    if (!isLearnerIdentity(value)) return null;
    return { schema: "learner-identity/v1", learner_id: value.learner_id };
  } catch {
    return null;
  }
}

export function saveSessionHint(identity: LearnerIdentity | null): void {
  try {
    if (identity)
      localStorage.setItem(
        sessionHintKey,
        JSON.stringify({ schema: "learner-identity/v1", learner_id: identity.learner_id }),
      );
    else localStorage.removeItem(sessionHintKey);
  } catch {
    /* Cookies still support login and API access when browser storage is unavailable. */
  }
}
