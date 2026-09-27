import { expect, test, type Page, type Route } from "@playwright/test";
import type { MaterialProcessingRunView } from "../../src/api/contracts";

import { structureView, mockKnowledgeMapApi } from "../fixtures/knowledge-map";

const materialId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const artifactId = "44444444-4444-4444-8444-444444444444";
const learnerId = "55555555-5555-4555-8555-555555555555";
const revision = `knowledge-structure:sha256:${"a".repeat(64)}`;
const runPath = `/materials/${materialId}/runs/${runId}`;
const clockTime = new Date("2026-09-12T12:00:00Z");
const base: MaterialProcessingRunView = {
  schema: "material-processing-run/v1",
  cancel_requested_at: null,
  material_id: materialId,
  run_id: runId,
  source_artifact_id: artifactId,
  status: "running",
  progress_stage: "evidence",
  completed_pages: 3,
  total_pages: 45,
  created_at: "2026-09-12T11:59:58Z",
  updated_at: "2026-09-12T11:59:59Z",
  completed_at: null,
  error_code: null,
  output_binding: null,
};

function completed(status: "succeeded" | "partial"): MaterialProcessingRunView {
  return {
    ...base,
    status,
    progress_stage: "completed",
    completed_pages: 45,
    updated_at: clockTime.toISOString(),
    completed_at: clockTime.toISOString(),
    output_binding: {
      schema: "material-run-output-binding/v1",
      knowledge_structure_revision: revision,
      page_count: 45,
    },
  };
}

const unavailable = {
  schema: "api-error/v1",
  request_id: runId,
  reason_code: "STORAGE_UNAVAILABLE",
  retryable: true,
  message: "Request could not be completed.",
};
const evidence: MaterialProcessingRunView = {
  ...base,
  created_at: "2026-09-12T10:00:00Z",
  source_names: ["Network_Introduction.pdf", "Transport_Protocols.pptx", "Application_Integration.pdf"],
};
const semantics: MaterialProcessingRunView = {
  ...base,
  progress_stage: "semantics",
  completed_pages: 20,
};
const publishing: MaterialProcessingRunView = {
  ...base,
  progress_stage: "publishing",
  completed_pages: 45,
};

// material-flow.test.mjs covers calculation boundaries; this case checks their visual presentation.
const activeCases: [
  name: string,
  run: MaterialProcessingRunView,
  overall: number | null,
  current: number | null,
  step: number,
][] = [
  [
    "pending",
    { ...base, status: "pending", progress_stage: "queued", completed_pages: 0, total_pages: null },
    0,
    null,
    0,
  ],
  ["evidence", evidence, 3, 7, 1],
  ["semantics", semantics, 71, 44, 2],
  ["semantics-full", { ...semantics, completed_pages: 45 }, 99, 100, 2],
  ["publishing", publishing, 99, null, 3],
  ["unknown-total", { ...base, completed_pages: 0, total_pages: null }, null, null, 1],
];

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: clockTime });
  await page.clock.pauseAt(clockTime);
  await page.route(/\/v[12]\//, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    expect(request.method()).toBe(path === "/v1/session/refresh" ? "POST" : "GET");
    switch (path) {
      case "/v1/session":
      case "/v1/session/refresh":
        return route.fulfill({ json: { schema: "learner-identity/v1", learner_id: learnerId } });
      case "/v1/materials":
        return route.fulfill({ json: { schema: "material-library/v1", materials: [] } });
      default:
        throw new Error(`Unexpected processing request: ${request.method()} ${path}`);
    }
  });
});

async function mockRun(page: Page, respond: (route: Route) => Promise<void>) {
  let reads = 0;
  await page.route(`**/v1/material-processing-runs/${runId}`, (route) => {
    expect(route.request().method()).toBe("GET");
    reads++;
    return respond(route);
  });
  return () => reads;
}

for (const [name, run, overall, current, step] of activeCases)
  test(`processing ${name} shows measured progress and the current stage`, async ({ page }) => {
    const reads = await mockRun(page, (route) => route.fulfill({ json: run }));
    await page.goto(runPath);
    const processing = page.locator(".processing-page");
    await expect(processing.getByRole("heading", { level: 1 })).toHaveText(
      name === "pending" ? "Waiting to start" : "Analyzing material",
    );
    const overallBar = processing.getByRole("progressbar", { name: /^Overall progress/ });
    if (overall === null) {
      await expect(overallBar).toHaveAttribute(
        "aria-label",
        "Overall progress estimate is not yet available",
      );
      await expect(overallBar).not.toHaveAttribute("value");
    } else {
      await expect(overallBar).toHaveAttribute("aria-label", `Overall progress (estimated) ${overall}%`);
      await expect(overallBar).toHaveAttribute("value", String(overall));
    }
    await expect(processing.locator(".progress-estimate-note")).toHaveText(
      "Estimated from stages and pages, not time remaining.",
    );
    const stage = processing.locator(".processing-current");
    if (current === null) {
      await expect(stage.getByRole("heading")).toHaveText("Current status");
      await expect(stage.getByRole("progressbar")).toHaveCount(0);
      await expect(stage).toContainText(
        name === "pending" ? "Queued" : name === "publishing" ? "Publishing" : "Processing",
      );
      const indicator = stage.locator(".processing-status-indicator");
      await expect(indicator).toHaveAttribute("aria-hidden", "true");
      await expect(indicator).not.toHaveAttribute("role");
      await expect(processing.locator(".processing-status")).toHaveAttribute("aria-live", "polite");
    } else {
      await expect(stage.getByRole("heading")).toHaveText("Stage progress");
      await expect(stage.getByRole("progressbar")).toHaveAttribute("value", String(current));
      await expect(stage.getByRole("progressbar")).toHaveAttribute(
        "aria-label",
        `Stage progress ${current}%，Completed ${run.completed_pages} / 45 pages`,
      );
      await expect(stage.locator(".stage-pages")).toHaveText(
        `Completed ${run.completed_pages} / 45 pages`,
      );
      await expect(stage.locator(".processing-status-indicator")).toHaveCount(0);
    }
    const steps = processing.locator(".status-timeline > li");
    await expect(steps).toHaveCount(4);
    await expect(steps.nth(step)).toHaveAttribute("aria-current", "step");
    await expect(processing.locator(".status-timeline > li.is-complete")).toHaveCount(step);
    await expect(
      processing.getByRole("button", { name: "Cancel and delete material", exact: true }),
    ).toHaveCount(name === "publishing" ? 0 : 1);
    await expect(processing.getByRole("button", { name: "Open knowledge map", exact: true })).toHaveCount(
      0,
    );
    if (run.source_names) {
      await expect(processing.locator(".processing-sources li")).toHaveText(run.source_names);
      await expect(processing.locator(".processing-times")).toContainText("120m 0s");
    }
    expect(reads()).toBe(1);
  });

for (const status of ["succeeded", "partial"] as const)
  test(`processing ${status} opens its published map without requiring review`, async ({
    page,
  }) => {
    const run = completed(status);
    const view = structureView();
    view.status.processing = status;
    view.status.quality = status === "partial" ? "needs_review" : "accepted";
    await mockKnowledgeMapApi(page, view);
    await mockRun(page, (route) => route.fulfill({ json: run }));
    await page.goto(runPath);
    const processing = page.locator(".processing-page");
    await expect(processing.getByRole("heading", { level: 1 })).toHaveText("Analysis complete");
    await expect(processing.locator(".processing-grid h2")).toHaveText(["Processing summary", "Processing stages"]);
    await expect(processing.locator(".processing-summary")).toContainText("Pages processed: 45");
    await expect(processing.locator(".processing-summary ul > li")).toHaveText([
      "Concepts and key points linked to their sources",
      "Relationships between concepts",
      "Suggested learning order",
    ]);
    await expect(processing.locator(".status-badge")).toHaveText(
      status === "partial" ? "Partial results available" : "Processing complete",
    );
    await expect(processing.locator(".status-badge")).toHaveClass(
      `status-badge ${status === "partial" ? "is-partial" : "is-success"}`,
    );
    if (status === "partial") {
      await expect(processing.locator(".status-badge svg")).toHaveCount(0);
      await expect(processing.locator(".processing-hero")).toContainText("some content is incomplete");
    } else await expect(processing).not.toContainText(/Partial results available|incomplete/);
    await expect(processing.locator(".completion-bar strong")).toHaveText(
      status === "partial" ? "Knowledge map created" : "Your knowledge map is ready",
    );
    await expect(processing).not.toContainText(/Needs confirmation|Needs review|Your confirmation is needed|Check the content/);
    await expect(processing.getByRole("progressbar")).toHaveCount(0);
    await expect(
      processing.getByRole("button", { name: "Cancel and delete material", exact: true }),
    ).toHaveCount(0);
    await expect(processing.locator(".status-timeline > li.is-complete")).toHaveCount(4);
    await expect(processing.locator(".status-timeline p")).toHaveText(
      Array(4).fill("This stage is complete."),
    );
    const openMap = processing.getByRole("button", { name: "Open knowledge map", exact: true });
    await expect(openMap).toHaveClass("primary-button");
    await openMap.click();
    await expect(page).toHaveURL(
      new RegExp(`${runPath}/knowledge-structures/${encodeURIComponent(revision)}$`),
    );
    await expect(page.getByRole("heading", { name: "Knowledge map", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Concept map workspace", exact: true })).toBeVisible();
    await expect(page.locator(".concept-flow-node")).toHaveCount(view.concepts.length);
  });

test("analysis failure preserves its last progress and hides technical details until expanded", async ({
  page,
}) => {
  const reads = await mockRun(page, (route) =>
    route.fulfill({
      json: {
        ...base,
        status: "failed",
        error_code: "NO_USABLE_EVIDENCE",
        completed_at: clockTime.toISOString(),
      },
    }),
  );
  await page.goto(runPath);
  const processing = page.locator(".processing-page");
  await expect(processing.getByRole("heading", { level: 1 })).toHaveText("Analysis failed");
  await expect(processing).toContainText("Last recorded progress: Extracting pages and source evidence，3 / 45 pages");
  await expect(
    processing.getByRole("button", { name: "Analyze original sources again", exact: true }),
  ).toBeEnabled();
  await expect(processing.getByRole("button", { name: "Open knowledge map", exact: true })).toHaveCount(
    0,
  );
  await expect(processing.locator("code")).toBeHidden();
  await processing.getByText("Technical details", { exact: true }).click();
  await expect(processing.locator("code")).toHaveText("NO_USABLE_EVIDENCE");
  await expect(processing.locator("code")).toBeVisible();
  await page.clock.runFor(5_000);
  expect(reads()).toBe(1);
  await processing.getByRole("button", { name: "Back to library", exact: true }).click();
  await expect(page).toHaveURL(/\/materials$/);
  await expect(page.getByRole("heading", { name: "Your library is empty", exact: true })).toBeVisible();
});

for (const width of [2560, 920, 390])
  for (const [name, run] of [
    ["active", evidence],
    ["completed", completed("partial")],
  ] as const)
    test(`processing ${name} fits its frame without clipping at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await mockRun(page, (route) => route.fulfill({ json: run }));
      await page.goto(runPath);
      const processing = page.locator(".processing-page");
      await expect(processing.getByRole("heading", { level: 1 })).toHaveText(
        name === "active" ? "Analyzing material" : "Analysis complete",
      );
      await expect(processing.locator(".processing-grid > section")).toHaveCount(2);
      const layout = await processing.evaluate((element) => {
        const main = element.parentElement!;
        const css = getComputedStyle(main);
        return {
          width: element.getBoundingClientRect().width,
          usable:
            main.getBoundingClientRect().width -
            parseFloat(css.paddingLeft) -
            parseFloat(css.paddingRight),
          cards: Array.from(element.querySelectorAll(".processing-grid > section"), (card) =>
            card.getBoundingClientRect().toJSON(),
          ),
          hero: element.querySelector(".processing-hero")!.getBoundingClientRect().toJSON(),
          heading: element.querySelector("h1")!.getBoundingClientRect().toJSON(),
          clipped: Array.from(element.querySelectorAll("h1, h2, h3, p, button, strong"))
            .filter((e) => e.scrollWidth > e.clientWidth + 1)
            .map((e) => e.textContent),
          documentWidth: document.documentElement.scrollWidth,
        };
      });
      expect(layout.width).toBeGreaterThan(0);
      expect(layout.width).toBeCloseTo(Math.min(layout.usable, 1600), 0);
      expect(layout.cards).toHaveLength(2);
      for (const card of layout.cards) {
        expect(card.width).toBeGreaterThan(0);
        expect(card.height).toBeGreaterThan(0);
      }
      const [content, timeline] = layout.cards;
      if (width > 920) {
        expect(content.y).toBeCloseTo(timeline.y, 0);
        expect(content.y).toBeLessThan(350);
        expect(timeline.x).toBeGreaterThan(content.x + content.width);
        if (name === "active") {
          expect(timeline.width).toBeCloseTo(320, 0);
          expect(timeline.height).toBeLessThan(content.height);
        }
      } else expect(timeline.y).toBeGreaterThanOrEqual(content.y + content.height);
      if (width > 620) expect(layout.heading.y).toBeCloseTo(layout.hero.y, 0);
      if (name === "active") {
        const progress = await processing.locator(".processing-status").boundingBox();
        const sources = await processing.locator(".processing-sources").boundingBox();
        expect(progress!.y + progress!.height).toBeLessThanOrEqual(sources!.y);
        expect(progress!.y).toBeLessThan(350);
      }
      expect(layout.documentWidth).toBe(width);
      expect(layout.clipped).toEqual([]);
      await expect(page.locator(".sidebar-helper")).toHaveCount(0);
    });

test("loading announces its state and resumes when the backend responds", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mockRun(page, async (route) => {
    await pending;
    await route.fulfill({ json: base });
  });
  await page.goto(runPath);
  const processing = page.locator(".processing-page");
  await expect(processing.getByRole("heading", { level: 1 })).toHaveText("Loading processing status");
  await expect(processing).toHaveAttribute("aria-live", "polite");
  await expect(processing.getByRole("progressbar")).toHaveCount(0);
  await expect(processing.getByRole("button", { name: "Cancel and delete material", exact: true })).toHaveCount(
    0,
  );
  release();
  await expect(processing.getByRole("heading", { level: 1 })).toHaveText("Analyzing material");
  await expect(
    processing.getByRole("progressbar", { name: "Overall progress (estimated) 3%", exact: true }),
  ).toBeVisible();
});

test("polling uses backend progress, stops at terminal, and clears on unmount", async ({
  page,
}) => {
  let server = base;
  const reads = await mockRun(page, (route) => route.fulfill({ json: server }));
  await page.goto(runPath);
  const overall = page.getByRole("progressbar", { name: /^Overall progress/ });
  await expect(overall).toHaveAttribute("value", "3");
  await page.clock.runFor(1_000);
  expect(reads()).toBe(1);
  await expect(overall).toHaveAttribute("value", "3");
  await expect(page.locator(".processing-times")).toContainText("3s");
  await page.clock.runFor(3_000);
  await expect.poll(reads).toBeGreaterThanOrEqual(2);
  await expect(overall).toHaveAttribute("value", "3");
  server = semantics;
  await page.clock.runFor(3_000);
  await expect(overall).toHaveAttribute("value", "71");
  server = completed("succeeded");
  await page.clock.runFor(3_000);
  await expect(page.getByRole("heading", { name: "Analysis complete", exact: true })).toBeVisible();
  const terminalReads = reads();
  await page.clock.runFor(6_000);
  expect(reads()).toBe(terminalReads);
  server = base;
  await page.goto(runPath);
  await expect(overall).toHaveAttribute("value", "3");
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(page).toHaveURL(/\/materials$/);
  await expect(page.getByRole("heading", { name: "Your library is empty", exact: true })).toBeVisible();
  const unmountedReads = reads();
  await page.clock.runFor(6_000);
  expect(reads()).toBe(unmountedReads);
});

test("read failure retries the original run without creating work", async ({ page }) => {
  let failed = true;
  const reads = await mockRun(page, (route) =>
    failed ? route.fulfill({ status: 503, json: unavailable }) : route.fulfill({ json: base }),
  );
  await page.goto(runPath);
  await expect(page.getByRole("heading", { name: "Unable to load processing status", exact: true })).toBeVisible();
  await page.clock.runFor(5_000);
  expect(reads()).toBe(1);
  failed = false;
  await page.getByRole("button", { name: "Refresh", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("progressbar", { name: "Overall progress (estimated) 3%", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${runPath}$`));
  expect(reads()).toBe(2);
});

test("reduced motion preserves publishing status without animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockRun(page, (route) => route.fulfill({ json: publishing }));
  await page.goto(runPath);
  const indicator = page.locator(".processing-status-indicator");
  await expect(indicator).toBeVisible();
  expect(await indicator.evaluate((element) => getComputedStyle(element).animationName)).toBe(
    "none",
  );
  await expect(page.locator(".processing-status")).toContainText("Publishing");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(await indicator.evaluate((element) => getComputedStyle(element).animationName)).toBe(
    "spin",
  );
});
