import { expect, test } from "@playwright/test";

test.skip(
  process.env.STUDYDY_E2E_NORMALIZATION_REAL !== "true",
  "Requires isolated API/database/converter fixture",
);

const sourceText =
  "Stacks\nA stack follows LIFO order.\nPush adds an item to the top. Pop removes the top item.\n";

test("conversion preserves the original file and waits for explicit analysis", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("learner_test@example.com");
  await page.getByLabel("Password", { exact: true }).fill("Synthetic test password 42");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome back!", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Upload materials", exact: true }).click();
  await page.getByLabel("Choose material files", { exact: true }).setInputFiles({
    name: "normalization.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(sourceText),
  });
  await page.getByRole("button", { name: "Upload and review sources" }).click();
  await expect(page).toHaveURL(/\/materials\/[0-9a-f-]+\/sources$/);
  const materialId = new URL(page.url()).pathname.split("/")[2];
  const materialPath = `/v1/materials/${materialId}`;
  await expect(page.getByRole("button", { name: "Start analysis" })).toBeVisible({ timeout: 20000 });
  await page.reload();
  const before = await (await page.request.get(materialPath)).json();
  expect(before.latest_attempt).toBeNull();
  const original = await page.getByRole("link", { name: "Download original" }).getAttribute("href");
  const content = await page.request.get(original!);
  expect(content.status()).toBe(200);
  expect(await content.text()).toBe(sourceText);
  const preview = await page.getByRole("link", { name: /Preview PDF/ }).getAttribute("href");
  const pdf = await page.request.get(preview!);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  await page.getByRole("button", { name: "Start analysis" }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "Waiting to start", exact: true })).toBeVisible();
  const after = await (await page.request.get(materialPath)).json();
  expect(after.source.status).toBe("ready");
  expect(after.latest_attempt.status).toBe("pending");
});
