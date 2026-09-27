import { expect, test, type Page } from "@playwright/test";
import type {
  MaterialLibraryItem,
  MaterialAttemptView,
  StudySessionLink,
} from "../../src/api/contracts";

const materialId = "11111111-1111-4111-8111-111111111111";
const publishedRun = "22222222-2222-4222-8222-222222222222";
const latestRun = "33333333-3333-4333-8333-333333333333";
const studyId = "44444444-4444-4444-8444-444444444444";
const revision = `knowledge-structure:sha256:${"a".repeat(64)}`;
const base: MaterialLibraryItem = {
  schema: "material-library-item/v1",
  material_id: materialId,
  source_artifact_id: materialId,
  display_name: "Data_Structures_Notes.pdf",
  size_bytes: 1200,
  created_at: "2026-09-12T00:00:00Z",
  latest_attempt: null,
  available_structures: [],
  study_sessions: [],
};
const run: MaterialAttemptView = {
  cancel_requested_at: null,
  run_id: latestRun,
  status: "running",
  progress_stage: "semantics",
  completed_pages: 2,
  total_pages: 8,
  error_code: null,
  created_at: "2026-09-12T01:00:00Z",
};
const published = {
  run_id: publishedRun,
  knowledge_structure_revision: revision,
  status: "succeeded" as const,
  created_at: "2026-09-12T00:30:00Z",
};
const active: StudySessionLink = {
  study_session_id: studyId,
  run_id: publishedRun,
  knowledge_structure_revision: revision,
  status: "active",
  started_at: "2026-09-12T02:00:00Z",
  current_concept_id: null,
};
const states = [
  "empty",
  "uploaded",
  "pending",
  "running",
  "failed",
  "failed-map",
  "map",
  "partial",
  "active",
  "completed",
  "multiple",
  "long-name",
  "loading",
  "failure",
] as const;
type State = (typeof states)[number];

function material(state: State): MaterialLibraryItem {
  const item = structuredClone(base);
  if (["pending", "running", "failed", "failed-map"].includes(state))
    item.latest_attempt = {
      ...run,
      status: state.startsWith("failed") ? "failed" : state === "pending" ? "pending" : "running",
      progress_stage: state === "pending" ? "queued" : "semantics",
      error_code: state.startsWith("failed") ? "STORAGE_UNAVAILABLE" : null,
    };
  if (["map", "partial", "failed-map", "active", "completed", "long-name"].includes(state)) {
    item.available_structures = [
      { ...published, status: state === "partial" ? "partial" : "succeeded" },
    ];
    item.latest_attempt ??= {
      ...run,
      run_id: publishedRun,
      status: state === "partial" ? "partial" : "succeeded",
      progress_stage: "completed",
      completed_pages: 8,
    };
  }
  if (["active", "completed", "long-name"].includes(state))
    item.study_sessions = [{ ...active, status: state === "completed" ? "completed" : "active" }];
  if (state === "long-name")
    item.display_name = "Data_Structures_and_Algorithms_" + "VeryLongMaterialFilename".repeat(6) + ".pdf";
  return item;
}

function materials(state: State): MaterialLibraryItem[] {
  if (["empty", "loading", "failure"].includes(state)) return [];
  if (state === "multiple")
    return (["uploaded", "running", "failed", "failed-map", "active", "completed"] as const).map(
      (value, index) => ({
        ...material(value),
        material_id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
        display_name: [
          "Algorithm_Class_Notes.pdf",
          "Weekly_Lesson_Recursion_Trees_Concepts_and_Practice.pdf",
          "Arrays.pdf",
          "Stack_Notes.pdf",
          "Queues_and_Practice.pdf",
          "Graph_Theory_Notes.pdf",
        ][index],
      }),
    );
  return [material(state)];
}

test.beforeEach(async ({ page }) => {
  await page.route(/\/v[12]\//, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (["/v1/session", "/v1/session/refresh"].includes(path)) {
      expect(route.request().method()).toBe(path.endsWith("/refresh") ? "POST" : "GET");
      return route.fulfill({
        json: { schema: "learner-identity/v1", learner_id: "99999999-9999-4999-8999-999999999999" },
      });
    }
    // Destination specs cover their data flows; this case checks library navigation.
    return route.fulfill({
      status: 404,
      json: {
        schema: "api-error/v1",
        request_id: materialId,
        reason_code: "RESOURCE_NOT_FOUND",
        retryable: false,
        message: "Request could not be completed.",
      },
    });
  });
});

async function mockLibrary(page: Page, readItems: () => MaterialLibraryItem[]) {
  let reads = 0;
  await page.route("**/v1/materials", (route) => {
    expect(route.request().method()).toBe("GET");
    reads++;
    return route.fulfill({ json: { schema: "material-library/v1", materials: readItems() } });
  });
  return () => reads;
}

// Expected actions are independent for each state; geometry cases check column counts.
const expectedActions: Record<State, string[][]> = {
  empty: [],
  loading: [],
  failure: [],
  uploaded: [["Build a knowledge map"]],
  pending: [["View progress"]],
  running: [["View progress"]],
  failed: [["View issue"]],
  "failed-map": [["Open knowledge map", "View issue"]],
  map: [["Open knowledge map"]],
  partial: [["Open knowledge map"]],
  active: [["Continue studying", "Open knowledge map"]],
  completed: [["View study results", "Open knowledge map"]],
  "long-name": [["Continue studying", "Open knowledge map"]],
  multiple: [
    ["Build a knowledge map"],
    ["View progress"],
    ["View issue"],
    ["Open knowledge map", "View issue"],
    ["Continue studying", "Open knowledge map"],
    ["View study results", "Open knowledge map"],
  ],
};

for (const state of states) {
  test(`material collection ${state} exposes the matching actions`, async ({ page }) => {
    const items = materials(state);
    await mockLibrary(page, () => items);
    let releaseRead!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    if (state === "loading" || state === "failure")
      await page.route(
        "**/v1/materials",
        async (route) => {
          expect(route.request().method()).toBe("GET");
          if (state === "loading") {
            await gate;
            return route.fallback();
          }
          return route.fulfill({
            status: 503,
            json: {
              schema: "api-error/v1",
              request_id: materialId,
              reason_code: "STORAGE_UNAVAILABLE",
              retryable: true,
              message: "Request could not be completed.",
            },
          });
        },
        { times: 1 },
      );
    await page.goto("/materials");
    if (state === "loading" || state === "failure") {
      await expect(
        page.getByRole("heading", {
          name: state === "loading" ? "Loading your library" : "Unable to load materials",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByRole("searchbox")).toHaveCount(0);
      if (state === "loading") releaseRead();
      else {
        await expect(
          page.getByText("Storage is temporarily unavailable. Please try again later.", { exact: true }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Refresh", exact: true }).click();
      }
    }
    const cards = page.locator(".library-item");
    await expect(cards).toHaveCount(items.length);
    await expect(page.locator(".sidebar-helper")).toHaveCount(0);
    if (!items.length) await expect(page.locator(".library-empty")).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search material names", exact: true })).toHaveCount(
      items.length ? 1 : 0,
    );
    for (const [index, item] of items.entries()) {
      const card = cards.nth(index);
      const actions = expectedActions[state][index];
      await expect(card.getByRole("heading")).toHaveText(item.display_name);
      await expect(card.getByRole("button", { name: item.display_name, exact: true })).toHaveCount(
        0,
      );
      await expect(card.locator(".state-actions > button")).toHaveText(actions);
      await expect(card.locator(".primary-button")).toHaveText(actions[0]);
      await expect(card.getByRole("link")).toHaveCount(0);
      await expect(card.locator("details:not(.material-management-menu)")).toHaveCount(0);
      await expect(card.getByRole("region", { name: "Published revisions" })).toHaveCount(0);
      await expect(card.getByRole("region", { name: "Study history" })).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("latest structure controls exact saved learning binding, never an older state", async ({
  page,
}) => {
  const newerRun = "55555555-5555-4555-8555-555555555555";
  const newerRevision = `knowledge-structure:sha256:${"b".repeat(64)}`;
  const item = material("active");
  item.available_structures.push({
    ...published,
    run_id: newerRun,
    knowledge_structure_revision: newerRevision,
  });
  item.head_revision = newerRevision;
  item.study_sessions.push(
    {
      ...active,
      study_session_id: "66666666-6666-4666-8666-666666666666",
      knowledge_structure_revision: newerRevision,
    },
    { ...active, study_session_id: "77777777-7777-4777-8777-777777777777", run_id: newerRun },
  );
  await mockLibrary(page, () => [item]);
  await page.goto("/materials");
  await expect(page.getByRole("article").locator(".primary-button")).toHaveText("Open knowledge map");
  await expect(page.getByRole("button", { name: "Continue studying", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Open knowledge map", exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe(
      `/materials/${materialId}/runs/${newerRun}/knowledge-structures/${encodeURIComponent(newerRevision)}`,
    );
  item.study_sessions.push({
    ...active,
    study_session_id: "88888888-8888-4888-8888-888888888888",
    run_id: newerRun,
    knowledge_structure_revision: newerRevision,
  });
  await page.goto("/materials");
  await page.getByRole("article").getByRole("button", { name: "Continue studying", exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe(
      `/materials/${materialId}/runs/${newerRun}/knowledge-structures/${encodeURIComponent(newerRevision)}/study-sessions/88888888-8888-4888-8888-888888888888`,
    );
});

test("direct hub polls an active run until a usable map is published", async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  let publishedNow = false;
  const reads = await mockLibrary(page, () => [material(publishedNow ? "map" : "pending")]);
  await page.goto("/materials");
  await expect(page.getByRole("article").locator(".primary-button")).toHaveText("View progress");
  publishedNow = true;
  await page.clock.runFor(3000);
  await expect(page.getByRole("article").locator(".primary-button")).toHaveText("Open knowledge map");
  expect(reads()).toBe(2);
  const stopped = reads();
  await page.clock.runFor(6000);
  expect(reads()).toBe(stopped);
});

const searchNames = [
  "Python_Standard_Functions_2026.pdf",
  "03_Public_Finance_Introduction.pdf",
  "07_Operating_Systems_ch05.pdf",
  "02_Programming_Arrays_Strings_2025.pdf",
  "Programming  Fundamentals_Supplement.pdf",
];
const searchItems = () =>
  searchNames.map((display_name, index) => ({
    ...structuredClone(base),
    display_name,
    material_id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
  }));

for (const viewport of [
  { width: 1536, height: 1024 },
  { width: 390, height: 844 },
]) {
  test(`material name search stays local and clears only through the native cancel control at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const items = searchItems();
    const reads = await mockLibrary(page, () => items);
    await page.goto("/materials");
    const input = page.getByRole("searchbox", { name: "Search material names", exact: true });
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute("placeholder", "Search material names…");
    await expect(page.locator(".library-header input")).toHaveCount(0);
    for (const [query, expected] of [
      ["Programming_Arrays", [searchNames[3]]],
      ["python", [searchNames[0]]],
      ["  Programming   Fundamentals ", [searchNames[4]]],
      ["2025", [searchNames[3]]],
      ["_ch05", [searchNames[2]]],
      ["PDF", searchNames],
    ] as const) {
      await input.fill(query);
      await expect(page.locator(".library-item h2")).toHaveText([...expected]);
      await expect(page.locator(".library-subtitle")).toContainText("Saved materials: 5");
    }
    await input.fill("Databases");
    await expect(page.locator(".library-item")).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("No materials match “Databases”");
    await expect(page.locator(".library-empty")).toHaveCount(0);
    await expect(input).toHaveAttribute("type", "search");
    await expect(page.locator(".library-search-empty > *")).toHaveText([
      "No materials match “Databases”",
      "Try a different material name.",
    ]);
    await expect(page.getByRole("button", { name: "Clear search", exact: true })).toHaveCount(0);
    await input.press("Escape");
    await expect(input).toHaveValue("Databases");
    await expect(input).toBeFocused();
    await expect(page.locator(".library-item")).toHaveCount(0);
    // Click the native search clear control geometrically because it lives in the UA shadow tree.
    const clickNativeCancel = async () => {
      const bounds = (await input.boundingBox())!;
      await input.click({ position: { x: bounds.width - 21, y: bounds.height / 2 } });
      await expect(input).toHaveValue("");
      await expect(page.locator(".library-item h2")).toHaveText(searchNames);
      await expect(page.locator(".library-search-empty")).toHaveCount(0);
    };
    await clickNativeCancel();
    await input.fill(items[0].material_id);
    await expect(page.locator(".library-item")).toHaveCount(0);
    await clickNativeCancel();
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();
    await input.fill("Python");
    await expect(page.locator(".library-item")).toHaveCount(1);
    await input.press("Escape");
    await expect(input).toHaveValue("Python");
    await expect(page.locator(".library-item")).toHaveCount(1);
    await input.press("Enter");
    await expect(input).toHaveValue("Python");
    expect(reads()).toBe(1);
    const box = (await input.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(42);
    expect(box.height).toBeLessThanOrEqual(46);
    const width = box.width;
    expect(width).toBeLessThanOrEqual(580);
    if (viewport.width === 390) expect(width).toBeGreaterThan(300);
    expect(await input.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("polling reapplies the same material-name query to refreshed data", async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  let items = [{ ...searchItems()[0], latest_attempt: run }, searchItems()[1]];
  const reads = await mockLibrary(page, () => items);
  await page.goto("/materials");
  const input = page.getByRole("searchbox", { name: "Search material names" });
  await input.fill("python");
  await expect(page.locator(".library-item")).toHaveCount(1);
  items = [...items, { ...searchItems()[2], display_name: "Python_Update.pdf" }];
  await page.clock.runFor(3000);
  await expect.poll(reads).toBe(2);
  await expect(input).toHaveValue("python");
  await expect(page.locator(".library-item h2")).toHaveText([searchNames[0], "Python_Update.pdf"]);
  await expect(page.locator(".library-subtitle")).toContainText("Saved materials: 3");
});

test("removing a search match preserves query and shows search no-result", async ({ page }) => {
  let items = searchItems();
  let deletes = 0;
  await mockLibrary(page, () => items);
  await page.route(`**/v1/materials/${items[0].material_id}`, (route) => {
    expect(route.request().method()).toBe("DELETE");
    deletes++;
    const removed = items[0];
    items = items.slice(1);
    return route.fulfill({
      status: 202,
      json: { schema: "material-discard/v1", material_id: removed.material_id, state: "removed" },
    });
  });
  await page.goto("/materials");
  const input = page.getByRole("searchbox", { name: "Search material names" });
  await input.fill("python");
  await page.getByRole("button", { name: /^Manage / }).click();
  await page.getByRole("button", { name: "Delete material", exact: true }).click();
  await page.getByRole("button", { name: "Confirm deletion", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("No materials match “python”");
  await expect(input).toHaveValue("python");
  await expect(page.locator(".library-empty")).toHaveCount(0);
  await expect(page.locator(".library-subtitle")).toContainText("Saved materials: 4");
  expect(deletes).toBe(1);
});

for (const viewport of [
  { width: 1920, height: 1080, columns: 4 },
  { width: 1536, height: 1024, columns: 3 },
  { width: 1024, height: 768, columns: 2 },
  { width: 390, height: 844, columns: 1 },
])
  test(`bookshelf geometry and expanded management at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const names = [
      "Calculus_Curve_Sketching_Extrema_Derivatives_Concavity_Asymptotes_and_Applications_With_Worked_Examples_and_Exercises",
      "Data structures and algorithms",
      "Linear algebra",
      "Programming",
      "Discrete mathematics",
    ];
    const items = (["uploaded", "active", "map", "active", "map"] as const).map((state, index) => ({
      ...material(state),
      material_id: `10000000-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
      display_name: names[index],
      source_count: index === 1 || index === 2 ? 3 : 1,
    }));
    await mockLibrary(page, () => items);
    await page.goto("/materials");
    const cards = page.locator(".library-item");
    await expect(cards).toHaveCount(5);
    await expect(page.getByText("No map has been built", { exact: true })).toHaveCount(0);
    await expect(cards.nth(0).locator(".primary-button")).toHaveText("Build a knowledge map");
    for (const index of [1, 3]) {
      await expect(cards.nth(index).locator(".primary-button")).toHaveText("Continue studying");
      await expect(cards.nth(index).locator(".secondary-button")).toHaveText("Open knowledge map");
    }
    for (const index of [2, 4])
      await expect(cards.nth(index).locator(".primary-button")).toHaveText("Open knowledge map");
    const geometry = await cards.evaluateAll((elements) =>
      elements.map((card) => {
        const box = card.getBoundingClientRect();
        const rect = (selector: string) => card.querySelector(selector)!.getBoundingClientRect();
        return {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          actionY: rect("fieldset").y,
          actionOffset: rect("fieldset").y - box.y,
          titleOffset: rect("h2").y - box.y,
          metadataOffset: rect(".library-metadata").y - box.y,
          buttonBottom: box.bottom - rect("fieldset button").bottom,
        };
      }),
    );
    for (const key of [
      "width",
      "height",
      "actionOffset",
      "titleOffset",
      "metadataOffset",
      "buttonBottom",
    ] as const) {
      const values = geometry.map((box) => box[key]);
      expect(Math.max(...values) - Math.min(...values), key).toBeLessThanOrEqual(1);
    }
    expect(geometry.filter((box) => Math.abs(box.y - geometry[0].y) < 1)).toHaveLength(
      viewport.columns,
    );
    for (const box of geometry) {
      expect(box.buttonBottom).toBeGreaterThanOrEqual(20);
      expect(box.buttonBottom).toBeLessThanOrEqual(26);
      for (const other of geometry.filter((other) => Math.abs(other.y - box.y) < 1)) {
        expect(Math.abs(box.actionY - other.actionY)).toBeLessThanOrEqual(1);
      }
    }
    const frame = (await page.locator(".material-library").boundingBox())!;
    if (viewport.width === 1920) expect(frame.width).toBeGreaterThan(1500);
    if (viewport.columns === 1) expect(geometry[0].width).toBeCloseTo(frame.width, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(cards.first().getByRole("heading")).toHaveAttribute("title", names[0]);
    expect(
      await cards
        .first()
        .getByRole("heading")
        .evaluate((element) => element.scrollHeight > element.clientHeight),
    ).toBe(true);

    const card = cards.first();
    await card.getByRole("button", { name: `Manage ${names[0]}`, exact: true }).click();
    await expect(card.getByRole("button", { name: "Manage material", exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(card.getByRole("textbox", { name: "Material name", exact: true })).toHaveValue(
      names[0],
    );
    await expect(card.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    const form = (await card.getByRole("form").boundingBox())!;
    const expanded = (await card.boundingBox())!;
    expect(form.y + form.height).toBeLessThanOrEqual(expanded.y + expanded.height);
    await card.getByRole("button", { name: "Cancel", exact: true }).click();
    await card.getByRole("button", { name: `Manage ${names[0]}`, exact: true }).click();
    await card.getByRole("button", { name: "Delete material", exact: true }).click();
    await expect(card.getByRole("button", { name: "Confirm deletion", exact: true })).toBeVisible();
    const confirmation = (await card.getByRole("form").boundingBox())!;
    const deleting = (await card.boundingBox())!;
    expect(confirmation.y + confirmation.height).toBeLessThanOrEqual(deleting.y + deleting.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await card.getByRole("button", { name: "Cancel", exact: true }).click();
  });
