import { expect, test, type Page } from "@playwright/test";
import type { MaterialProcessingRunView, SourceView } from "../../src/api/contracts";

const uuid = (seed: number) => `11111111-1111-4111-8111-${String(seed).padStart(12, "0")}`;
const material = uuid(1);
const runId = uuid(2);
const stamp = "2026-09-19T00:00:00Z";
const pdf = { name: "A.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-synthetic") };
const txt = { name: "B.txt", mimeType: "text/plain", buffer: Buffer.from("Queue uses FIFO.") };
const failure = {
  schema: "api-error/v1",
  request_id: material,
  reason_code: "STORAGE_UNAVAILABLE",
  retryable: true,
  message: "Request could not be completed.",
};

async function fileTransfer(page: Page, name: string, type: string) {
  return page.evaluateHandle(
    ({ name, type }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["synthetic"], name, { type }));
      return transfer;
    },
    { name, type },
  );
}

async function setup(page: Page) {
  const state = {
    drafts: [] as string[],
    uploads: [] as { name: string; key: string }[],
    sources: [] as SourceView[],
    starts: [] as {
      key: string;
      body: { normalization_ids: string[]; base_revision: string | null };
    }[],
    uploadLost: false,
    analysisFailsOnce: false,
    draftLost: false,
    conversionFailed: false,
    deleted: 0,
    run: null as MaterialProcessingRunView | null,
  };
  await page.route(/\/v[12]\//, (route) => {
    throw new Error(
      `Unexpected upload request: ${route.request().method()} ${route.request().url()}`,
    );
  });
  await page.route("**/v1/session", (route) =>
    route.fulfill({ json: { schema: "learner-identity/v1", learner_id: uuid(99) } }),
  );
  await page.route("**/v1/session/refresh", (route) =>
    route.fulfill({
      json: { schema: "learner-identity/v1", learner_id: uuid(99) },
    }),
  );
  await page.route("**/v1/source-capabilities", (route) =>
    route.fulfill({
      json: {
        schema: "source-capabilities/v1",
        formats: [
          { extension: ".pdf", media_type: "application/pdf", max_bytes: 104857600 },
          { extension: ".txt", media_type: "text/plain", max_bytes: 104857600 },
        ],
      },
    }),
  );
  const item = () => ({
    schema: "material-library-item/v1",
    material_id: material,
    source_artifact_id: null,
    display_name: "A.pdf",
    size_bytes: 128,
    created_at: stamp,
    latest_attempt: state.run,
    available_structures: [],
    study_sessions: [],
    source: state.sources[0],
  });
  // Handle create and list on one route so a later wildcard cannot mask the other handler.
  await page.route("**/v1/materials", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { schema: "material-library/v1", materials: [item()] } });
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["idempotency-key"]).toMatch(/\S/);
    state.drafts.push(route.request().headers()["idempotency-key"]);
    if (state.draftLost) {
      state.draftLost = false;
      return route.abort("connectionreset");
    }
    return route.fulfill({
      status: 201,
      json: { schema: "material-draft/v1", material_id: material },
    });
  });
  await page.route(`**/v1/materials/${material}`, (route) => route.fulfill({ json: item() }));
  const listing = () => ({
    schema: "material-sources/v1",
    material_id: material,
    sources: state.sources,
  });
  await page.route(`**/v1/materials/${material}/sources`, (route) => {
    if (route.request().method() === "POST") {
      const name = decodeURIComponent(route.request().headers()["x-material-name"]);
      const key = route.request().headers()["idempotency-key"];
      expect(key).toMatch(/\S/);
      if (!state.uploads.some((upload) => upload.key === key)) {
        const n = 10 + state.sources.length * 10;
        const failed = state.conversionFailed && name === "B.txt";
        state.sources.push({
          source_id: uuid(n),
          normalization_id: uuid(n + 1),
          original_artifact_id: uuid(n + 2),
          original_name: name,
          media_type: route.request().headers()["content-type"],
          status: failed ? "failed" : "ready",
          normalized_artifact_id: failed ? null : uuid(n + 3),
          page_count: failed ? null : 1,
          error_code: failed ? "UTF8_REQUIRED" : null,
          included: false,
        });
      }
      state.uploads.push({ name, key });
      if (state.uploadLost && name === "B.txt") {
        state.uploadLost = false;
        return route.abort("connectionreset");
      }
    } else expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: listing() });
  });
  await page.route(`**/v1/materials/${material}/sources/*`, (route) => {
    expect(route.request().method()).toBe("DELETE");
    state.deleted++;
    state.sources = state.sources.filter(
      (source) => !route.request().url().endsWith(source.source_id),
    );
    return route.fulfill({ json: listing() });
  });
  await page.route(`**/v1/materials/${material}/revisions`, (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["idempotency-key"]).toMatch(/\S/);
    state.starts.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postDataJSON(),
    });
    if (state.analysisFailsOnce) {
      state.analysisFailsOnce = false;
      return route.fulfill({ status: 503, json: failure });
    }
    state.run = {
      schema: "material-processing-run/v1",
      run_id: runId,
      material_id: material,
      source_artifact_id: uuid(13),
      source_names: state.sources.map((source) => source.original_name),
      status: "pending",
      progress_stage: "queued",
      completed_pages: 0,
      total_pages: null,
      output_binding: null,
      error_code: null,
      cancel_requested_at: null,
      created_at: stamp,
      updated_at: stamp,
      completed_at: null,
    };
    return route.fulfill({ status: 202, json: state.run });
  });
  await page.route(`**/v1/material-processing-runs/${runId}`, (route) =>
    route.fulfill({ json: state.run }),
  );
  return state;
}

for (const width of [1536, 390]) {
  test(`rejected selections stay outside the queue and valid mixed files still upload at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const state = await setup(page);
    await page.goto("/upload");
    const input = page.getByLabel("Choose material files", { exact: true });
    await expect(input).toBeEnabled();
    const dropJpg = async () => {
      const data = await fileTransfer(page, "screenshot.jpg", "image/jpeg");
      await page.locator(".file-drop").dispatchEvent("drop", { dataTransfer: data });
      await data.dispose();
    };
    const rejection = page.locator("#upload-selection-error");
    const cta = page.getByRole("button", { name: "Upload and review sources", exact: true });
    await dropJpg();
    await expect(rejection).toContainText("screenshot.jpg");
    await expect(rejection).toContainText("not supported");
    await expect(page.locator(".chosen-file")).toHaveCount(0);
    await expect(cta).toBeDisabled();
    await input.setInputFiles(pdf);
    await expect(rejection).toHaveCount(0);
    await dropJpg();
    await expect(page.locator(".chosen-file strong")).toHaveText(["A.pdf"]);
    await expect(page.getByText("Files: 1 · 1 KiB", { exact: true })).toBeVisible();
    await expect(cta).toBeEnabled();
    const drop = (await page.locator(".file-drop").boundingBox())!;
    const error = (await rejection.boundingBox())!;
    const card = (await page.locator(".chosen-file").boundingBox())!;
    expect(error.y).toBeGreaterThanOrEqual(drop.y + drop.height);
    expect(error.y + error.height).toBeLessThanOrEqual(card.y);
    await page.getByRole("button", { name: "Remove A.pdf", exact: true }).click();
    await expect(page.locator(".chosen-file")).toHaveCount(0);
    await input.setInputFiles([
      pdf,
      txt,
      { name: "screenshot.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(4096) },
    ]);
    await expect(page.locator(".chosen-file strong")).toHaveText(["A.pdf", "B.txt"]);
    await expect(rejection).toContainText("screenshot.jpg");
    await expect(page.getByText("Files: 2 · 1 KiB", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await cta.click();
    await expect(page).toHaveURL(new RegExp(`/materials/${material}/sources$`));
    expect(state.uploads.map((upload) => upload.name)).toEqual(["A.pdf", "B.txt"]);
    expect(state.starts).toHaveLength(0);
  });

  test(`format hints and conversion notice follow selected files at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const state = await setup(page);
    await page.goto("/upload");
    await expect(page.getByRole("heading", { name: "Upload materials", exact: true })).toBeVisible();
    await expect(page.locator(".upload-hero p:last-child")).toHaveText(
      "Choose one or more files. Review the sources before starting analysis.",
    );
    await expect(page.locator(".file-drop strong")).toHaveText("Drop your files here, or click to browse");
    await expect(page.locator(".file-drop > span:last-child")).toHaveText(
      "PDF / TXT · Multiple files · Up to 100.0 MiB each",
    );
    const conversion = page.getByText("Non-PDF files are converted to PDF. Check the conversion on the next screen.", {
      exact: true,
    });
    const input = page.getByLabel("Choose material files", { exact: true });
    await expect(conversion).toHaveCount(0);
    await input.setInputFiles({ ...pdf, name: "A.PDF" });
    await expect(conversion).toHaveCount(0);
    await input.setInputFiles(txt);
    await expect(page.locator(".chosen-file")).toHaveCount(2);
    await expect(conversion).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload and review sources", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Remove B.txt", exact: true }).click();
    await expect(conversion).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(state.drafts).toHaveLength(0);
    expect(state.uploads).toHaveLength(0);
    expect(state.starts).toHaveLength(0);
  });
}

test("initial multi-source upload confirms exact order and retries analysis", async ({ page }) => {
  const state = await setup(page);
  state.uploadLost = true;
  state.analysisFailsOnce = true;
  await page.goto("/upload");
  await page.getByLabel("Choose material files", { exact: true }).setInputFiles([pdf, txt]);
  await expect(page.locator(".chosen-file")).toHaveCount(2);
  const upload = page.getByRole("button", { name: "Upload and review sources", exact: true });
  await upload.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect(page.getByText("Upload failed. Retry available.", { exact: false })).toBeVisible();
  expect(state.starts).toHaveLength(0);
  expect(state.drafts).toHaveLength(1);
  await page
    .getByLabel("Choose material files", { exact: true })
    .setInputFiles({ name: "image.jpg", mimeType: "image/jpeg", buffer: Buffer.from("image") });
  await expect(page.locator(".chosen-file")).toHaveCount(2);
  await expect(
    page.locator(".chosen-file").filter({ hasText: "B.txt" }).getByRole("alert"),
  ).toBeVisible();
  await expect(page.locator("#upload-selection-error")).toContainText("image.jpg");
  await page.getByRole("button", { name: "Retry incomplete uploads" }).click();
  await expect(page).toHaveURL(new RegExp(`/materials/${material}/sources$`));
  expect(state.uploads.map((item) => item.name)).toEqual(["A.pdf", "B.txt", "B.txt"]);
  expect(state.uploads[1].key).toBe(state.uploads[2].key);
  await expect(page.locator(".source-row")).toHaveCount(2);
  await expect(page.getByRole("link", { name: /Preview PDF/ })).toHaveCount(2);
  await page.reload();
  await page.getByRole("button", { name: "Move up B.txt" }).click();
  await expect(page.locator(".source-row").first()).toContainText("B.txt");
  await expect(page.locator(".source-list-footer")).toContainText("Files: 2 · Pages: 2");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Start analysis", exact: true }).click();
  await expect(page.locator(".source-request-error")).toBeVisible();
  await page.getByRole("button", { name: "Start analysis", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/materials/${material}/runs/${runId}$`));
  expect(state.starts).toHaveLength(2);
  expect(state.starts[0].key).toBe(state.starts[1].key);
  expect(state.starts[1].body.base_revision).toBeNull();
  expect(state.starts[1].body.normalization_ids).toEqual([uuid(21), uuid(11)]);
  expect(state.deleted).toBe(0);
});

test("failed initial source requires explicit removal before analysis", async ({ page }) => {
  const state = await setup(page);
  state.conversionFailed = true;
  await page.goto("/upload");
  await page.getByLabel("Choose material files", { exact: true }).setInputFiles([pdf, txt]);
  await page.getByRole("button", { name: "Upload and review sources" }).click();
  const start = page.getByRole("button", { name: "Start analysis", exact: true });
  await expect(
    page.getByRole("listitem", { name: "B.txt", exact: true }).getByRole("status"),
  ).toHaveText("Conversion failed");
  await expect(start).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("listitem", { name: "B.txt", exact: true }).getByRole("status"),
  ).toHaveText("Conversion failed");
  await expect(start).toHaveCount(0);
  expect(state.starts).toHaveLength(0);
  await page
    .getByRole("listitem", { name: "B.txt", exact: true })
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}$`));
  expect(state.deleted).toBe(1);
  expect(state.starts[0].body.normalization_ids).toEqual([uuid(11)]);
});

test("capability failure blocks upload until the configured limit is known", async ({ page }) => {
  await setup(page);
  await page.route("**/v1/source-capabilities", (route) => route.fulfill({ status: 503, json: failure }));
  await page.goto("/upload");
  await expect(page.getByRole("status")).toHaveText("Upload limits could not be loaded. Refresh the page and try again.");
  await expect(page.getByLabel("Choose material files", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Upload and review sources", exact: true })).toBeDisabled();
});

test("selection waits for capabilities instead of rejecting a supported non-PDF format", async ({
  page,
}) => {
  await setup(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/v1/source-capabilities", async (route) => {
    await pending;
    await route.fallback();
  });
  await page.goto("/upload");
  const input = page.getByLabel("Choose material files", { exact: true });
  await expect(input).toBeDisabled();
  const data = await fileTransfer(page, "B.txt", "text/plain");
  await page.locator(".file-drop").dispatchEvent("drop", { dataTransfer: data });
  await data.dispose();
  await expect(page.getByRole("alert")).toContainText("supported formats to load");
  await expect(page.locator(".chosen-file")).toHaveCount(0);
  release();
  await expect(input).toBeEnabled();
  await input.setInputFiles(txt);
  await expect(page.locator(".chosen-file strong")).toHaveText(["B.txt"]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("client-known invalid files are rejected before enqueue without blocking valid files", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/upload");
  await page
    .getByLabel("Choose material files", { exact: true })
    .setInputFiles([pdf, { name: "empty.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) }]);
  await expect(page.getByRole("alert")).toContainText("must not be empty");
  await expect(page.locator(".chosen-file")).toHaveCount(1);
  await expect(page.locator(".chosen-file")).not.toContainText("empty.txt");
  await expect(page.getByRole("button", { name: "Upload and review sources" })).toBeEnabled();
  await page
    .getByLabel("Choose material files", { exact: true })
    .setInputFiles({ name: "mismatch.pdf", mimeType: "text/plain", buffer: Buffer.from("text") });
  await expect(page.getByRole("alert")).toContainText("file extension does not match its type");
  await expect(page.locator(".chosen-file")).toHaveCount(1);
  expect(state.drafts).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Upload and review sources" })).toBeEnabled();
});

test("draft response loss keeps the same intent and never starts analysis from upload", async ({
  page,
}) => {
  const state = await setup(page);
  state.draftLost = true;
  await page.goto("/upload");
  await page.getByLabel("Choose material files", { exact: true }).setInputFiles(pdf);
  await page.getByRole("button", { name: "Upload and review sources" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Upload and review sources" }).click();
  await expect(page).toHaveURL(new RegExp(`/materials/${material}/sources$`));
  expect(state.drafts).toHaveLength(2);
  expect(state.drafts[0]).toBe(state.drafts[1]);
  expect(state.uploads).toHaveLength(1);
  expect(state.starts).toHaveLength(0);
});

test("drag state and accessible picker support multiple files without accidental submission", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/upload");
  const drop = page.locator(".file-drop");
  const input = page.getByLabel("Choose material files", { exact: true });
  await expect(input).toBeEnabled();
  await input.focus();
  expect(await drop.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
  const picker = page.waitForEvent("filechooser");
  await drop.click();
  await (await picker).setFiles([pdf, txt]);
  const data = await fileTransfer(page, "C.txt", "text/plain");
  await drop.dispatchEvent("dragenter", { dataTransfer: data });
  await expect(drop).toHaveClass(/is-dragging/);
  await page.keyboard.press("Escape");
  await expect(drop).not.toHaveClass(/is-dragging/);
  await drop.dispatchEvent("drop", { dataTransfer: data });
  await data.dispose();
  await expect(page.locator(".chosen-file")).toHaveCount(3);
  for (const kind of ["text/plain", "text/uri-list", "folder"]) {
    const invalidDrop = await page.evaluateHandle((kind) => {
      const transfer = new DataTransfer();
      if (kind === "folder") {
        transfer.items.add(new File(["file"], "notes"));
        Object.defineProperty(transfer, "items", {
          value: [{ webkitGetAsEntry: () => ({ isDirectory: true }) }],
        });
      } else transfer.setData(kind, kind === "text/plain" ? "text" : "https://example.com/notes");
      return transfer;
    }, kind);
    await drop.dispatchEvent("drop", { dataTransfer: invalidDrop });
    await invalidDrop.dispose();
    await expect(page.locator("#upload-selection-error")).toContainText(
      kind === "folder" ? "Folders are not supported" : "Text and URLs are not supported",
    );
    await expect(page.locator(".chosen-file")).toHaveCount(3);
  }
  expect(state.uploads).toHaveLength(0);
});
