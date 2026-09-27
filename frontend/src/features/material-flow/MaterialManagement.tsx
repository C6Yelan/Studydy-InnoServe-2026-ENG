import { useEffect, useRef, useState } from "react";
import { errorMessage, type StudydyApiClient } from "../../api/client";
import { materialDeleteCopy } from "./material-delete-copy";
import { useDismissibleMenu } from "./useDismissibleMenu";
import { writeRoute } from "../../app/routes";
import type { MaterialLibraryItem, MaterialDiscardView } from "../../api/contracts";

export function MaterialManagement({
  item,
  apiClient,
  deleting,
  onRenamed,
  onDeleted,
}: {
  item: MaterialLibraryItem;
  apiClient: StudydyApiClient;
  deleting: boolean;
  onRenamed: (item: MaterialLibraryItem) => void;
  onDeleted: (state: MaterialDiscardView["state"]) => void;
}) {
  const [mode, setMode] = useState<"rename" | "delete" | null>(null);
  const [name, setName] = useState(item.display_name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const opener = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const interacted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useDismissibleMenu(menu, opener);
  useEffect(() => {
    if (!interacted.current || deleting) return;
    if (mode === "rename") {
      input.current?.focus();
      input.current?.select();
    } else if (mode === "delete") cancel.current?.focus();
    else opener.current?.focus({ preventScroll: true });
  }, [mode, deleting]);
  useEffect(() => {
    if (error && !busy) (mode === "rename" ? input.current : cancel.current)?.focus();
  }, [error, busy, mode]);
  const choose = (next: "rename" | "delete") => {
    if (menu.current) menu.current.open = false;
    interacted.current = true;
    setError(null);
    setName(item.display_name);
    setMode(next);
  };
  const close = () => {
    if (!inFlight.current) {
      setError(null);
      setMode(null);
    }
  };
  const valid =
    name.trim().length > 0 &&
    Array.from(name.trim()).length <= 200 &&
    !/[\p{Cc}\p{Cs}]/u.test(name);
  const submit = async () => {
    if (inFlight.current || !mode || (mode === "rename" && !valid)) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      if (mode === "rename")
        onRenamed(await apiClient.renameMaterial(item.material_id, name.trim()));
      else onDeleted((await apiClient.discardMaterial(item.material_id)).state);
      if (mounted.current) setMode(null);
    } catch (failure) {
      if (mounted.current)
        setError(
          `${mode === "rename" ? "Unable to rename this material. " : "Unable to delete this material. "}${errorMessage(failure)}`,
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const copy = materialDeleteCopy(item);
  return (
    <>
      {!deleting && (
        <details ref={menu} className="material-management-menu" hidden={mode !== null}>
          <summary
            ref={opener}
            role="button"
            tabIndex={0}
            aria-label={`Manage ${item.display_name}`}
          >
            ⋯
          </summary>
          <div>
            <button
              type="button"
              onClick={() => {
                if (menu.current) menu.current.open = false;
                writeRoute({ name: "material-sources", materialId: item.material_id });
              }}
            >
              Manage material
            </button>
            <button type="button" onClick={() => choose("rename")}>
              Rename
            </button>
            <button
              className="material-delete-action"
              type="button"
              onClick={() => choose("delete")}
            >
              Delete material
            </button>
          </div>
        </details>
      )}
      {mode !== "rename" && <h2 title={item.display_name}>{item.display_name}</h2>}
      {deleting ? (
        <p role="status" className="material-deleting">
          Deleting…
        </p>
      ) : (
        mode && (
          <form
            className="material-management-form"
            aria-label={mode === "rename" ? "Rename material" : "Confirm material deletion"}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
            }}
          >
            {mode === "rename" ? (
              <>
                <label>
                  Material name
                  <input
                    ref={input}
                    type="text"
                    value={name}
                    disabled={busy}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                {!valid && <p>Use 1–200 characters with no control characters.</p>}
              </>
            ) : (
              <>
                <h3>Delete this material?</h3>
                {copy.notice && <p>{copy.notice}</p>}
                <p>{copy.scope}</p>
              </>
            )}
            <div className="material-management-actions">
              <button
                ref={cancel}
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={close}
              >
                Cancel
              </button>
              <button
                className={`secondary-button${mode === "delete" ? " cancel-confirm-button" : ""}`}
                type="submit"
                disabled={busy || (mode === "rename" && !valid)}
              >
                {busy
                  ? mode === "rename"
                    ? "Saving…"
                    : "Deleting…"
                  : mode === "rename"
                    ? "Save"
                    : "Confirm deletion"}
              </button>
            </div>
            {busy && <p role="status">{mode === "rename" ? "Saving…" : "Requesting deletion…"}</p>}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </form>
        )
      )}
    </>
  );
}
