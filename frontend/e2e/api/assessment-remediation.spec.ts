import { expect, test, type Page } from "@playwright/test";

test.skip(
  process.env.STUDYDY_E2E_REMEDIATION !== "true",
  "Requires isolated remediation API/DB fixture",
);
const data = JSON.parse(process.env.STUDYDY_E2E_REMEDIATION_DATA ?? "{}");
const study = `/materials/${data.material}/runs/${data.run}/knowledge-structures/${encodeURIComponent(data.revision)}/study-sessions/${data.session}`;
// Cover the real API flow at one representative size; study-* mocks cover mobile layouts.
const viewport = { width: 1536, height: 900 };
const passedMessage = "You passed this check. This result applies only to the points assessed here.";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("learner_test@example.com");
  await page.getByLabel("Password", { exact: true }).fill("Synthetic test password 42");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back!", exact: true, level: 1 }),
  ).toBeVisible();
}

const card = (page: Page, n: number) =>
  page.getByRole("article", { name: `Question ${n}`, exact: true });

test("wrong points directly form groups and survive lost create responses", async ({
  page,
  browser,
}) => {
  await page.setViewportSize(viewport);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  await page.goto(study);
  await page.getByRole("button", { name: "Start practice (3)", exact: true }).click();
  await expect(page.locator(".assessment-set-item")).toHaveCount(3);
  const rootUrl = page.url();
  for (let n = 1; n <= 3; n++) {
    await card(page, n)
      .getByRole("radio", { name: n === 1 ? /\bcode0\b/ : new RegExp(`wrong${n - 1}a`) })
      .check();
  }
  await page.getByRole("button", { name: "Submit and view results", exact: true }).click();
  const reviews = page.getByRole("article", { name: "Points needing practice", exact: true });
  await expect(reviews).toHaveCount(2);
  await expect(reviews.nth(0)).toContainText("Signal 1 uses code1.");
  await expect(reviews.nth(1)).toContainText("Signal 2 uses code2.");
  await expect(page.getByRole("button", { name: "Start follow-up (2)", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Start follow-up (2)", exact: true })).toBeVisible();
  let lostCreate = false;
  await page.route("**/assessment-sets/*/remediation", async (route) => {
    if (lostCreate) {
      await route.continue();
      return;
    }
    lostCreate = true;
    const response = await route.fetch();
    expect(response.status()).toBe(202);
    await route.abort();
  });
  await page.getByRole("button", { name: "Start follow-up (2)", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh practice set", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Refresh practice set", exact: true }).click();
  await page.getByRole("button", { name: "Resume follow-up", exact: true }).click();
  await expect(page.locator(".assessment-set-item")).toHaveCount(2);
  expect(page.url()).not.toBe(rootUrl);
  await expect(page.getByText("Targeted follow-up practice", { exact: true })).toBeVisible();
  await card(page, 1)
    .getByRole("radio", { name: /\bcode1\b/ })
    .check();
  await card(page, 2)
    .getByRole("radio", { name: /wrong2a/ })
    .check();
  await page.getByRole("button", { name: "Submit and view results", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start follow-up (1)", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Start follow-up (1)", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start follow-up (1)", exact: true }).click();
  await expect(page.locator(".assessment-set-item")).toHaveCount(1);
  const childUrl = page.url();
  await card(page, 1)
    .getByRole("radio", { name: /\bcode2\b/ })
    .check();
  await page.getByRole("button", { name: "Submit and view results", exact: true }).click();
  await expect(page.getByText(passedMessage, { exact: true })).toBeVisible();

  const context = await browser.newContext({ viewport });
  const fresh = await context.newPage();
  await login(fresh);
  await fresh.goto(childUrl);
  await expect(fresh.getByText(passedMessage, { exact: true })).toBeVisible();
  const progress = await (
    await fresh.request.get(`/v1/study-sessions/${data.session}/progress`)
  ).json();
  expect(progress.assessment_cycles[0].outcome).toBe("passed");
  expect(progress.event_watermark).toBe(6);
  expect(
    progress.concept_states.find((c: { concept_id: string }) => c.concept_id === data.concept)
      .qualified_correct_items,
  ).toBe(1);
  await fresh
    .locator(".assessment-set-history")
    .getByRole("button")
    .filter({ hasText: "Initial check" })
    .click();
  await expect(fresh).toHaveURL(rootUrl);
  await expect(fresh.locator(".assessment-set-item")).toHaveCount(3);
  await fresh.getByRole("button", { name: "Next concept: Other topic", exact: true }).click();
  await expect(fresh).toHaveURL(study);
  await expect(
    fresh.getByRole("heading", { name: "Other topic", level: 1, exact: true }),
  ).toBeVisible();
  await expect(fresh.getByRole("button", { name: "Start practice (1)", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});
