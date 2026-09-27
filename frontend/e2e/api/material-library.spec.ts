import { expect, test, type Page } from "@playwright/test";
import type { MaterialLibraryView } from "../../src/api/contracts";

const browserOrigin = process.env.STUDYDY_E2E_BASE_URL ?? "http://127.0.0.1:4173";

test.skip(process.env.STUDYDY_E2E_LIBRARY !== "true", "Requires the local library API/DB fixture");

async function login(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Synthetic test password 42");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back!", level: 1, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^(Library|My materials)$/, exact: true }).click();
  await expect(page.getByRole("heading", { name: "My materials", exact: true })).toBeVisible();
}

test("fresh profiles reopen the current head and read exact historical versions", async ({
  browser,
}) => {
  const original = await browser.newContext();
  const page = await original.newPage();
  await login(page, "learner_test@example.com");
  const first = page.getByRole("article", { name: "Stack_Notes.pdf", exact: true });
  await expect(first).toContainText("Knowledge map creation failed");
  await expect(page.getByText("Private_Material_B.pdf", { exact: true })).toHaveCount(0);
  await first.getByRole("button", { name: "Open knowledge map", exact: true }).click();
  await expect(page.getByRole("button", { name: "Source concept: Stack", exact: true })).toBeVisible();
  const newerPath = new URL(page.url()).pathname;
  await page.reload();
  await expect(page.getByRole("button", { name: "Source concept: Stack", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
  await original.close();

  // Use an independent browser and find material through sign-in and its display name.
  const fresh = await browser.newContext();
  const freshPage = await fresh.newPage();
  await login(freshPage, "learner_test@example.com");
  // Only public identity hints belong in local storage, never content, navigation identities, or credentials.
  expect(await freshPage.evaluate(() => Object.keys(localStorage))).toEqual([
    "studydy.session-hint",
  ]);
  expect(
    await freshPage.evaluate(() => JSON.parse(localStorage.getItem("studydy.session-hint")!)),
  ).toEqual({
    schema: "learner-identity/v1",
    learner_id: expect.any(String),
  });
  await freshPage.getByRole("button", { name: "Open knowledge map", exact: true }).click();
  await expect(freshPage).toHaveURL(`${browserOrigin}${newerPath}`);
  await expect(
    freshPage.getByRole("button", { name: "Source concept: Stack", exact: true }),
  ).toBeVisible();
  // The workspace opens the head; fixed-version API reads must verify revision identity, not just labels.
  const library: MaterialLibraryView = await (
    await fresh.request.get(`${browserOrigin}/v1/materials`)
  ).json();
  const material = library.materials.find((item) => item.display_name === "Stack_Notes.pdf")!;
  expect(material.available_structures).toHaveLength(2);
  const head = material.available_structures.find(
    (structure) => structure.knowledge_structure_revision === material.head_revision,
  )!;
  expect(head).toBeDefined();
  const headPath = `/materials/${material.material_id}/runs/${head.run_id}/knowledge-structures/${encodeURIComponent(head.knowledge_structure_revision)}`;
  expect(newerPath).toBe(headPath);
  for (const structure of material.available_structures) {
    const revision = structure.knowledge_structure_revision;
    const response = await fresh.request.get(
      `${browserOrigin}/v1/materials/${material.material_id}/knowledge-structures/${encodeURIComponent(revision)}`,
    );
    expect(response.status()).toBe(200);
    expect((await response.json()).knowledge_structure_revision).toBe(revision);
    const run = await fresh.request.get(
      `${browserOrigin}/v1/material-processing-runs/${structure.run_id}`,
    );
    expect(run.status()).toBe(200);
    expect((await run.json()).output_binding.knowledge_structure_revision).toBe(revision);
    await freshPage.goto(
      `/materials/${material.material_id}/runs/${structure.run_id}/knowledge-structures/${encodeURIComponent(revision)}`,
    );
    await expect(
      freshPage.getByRole("button", { name: "Source concept: Stack", exact: true }),
    ).toBeVisible();
    await expect(freshPage).toHaveURL(`${browserOrigin}${headPath}`);
  }
  await freshPage.getByRole("button", { name: /^(Library|My materials)$/, exact: true }).click();
  const pdfUrl = `/v1/artifacts/${material.source_artifact_id}`;
  const pdf = await fresh.request.get(`${browserOrigin}${pdfUrl}`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["cache-control"]).toBe("private, no-store");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  await freshPage
    .getByRole("article", { name: "Stack_Notes.pdf", exact: true })
    .getByRole("button", { name: "Open knowledge map", exact: true })
    .click();
  await expect(freshPage).toHaveURL(`${browserOrigin}${newerPath}`);
  await expect(
    freshPage.getByRole("button", { name: "Source concept: Stack", exact: true }),
  ).toBeVisible();
  await freshPage.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(freshPage.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
  await login(freshPage, "library_b@example.com");
  await expect(
    freshPage.getByRole("article", { name: "Private_Material_B.pdf", exact: true }),
  ).toBeVisible();
  await expect(freshPage.getByText("Stack_Notes.pdf", { exact: true })).toHaveCount(0);
  expect((await fresh.request.get(`${browserOrigin}${pdfUrl}`)).status()).toBe(404);
  await freshPage.goBack();
  await expect(freshPage.getByRole("button", { name: "Source concept: Stack", exact: true })).toHaveCount(
    0,
  );
  await fresh.close();
});
