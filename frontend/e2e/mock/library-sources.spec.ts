import { expect, test } from "@playwright/test";
import type { MaterialLibraryItem, SourceView } from "../../src/api/contracts";

const uuid = (seed: number) => `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
const materialId = uuid(1);
const learnerId = uuid(2);
const runId = uuid(3);
const pdfPreviewId = uuid(40);
const officePreviewId = uuid(41);
const officeName = "Chapter_2_Tree_Traversal_and_Practice_".repeat(5) + ".ppt";
const initialSources: SourceView[] = [
  {
    source_id: uuid(10),
    normalization_id: uuid(20),
    original_artifact_id: uuid(30),
    original_name: "Chapter_1.pdf",
    media_type: "application/pdf",
    status: "ready",
    normalized_artifact_id: pdfPreviewId,
    page_count: 12,
    error_code: null,
    included: true,
  },
  {
    source_id: uuid(11),
    normalization_id: uuid(21),
    original_artifact_id: uuid(31),
    original_name: officeName,
    media_type: "application/vnd.ms-powerpoint",
    status: "running",
    normalized_artifact_id: null,
    page_count: null,
    error_code: null,
    included: false,
  },
  {
    source_id: uuid(12),
    normalization_id: uuid(22),
    original_artifact_id: uuid(32),
    original_name: "Supplement.docx",
    media_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    status: "failed",
    normalized_artifact_id: null,
    page_count: null,
    error_code: "NORMALIZATION_FAILED",
    included: false,
  },
];
const item: MaterialLibraryItem = {
  schema: "material-library-item/v1",
  material_id: materialId,
  source_artifact_id: pdfPreviewId,
  display_name: "Data structures",
  size_bytes: 1200,
  created_at: "2026-09-20T00:00:00Z",
  source_count: initialSources.length,
  latest_attempt: null,
  available_structures: [
    {
      run_id: runId,
      knowledge_structure_revision: `knowledge-structure:sha256:${"a".repeat(64)}`,
      status: "partial",
      created_at: "2026-09-20T00:00:00Z",
    },
  ],
  study_sessions: [],
};

for (const width of [1536, 390]) {
  test(`multi-source bookshelf opens source management and polls conversion at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const sources = structuredClone(initialSources);
    let reads = 0;
    await page.route(/\/v[12]\//, (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      expect(request.method()).toBe(path === "/v1/session/refresh" ? "POST" : "GET");
      switch (path) {
        case "/v1/session":
        case "/v1/session/refresh":
          return route.fulfill({ json: { schema: "learner-identity/v1", learner_id: learnerId } });
        case "/v1/materials":
          return route.fulfill({ json: { schema: "material-library/v1", materials: [item] } });
        case `/v1/materials/${materialId}`:
          return route.fulfill({ json: item });
        case "/v1/source-capabilities":
          return route.fulfill({
            json: {
              schema: "source-capabilities/v1",
              formats: [{ extension: ".pdf", media_type: "application/pdf", max_bytes: 104857600 }],
            },
          });
        case `/v1/materials/${materialId}/sources`:
          reads++;
          return route.fulfill({
            json: { schema: "material-sources/v1", material_id: materialId, sources },
          });
        default:
          throw new Error(`Unexpected library source request: ${request.method()} ${path}`);
      }
    });
    await page.goto("/materials");
    const card = page.getByRole("article", { name: item.display_name, exact: true });
    await expect(card).toContainText("Files: 3");
    await expect(card).not.toContainText(
      /Source file|Chapter_1.pdf|Converted PDF|Download original|Latest processing|File conversion|Saved questions and answers|partial|needs_review/,
    );
    await expect(card.getByRole("link")).toHaveCount(0);
    await expect(card.locator("details:not(.material-management-menu)")).toHaveCount(0);
    await expect(card.locator(".library-state")).toHaveCount(0);
    await expect(card.locator(".primary-button")).toHaveText("Open knowledge map");
    await expect(card.locator(".state-actions > button")).toHaveCount(1);
    await page.clock.runFor(5_000);
    expect(reads).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await card.getByRole("button", { name: "Manage Data structures", exact: true }).click();
    await card.getByRole("button", { name: "Manage material", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/materials/${materialId}/sources$`));
    const rows = page.getByRole("region", { name: "Sources", exact: true }).locator(".source-row");
    await expect(rows.locator(".source-name")).toHaveText(
      sources.map((source) => source.original_name),
    );
    for (const [index, source] of sources.entries())
      await expect(
        rows.nth(index).getByRole("link", { name: "Download original", exact: true }),
      ).toHaveAttribute("href", `/v1/artifacts/${source.original_artifact_id}/download`);
    await expect(rows.nth(0).getByRole("link", { name: "Preview PDF", exact: true })).toHaveAttribute(
      "href",
      `/v1/artifacts/${pdfPreviewId}`,
    );
    await expect(rows.nth(1).getByRole("status")).toHaveText("Converting…");
    await expect(rows.nth(1).getByRole("link", { name: "Preview PDF", exact: true })).toHaveCount(0);
    await expect(rows.nth(2).getByRole("status")).toHaveText("Conversion failed");
    await expect(rows.nth(2).getByRole("link", { name: "Preview PDF", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Choose files to add", { exact: true })).toBeEnabled();
    await expect(
      page.getByText("Upload limits could not be loaded. Refresh the page and try again.", { exact: true }),
    ).toHaveCount(0);
    // Verify continued polling before allowing the next response to become ready.
    await page.clock.runFor(5_000);
    await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
    await expect(rows.nth(1).getByRole("status")).toHaveText("Converting…");
    sources[1] = {
      ...sources[1],
      status: "ready",
      normalized_artifact_id: officePreviewId,
      page_count: 20,
    };
    await page.clock.runFor(5_000);
    await expect(rows.nth(1).getByRole("link", { name: "Preview PDF", exact: true })).toHaveAttribute(
      "href",
      `/v1/artifacts/${officePreviewId}`,
    );
    await expect(rows.nth(1).getByRole("status")).toHaveCount(0);
    await expect(rows.nth(1).locator(".source-metadata")).toContainText("Pages: 20");
    await expect(rows.getByRole("link", { name: "Preview PDF", exact: true })).toHaveCount(2);
    await expect(rows.nth(2).getByRole("status")).toHaveText("Conversion failed");
    const completedReads = reads;
    await page.clock.runFor(5_000);
    expect(reads).toBe(completedReads);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
