import { useEffect, useRef, useState } from "react";
import { errorMessage, type StudydyApiClient } from "../../api/client";
import { writeRoute } from "../../app/routes";

// Reuse the same retry intent after response loss instead of creating duplicate work.
export function MaterialRunStartControl({
  apiClient,
  materialId,
  retryRun,
}: {
  apiClient: StudydyApiClient;
  materialId: string;
  retryRun: { runId: string; saved: boolean };
}) {
  const intent = useRef<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (failure && !busy) button.current?.focus({ preventScroll: true });
  }, [failure, busy]);
  const start = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    intent.current ??= crypto.randomUUID();
    try {
      const next = await apiClient.retryRevision(retryRun.runId, intent.current);
      if (!mounted.current) return;
      intent.current = null;
      writeRoute({ name: "material-run", materialId, runId: next.run_id });
    } catch (error) {
      if (mounted.current) setFailure(`Unable to restart processing. Please try again. ${errorMessage(error)}`);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <>
      <button
        ref={button}
        className="primary-button"
        type="button"
        disabled={busy}
        onClick={() => void start()}
      >
        {busy ? "Restarting…" : retryRun.saved ? "Resume saved analysis" : "Analyze original sources again"}
      </button>
      {busy && (
        <span className="material-recovery-status" role="status">
          Restarting…
        </span>
      )}
      {failure && (
        <p className="form-error material-recovery-error" role="alert">
          {failure}
        </p>
      )}
    </>
  );
}
