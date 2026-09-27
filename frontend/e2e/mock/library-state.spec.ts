import { expect, test } from "@playwright/test";
import {
  materialId,
  runId,
  sessionId,
  structureRevision,
  run,
  json,
  mockKnowledgeMapApi,
} from "../fixtures/knowledge-map";

test.beforeEach(async ({ page }) => {
  await mockKnowledgeMapApi(page);
  await page.route("**/v1/materials", (route) => {
    expect(route.request().method()).toBe("GET");
    return json(route, { schema: "material-library/v1", materials: [] });
  });
});

test("library loading, read failure and empty state retain usable actions", async ({ page }) => {
  let releaseRead!: () => void;
  const ready = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  let reads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/v1/materials") reads++;
  });
  await page.route(
    "**/v1/materials",
    async (route) => {
      expect(route.request().method()).toBe("GET");
      await ready;
      return json(
        route,
        {
          schema: "api-error/v1",
          request_id: sessionId,
          reason_code: "STORAGE_UNAVAILABLE",
          retryable: true,
          message: "Request could not be completed.",
        },
        503,
      );
    },
    { times: 1 },
  );
  await page.goto("/materials");
  await expect(page.getByRole("heading", { name: "Loading your library", exact: true })).toBeVisible();
  expect(reads).toBe(1);
  releaseRead();
  await expect(page.getByRole("heading", { name: "Unable to load materials", exact: true })).toBeVisible();
  await expect(page.getByText("Storage is temporarily unavailable. Please try again later.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your library is empty", exact: true })).toBeVisible();
  expect(reads).toBe(2);
  await expect(page.getByRole("heading", { name: "Unable to load materials", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Upload your first material", exact: true }).click();
  await expect(page).toHaveURL(/\/upload$/);
  await expect(page.getByRole("heading", { name: "Upload materials", exact: true })).toBeVisible();
  await expect(page.getByLabel("Choose material files", { exact: true })).toBeEnabled();
});

test("reopen rejects a run from a different Knowledge Structure revision", async ({ page }) => {
  await page.route(`**/v1/material-processing-runs/${runId}`, (route) => {
    expect(route.request().method()).toBe("GET");
    return json(route, {
      ...run,
      output_binding: {
        ...run.output_binding,
        knowledge_structure_revision: `knowledge-structure:sha256:${"7".repeat(64)}`,
      },
    });
  });
  await page.goto(
    `/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}`,
  );
  await expect(page.getByRole("heading", { name: "Unable to load the knowledge map", exact: true })).toBeVisible();
  await expect(page.locator(".map-workspace")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "View study results", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to library", exact: true }).click();
  await expect(page).toHaveURL(/\/materials$/);
  await expect(page.getByRole("heading", { name: "Your library is empty", exact: true })).toBeVisible();
});
