import * as validate from "./response-validation.ts";
import type {
  ApiReasonCode,
  AssessmentPlanView,
  AssessmentSetAction,
  AssessmentSetAnswer,
  AssessmentSetListView,
  AssessmentSetView,
  EvidenceSourceView,
  GuidanceApply,
  KnowledgeStructureRequest,
  KnowledgeStructureView,
  KnownApiReasonCode,
  LearnerIdentity,
  LearnerProgressView,
  MaterialDiscardView,
  MaterialLibraryItem,
  MaterialLibraryView,
  MaterialProcessingRunView,
  MaterialRename,
  SourceCapabilities,
  SourceListView,
  StudyResumeView,
  StudySessionCreate,
  StudySessionFocus,
  StudySessionView,
} from "./contracts";

type FetchRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const genericApiMessage = "The request could not be completed. Please try again later.";
const apiErrorMessages: Record<KnownApiReasonCode, string> = {
  INVALID_EMAIL: "Enter a valid email address.",
  INVALID_CREDENTIALS: "Incorrect email or password.",
  ACCOUNT_UNAVAILABLE: "This email is already registered. Use another email address.",
  REQUEST_INVALID: genericApiMessage,
  SESSION_REQUIRED: "Your session has expired. Please sign in again.",
  ORIGIN_NOT_ALLOWED: genericApiMessage,
  RESOURCE_NOT_FOUND: "This resource was not found or you do not have access.",
  LEARNER_GUIDANCE_STALE: "Your progress has changed. Check the next step again.",
  IDEMPOTENCY_CONFLICT: genericApiMessage,
  ASSESSMENT_SET_CONFLICT: "This practice set has changed. Refresh it to continue.",
  ASSESSMENT_SET_ACTIVE: "A practice set is already in progress. Resume it from your history.",
  MATERIAL_TOO_LARGE: "Each file must be no larger than 100 MiB.",
  MATERIAL_NOT_DISCARDABLE: "This material is being deleted. This action is unavailable.",
  SOURCE_NOT_READY: "Conversion is not complete. Wait before starting analysis.",
  NORMALIZER_UNAVAILABLE: "The converter is unavailable. You can still upload PDFs.",
  DUPLICATE_SOURCE: "This file is already in the source list. Select the existing source.",
  REVISION_CONFLICT: "This material has changed. Refresh the current map and sources.",
  REVISION_IN_PROGRESS: "An update is already in progress. View its progress first.",
  SOURCE_IN_USE: "This source is used by an analysis and cannot be removed. Uncheck it to exclude it from this update.",
  SOURCE_BUSY: "This file is being converted. Wait until conversion finishes before removing it.",
  UNSUPPORTED_MEDIA_TYPE: "This file format is not supported. Try a PDF instead.",
  STORAGE_UNAVAILABLE: "Storage is temporarily unavailable. Please try again later.",
  INTERNAL_ERROR: genericApiMessage,
};

const authTimeoutMs = 10_000;

function origin(): string {
  return globalThis.location?.origin ?? "http://127.0.0.1:4173";
}

function safeMessage(reason: ApiReasonCode): string {
  return reason === "UNKNOWN_API_ERROR" ? genericApiMessage : apiErrorMessages[reason];
}

export class ApiClientError extends Error {
  readonly kind: "api" | "network" | "schema" | "input";
  readonly details: {
    status?: number;
    reasonCode: string;
    requestId?: string;
    retryable?: boolean;
  };

  constructor(
    kind: "api" | "network" | "schema" | "input",
    message: string,
    details: { status?: number; reasonCode: string; requestId?: string; retryable?: boolean },
  ) {
    super(message);
    this.name = "ApiClientError";
    this.kind = kind;
    this.details = details;
  }

  get status(): number | null {
    return this.details.status ?? null;
  }
  get reasonCode(): string {
    return this.details.reasonCode;
  }
  get requestId(): string | null {
    return this.details.requestId ?? null;
  }
  get retryable(): boolean {
    return this.details.retryable ?? false;
  }
}

function schemaMismatch(message: string, details: { status?: number } = {}): ApiClientError {
  return new ApiClientError("schema", message, {
    ...details,
    reasonCode: "RESPONSE_SCHEMA_MISMATCH",
  });
}

export class StudydyApiClient {
  private sessionReady: Promise<LearnerIdentity> | null = null;
  private active = true;
  private readonly pending = new Set<AbortController>();
  private readonly fetchRequest: FetchRequest;
  onSessionExpired: (() => void) | null = null;

  constructor(fetchRequest: FetchRequest = fetch.bind(globalThis)) {
    this.fetchRequest = fetchRequest;
  }

  invalidate(): void {
    this.active = false;
    this.sessionReady = null;
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
  }

  private requireActive(): void {
    if (!this.active)
      throw new ApiClientError("api", "Your session has ended. Please sign in again.", {
        reasonCode: "SESSION_REQUIRED",
      });
  }

  async ensureSession(): Promise<LearnerIdentity> {
    this.requireActive();
    if (!this.sessionReady) {
      this.sessionReady = this.json(
        "/v1/session/refresh",
        { method: "POST", headers: { Origin: origin() } },
        validate.identity,
        authTimeoutMs,
      ).finally(() => {
        this.sessionReady = null;
      });
    }
    return this.sessionReady;
  }

  authenticate(
    mode: "login" | "register",
    email: string,
    password: string,
  ): Promise<LearnerIdentity> {
    return this.json(
      mode === "register" ? "/v1/accounts" : "/v1/session/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin() },
        body: JSON.stringify({ email, password }),
      },
      validate.identity,
      authTimeoutMs,
    );
  }

  async logout(): Promise<void> {
    await this.request(
      "/v1/session",
      { method: "DELETE", headers: { Origin: origin() } },
      authTimeoutMs,
    );
  }

  private async request(
    path: string,
    init: RequestInit,
    timeoutMs?: number,
  ): Promise<{ status: number; value: unknown }> {
    this.requireActive();
    const controller = new AbortController();
    this.pending.add(controller);
    let timedOut = false;
    const cancellationError = () =>
      timedOut
        ? new ApiClientError("network", "The connection timed out. Please try again.", {
            reasonCode: "REQUEST_TIMEOUT",
            retryable: true,
          })
        : new ApiClientError("api", "Your session has ended. Please sign in again.", {
            reasonCode: "SESSION_REQUIRED",
          });
    let onAbort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(cancellationError());
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs);
    const checkActive = () => {
      this.requireActive();
      if (controller.signal.aborted) throw cancellationError();
    };
    const read = async () => {
      let response: Response;
      try {
        response = await this.fetchRequest(path, {
          ...init,
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
      } catch {
        checkActive();
        throw new ApiClientError("network", "Unable to connect to Studydy.", {
          reasonCode: "NETWORK_ERROR",
          retryable: true,
        });
      }
      checkActive();
      let value: unknown = null;
      if (response.status !== 204) {
        try {
          value = await response.json();
        } catch {
          /* Distinguish malformed responses from service failures using HTTP status. */
        }
      }
      checkActive();
      if (response.ok) return { status: response.status, value };
      if (!validate.apiError(value)) {
        if (response.status >= 500)
          throw new ApiClientError("network", "Studydy is temporarily unavailable. Please try again later.", {
            status: response.status,
            reasonCode: "SERVICE_UNAVAILABLE",
            retryable: true,
          });
        throw schemaMismatch("The server returned an unexpected response format.", { status: response.status });
      }
      if (response.status === 401 && value.reason_code === "SESSION_REQUIRED") {
        // Cancel other requests while preserving the error from this response.
        this.pending.delete(controller);
        this.invalidate();
        this.onSessionExpired?.();
      }
      const reason = Object.hasOwn(apiErrorMessages, value.reason_code)
        ? (value.reason_code as KnownApiReasonCode)
        : "UNKNOWN_API_ERROR";
      throw new ApiClientError("api", safeMessage(reason), {
        status: response.status,
        reasonCode: reason,
        requestId: value.request_id,
        retryable: value.retryable,
      });
    };
    try {
      return await Promise.race([read(), cancelled]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", onAbort);
      this.pending.delete(controller);
    }
  }

  private async json<T>(
    path: string,
    init: RequestInit,
    guard: (value: unknown) => value is T,
    timeoutMs?: number,
  ): Promise<T> {
    const { status, value } = await this.request(path, init, timeoutMs);
    this.requireActive();
    if (!guard(value)) throw schemaMismatch("The server returned an unexpected response format.", { status });
    return value;
  }

  private post<T>(
    path: string,
    body: unknown,
    key: string,
    guard: (value: unknown) => value is T,
  ): Promise<T> {
    return this.json(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin(), "Idempotency-Key": key },
        body: JSON.stringify(body),
      },
      guard,
    );
  }

  sourceCapabilities(): Promise<SourceCapabilities> {
    return this.json("/v1/source-capabilities", { method: "GET" }, validate.capabilities);
  }
  createDraft(
    name: string,
    key: string,
  ): Promise<{ schema: "material-draft/v1"; material_id: string }> {
    return this.post(
      "/v1/materials",
      { schema: "material-draft-create/v1", display_name: name },
      key,
      validate.materialDraft,
    );
  }
  uploadSource(
    materialId: string,
    file: File,
    mediaType: string,
    key: string,
  ): Promise<SourceListView> {
    return this.json(
      `/v1/materials/${encodeURIComponent(materialId)}/sources`,
      {
        method: "POST",
        body: file,
        headers: {
          "Content-Type": mediaType,
          Origin: origin(),
          "Idempotency-Key": key,
          "X-Material-Name": encodeURIComponent(file.name),
        },
      },
      validate.sourceList,
    );
  }
  getSources(materialId: string): Promise<SourceListView> {
    return this.json(
      `/v1/materials/${encodeURIComponent(materialId)}/sources`,
      { method: "GET" },
      validate.sourceList,
    );
  }
  removeStagedSource(materialId: string, sourceId: string): Promise<SourceListView> {
    return this.json(
      `/v1/materials/${encodeURIComponent(materialId)}/sources/${encodeURIComponent(sourceId)}`,
      { method: "DELETE", headers: { Origin: origin() } },
      validate.sourceList,
    );
  }
  retryNormalization(materialId: string, id: string): Promise<SourceListView> {
    return this.json(
      `/v1/materials/${encodeURIComponent(materialId)}/sources/${encodeURIComponent(id)}/retry`,
      { method: "POST", headers: { Origin: origin() } },
      validate.sourceList,
    );
  }
  createRevision(
    materialId: string,
    normalizationIds: string[],
    key: string,
    baseRevision: string | null = null,
  ): Promise<MaterialProcessingRunView> {
    return this.post(
      `/v1/materials/${encodeURIComponent(materialId)}/revisions`,
      {
        schema: "material-revision-create/v1",
        base_revision: baseRevision,
        normalization_ids: normalizationIds,
      },
      key,
      validate.materialRun,
    );
  }
  cancelRevision(runId: string, baseRevision: string): Promise<MaterialProcessingRunView> {
    return this.post(
      `/v1/material-processing-runs/${encodeURIComponent(runId)}/cancel`,
      { schema: "material-revision-cancel/v1", base_revision: baseRevision },
      crypto.randomUUID(),
      validate.materialRun,
    );
  }
  retryRevision(runId: string, key: string): Promise<MaterialProcessingRunView> {
    return this.json(
      `/v1/material-processing-runs/${encodeURIComponent(runId)}/retry`,
      { method: "POST", headers: { Origin: origin(), "Idempotency-Key": key } },
      validate.materialRun,
    );
  }
  resolveEvidence(base: string, evidenceId: string): Promise<EvidenceSourceView> {
    if (!base.startsWith("/v1/materials/")) throw new Error("SOURCE_ROUTE_INVALID");
    return this.json(
      `${base}/${encodeURIComponent(evidenceId)}/source`,
      { method: "GET" },
      validate.evidenceSource,
    );
  }

  listMaterials(): Promise<MaterialLibraryView> {
    return this.json("/v1/materials", { method: "GET" }, validate.library);
  }

  async getMaterial(materialId: string): Promise<MaterialLibraryItem> {
    const item = await this.json(
      `/v1/materials/${encodeURIComponent(materialId)}`,
      { method: "GET" },
      validate.libraryItem,
    );
    if (item.material_id !== materialId) throw schemaMismatch("The material identity does not match.");
    return item;
  }

  getMaterialRun(runId: string): Promise<MaterialProcessingRunView> {
    return this.json(
      `/v1/material-processing-runs/${encodeURIComponent(runId)}`,
      { method: "GET" },
      validate.materialRun,
    );
  }

  async renameMaterial(materialId: string, displayName: string): Promise<MaterialLibraryItem> {
    const item = await this.json(
      `/v1/materials/${encodeURIComponent(materialId)}/rename`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin() },
        body: JSON.stringify({
          schema: "material-rename/v1",
          display_name: displayName,
        } satisfies MaterialRename),
      },
      validate.libraryItem,
    );
    if (item.material_id !== materialId) throw schemaMismatch("The material identity does not match.");
    return item;
  }

  async discardMaterial(materialId: string): Promise<MaterialDiscardView> {
    const view = await this.json(
      `/v1/materials/${encodeURIComponent(materialId)}`,
      {
        method: "DELETE",
        headers: { Origin: origin() },
      },
      validate.materialDiscard,
      10_000,
    );
    if (view.material_id !== materialId) throw schemaMismatch("The material identity does not match.");
    return view;
  }

  async getKnowledgeStructure(request: KnowledgeStructureRequest): Promise<KnowledgeStructureView> {
    const view = await this.json(
      `/v1/materials/${encodeURIComponent(request.materialId)}/knowledge-structures/${encodeURIComponent(request.structureRevision)}`,
      { method: "GET" },
      validate.knowledgeStructure,
    );
    if (view.knowledge_structure_revision !== request.structureRevision)
      throw schemaMismatch("The knowledge structure version does not match.");
    return view;
  }

  async readProgress(id: string, structureRevision: string): Promise<LearnerProgressView> {
    const value = await this.json(
      `/v1/study-sessions/${encodeURIComponent(id)}/progress`,
      { method: "GET" },
      validate.progress,
    );
    if (value.study_session_id !== id || value.knowledge_structure_revision !== structureRevision) {
      throw schemaMismatch("The progress does not match this material version.");
    }
    return value;
  }

  async applyGuidance(id: string, body: GuidanceApply): Promise<LearnerProgressView> {
    const value = await this.json(
      `/v1/study-sessions/${encodeURIComponent(id)}/guidance/apply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin() },
        body: JSON.stringify(body),
      },
      validate.progress,
    );
    if (value.study_session_id !== id) throw schemaMismatch("The study session identity does not match.");
    return value;
  }

  async focusStudySession(
    studySessionId: string,
    currentConceptId: string,
  ): Promise<StudySessionView> {
    const state = await this.json(
      `/v1/study-sessions/${encodeURIComponent(studySessionId)}/focus`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin() },
        body: JSON.stringify({
          schema: "study-session-focus/v1",
          current_concept_id: currentConceptId,
        } satisfies StudySessionFocus),
      },
      validate.studySession,
    );
    if (state.study_session_id !== studySessionId) throw schemaMismatch("The study session identity does not match.");
    return state;
  }

  createStudySession(
    body: StudySessionCreate,
    key: string = crypto.randomUUID(),
  ): Promise<StudySessionView> {
    return this.post("/v1/study-sessions", body, key, validate.studySession);
  }

  async resumeStudy(request: {
    materialId: string;
    structureRevision: string;
    studySessionId: string;
    runId: string;
    assessmentSetId?: string;
  }): Promise<StudyResumeView> {
    const query = new URLSearchParams({ run_id: request.runId });
    if (request.assessmentSetId) query.set("set_id", request.assessmentSetId);
    let restored: StudyResumeView;
    // Retry only snapshot reads when a worker publishes concurrently; never replay creation or answers.
    for (let attempt = 0; ; attempt += 1) {
      try {
        restored = await this.json(
          `/v1/materials/${encodeURIComponent(request.materialId)}/knowledge-structures/${encodeURIComponent(request.structureRevision)}/study-sessions/${encodeURIComponent(request.studySessionId)}/resume?${query}`,
          { method: "GET" },
          validate.studyResume,
        );
        break;
      } catch (error) {
        if (
          !(error instanceof ApiClientError) ||
          error.reasonCode !== "IDEMPOTENCY_CONFLICT" ||
          attempt >= 2
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
    if (
      restored.session.material_id !== request.materialId ||
      restored.session.study_session_id !== request.studySessionId ||
      restored.session.knowledge_structure_revision !== request.structureRevision ||
      restored.run_id !== request.runId ||
      (request.assessmentSetId !== undefined &&
        restored.selected_set_id !== request.assessmentSetId)
    ) {
      throw schemaMismatch("The study record does not match this material version.");
    }
    return restored;
  }

  async readAssessmentPlan(id: string, conceptId: string): Promise<AssessmentPlanView> {
    const value = await this.json(
      `/v1/study-sessions/${encodeURIComponent(id)}/assessment-plan?concept_id=${encodeURIComponent(conceptId)}`,
      { method: "GET" },
      validate.assessmentPlan,
    );
    if (value.study_session_id !== id || value.concept_id !== conceptId)
      throw schemaMismatch("The practice set scope does not match.");
    return value;
  }

  async listAssessmentSets(id: string): Promise<AssessmentSetListView> {
    const value = await this.json(
      `/v1/study-sessions/${encodeURIComponent(id)}/assessment-sets`,
      { method: "GET" },
      validate.assessmentSetList,
    );
    if (value.study_session_id !== id) throw schemaMismatch("The practice set scope does not match.");
    return value;
  }

  async readAssessmentSet(id: string, setId: string): Promise<AssessmentSetView> {
    const value = await this.json(
      `/v1/study-sessions/${encodeURIComponent(id)}/assessment-sets/${encodeURIComponent(setId)}`,
      { method: "GET" },
      validate.assessmentSet,
    );
    if (value.study_session_id !== id || value.set_id !== setId)
      throw schemaMismatch("The practice set scope does not match.");
    return value;
  }

  async createAssessmentSet(
    id: string,
    conceptId: string,
    key: string,
  ): Promise<AssessmentSetView> {
    const value = await this.post(
      `/v1/study-sessions/${encodeURIComponent(id)}/assessment-sets`,
      { schema: "assessment-set-create/v1", target_concept_id: conceptId },
      key,
      validate.assessmentSet,
    );
    if (value.study_session_id !== id || value.target_concept_id !== conceptId)
      throw schemaMismatch("The practice set scope does not match.");
    return value;
  }

  async changeAssessmentSet(
    id: string,
    setId: string,
    action: AssessmentSetAction,
    version: number,
    key: string,
  ): Promise<AssessmentSetView> {
    const value = await this.post(
      `/v1/study-sessions/${encodeURIComponent(id)}/assessment-sets/${encodeURIComponent(setId)}/${action}`,
      { schema: "assessment-set-action/v1", expected_set_version: version },
      key,
      validate.assessmentSet,
    );
    if (value.study_session_id !== id || value.set_id !== setId)
      throw schemaMismatch("The practice set scope does not match.");
    return value;
  }

  async submitAssessmentSet(
    id: string,
    setId: string,
    answers: AssessmentSetAnswer[],
    version: number,
    key: string,
  ): Promise<AssessmentSetView> {
    const value = await this.post(
      `/v1/study-sessions/${encodeURIComponent(id)}/assessment-sets/${encodeURIComponent(setId)}/submissions`,
      { schema: "assessment-set-submission/v1", expected_set_version: version, answers },
      key,
      validate.assessmentSet,
    );
    const expected = new Map(answers.map((answer) => [answer.assessment_revision, answer]));
    if (
      value.study_session_id !== id ||
      value.set_id !== setId ||
      value.status !== "completed" ||
      value.answered_count !== value.published_count ||
      value.published_count !== answers.length ||
      value.items.some(
        (item) =>
          item.assessment &&
          (item.feedback === null ||
            item.feedback.question_id !==
              expected.get(item.assessment.assessment_revision)?.question_id ||
            item.feedback.selected_option_id !==
              expected.get(item.assessment.assessment_revision)?.selected_option_id),
      )
    )
      throw schemaMismatch("The practice set scope does not match.");
    return value;
  }

  async createRemediationSet(
    id: string,
    rootId: string,
    version: number,
    key: string,
  ): Promise<AssessmentSetView> {
    const value = await this.post(
      `/v1/study-sessions/${encodeURIComponent(id)}/assessment-sets/${encodeURIComponent(rootId)}/remediation`,
      { schema: "assessment-set-action/v1", expected_set_version: version },
      key,
      validate.assessmentSet,
    );
    if (
      value.study_session_id !== id ||
      value.diagnostic_set_id !== rootId ||
      value.kind !== "remediation"
    )
      throw schemaMismatch("The practice set scope does not match.");
    return value;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "An unexpected error occurred. Please try again later.";
}
