import assert from "node:assert/strict";
import test from "node:test";

import {
  materialProgressStageLabel,
  materialCurrentStagePercent,
  materialOverallProgressPercent,
  validateSourceFile,
} from "./material-flow.ts";

test("material stages describe the current processing work", () => {
  assert.equal(materialProgressStageLabel("evidence"), "Extracting pages and source evidence");
  assert.equal(materialProgressStageLabel("semantics"), "Building concepts, relationships, and learning order");
});

test("each source follows its advertised format and individual size limit", () => {
  const formats = [
    { extension: ".pdf", media_type: "application/pdf", max_bytes: 100 * 1024 * 1024 },
    { extension: ".txt", media_type: "text/plain", max_bytes: 100 * 1024 * 1024 },
  ];
  const valid = { name: "Material.PDF", type: "application/pdf", size: formats[0].max_bytes };
  assert.equal(validateSourceFile(valid, formats), null);
  assert.equal(validateSourceFile({ name: "notes.txt", type: "", size: 12 }, formats), null);
  assert.match(validateSourceFile({ ...valid, type: "text/plain" }, formats), /does not match its type/);
  assert.match(validateSourceFile({ ...valid, name: "file.exe" }, formats), /not supported/);
  assert.match(validateSourceFile({ ...valid, size: 0 }, formats), /empty/);
  assert.match(
    validateSourceFile({ ...valid, size: formats[0].max_bytes + 1 }, formats),
    /100 MiB/,
  );
});

function processing(stage, completed, total = 45, status = "running") {
  return { progress_stage: stage, completed_pages: completed, total_pages: total, status };
}

test("processing projections distinguish measured stage work from structural overall estimates", () => {
  for (const [stage, completed, overall, current] of [
    ["queued", 0, 0, null],
    ["evidence", 0, 0, 0],
    ["evidence", 3, 3, 7],
    ["evidence", 45, 49, 100],
    ["semantics", 0, 49, 0],
    ["semantics", 20, 71, 44],
    ["semantics", 45, 99, 100],
    ["publishing", 45, 99, null],
  ]) {
    assert.equal(materialOverallProgressPercent(processing(stage, completed)), overall);
    assert.equal(materialCurrentStagePercent(processing(stage, completed)), current);
  }
  for (const status of ["succeeded", "partial"]) {
    assert.equal(materialOverallProgressPercent(processing("completed", 45, 45, status)), 100);
    assert.equal(materialCurrentStagePercent(processing("completed", 45, 45, status)), 100);
  }
  assert.equal(materialProgressStageLabel("queued"), "Waiting for processing resources");
  assert.equal(materialProgressStageLabel("publishing"), "Publishing the knowledge map");
});

test("progress handles unknown/invalid denominators and clamps without declaring early completion", () => {
  assert.equal(materialOverallProgressPercent(processing("queued", 0, null, "pending")), 0);
  for (const total of [null, 0, -1, NaN, Infinity, Number.MAX_VALUE]) {
    assert.equal(materialCurrentStagePercent(processing("evidence", 3, total)), null);
    assert.equal(materialOverallProgressPercent(processing("semantics", 3, total)), null);
  }
  assert.equal(materialCurrentStagePercent(processing("evidence", -4)), 0);
  assert.equal(materialCurrentStagePercent(processing("semantics", 99)), 100);
  assert.equal(materialOverallProgressPercent(processing("evidence", -4)), 0);
  assert.equal(materialOverallProgressPercent(processing("evidence", 99)), 49);
  assert.equal(materialOverallProgressPercent(processing("semantics", 99)), 99);
  assert.equal(materialOverallProgressPercent(processing("publishing", 500, 500)), 99);
  assert.equal(materialCurrentStagePercent(processing("evidence", Infinity)), null);
  assert.equal(materialOverallProgressPercent(processing("evidence", NaN)), null);
  assert.equal(materialOverallProgressPercent(processing("completed", 45, 45, "failed")), null);
  assert.equal(materialOverallProgressPercent(processing("semantics", 20, 45, "failed")), 71);
});

test("legal lifecycle projections never decrease as stage page counts reset", () => {
  for (const total of [1, 45, 500]) {
    const snapshots = [processing("queued", 0, null, "pending")];
    for (const stage of ["evidence", "semantics"]) {
      for (let completed = 0; completed <= total; completed++)
        snapshots.push(processing(stage, completed, total));
    }
    snapshots.push(
      processing("publishing", total, total),
      processing("completed", total, total, "succeeded"),
    );
    const values = snapshots.map(materialOverallProgressPercent);
    assert.equal(values[0], 0);
    assert.equal(values.at(-1), 100);
    assert.ok(values.slice(0, -1).every((value) => value >= 0 && value <= 99));
    assert.ok(values.every((value, index) => index === 0 || value >= values[index - 1]));
  }
});

test("cancelled is never projected as successful 100 percent completion", () => {
  for (const stage of ["queued", "evidence", "semantics", "publishing", "completed"]) {
    assert.equal(materialCurrentStagePercent(processing(stage, 45, 45, "cancelled")), null);
    assert.equal(materialOverallProgressPercent(processing(stage, 45, 45, "cancelled")), null);
  }
});

test("delete warning describes existing learner content, independently of active processing", async () => {
  const { materialDeleteCopy } = await import("./material-delete-copy.ts");
  const initial = { available_structures: [], study_sessions: [], latest_attempt: null };
  const sources = [
    { status: "ready", media_type: "application/pdf", normalized_artifact_id: "pdf" },
    { status: "failed", media_type: "text/plain", normalized_artifact_id: null },
  ];
  const plain = materialDeleteCopy(initial, sources);
  assert.equal(plain.scope, "This deletes the uploaded 2 source files. This cannot be undone.");
  assert.doesNotMatch(plain.scope, /knowledge map|study records|questions|answers|converted/);
  sources.push({ status: "ready", media_type: "text/plain", normalized_artifact_id: "converted" });
  assert.match(materialDeleteCopy(initial, sources).scope, /3 source files and their converted files/);
  const map = { ...initial, available_structures: [{}] };
  assert.equal(materialDeleteCopy(map).scope, "This deletes the material and its knowledge map. This cannot be undone.");
  const history = { ...map, study_sessions: [{ status: "completed" }] };
  assert.match(materialDeleteCopy(history).scope, /knowledge map, together with its study records, questions, and answers/);
  for (const status of ["pending", "running"]) {
    assert.equal(
      materialDeleteCopy({ ...initial, latest_attempt: { status } }).notice,
      "The current analysis will stop before this material is deleted.",
    );
    assert.equal(
      materialDeleteCopy({ ...history, latest_attempt: { status } }).notice,
      "The current update will stop before this material is deleted.",
    );
  }
  assert.match(materialDeleteCopy(initial, [{ status: "running" }]).notice, /will stop/);
  assert.doesNotMatch(materialDeleteCopy().scope, /knowledge map|study records|questions|answers/);
});

test("configured upload limit controls selection and message", () => {
  const max = 90 * 1024 * 1024;
  const formats = [{ extension: ".pdf", media_type: "application/pdf", max_bytes: max }];
  const file = { name: "fixture.pdf", type: "application/pdf", size: max };
  assert.equal(validateSourceFile(file, formats), null);
  assert.match(validateSourceFile({ ...file, size: max + 1 }, formats), /90 MiB/);
});
