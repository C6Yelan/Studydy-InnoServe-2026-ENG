import { expect, test, type Page } from "@playwright/test";

const origin = process.env.STUDYDY_E2E_BASE_URL ?? "http://127.0.0.1:4173";
const password = "Synthetic test password 42";
const learnerId = process.env.STUDYDY_E2E_ACCOUNT_LEARNER!;
const materialId = process.env.STUDYDY_E2E_ACCOUNT_MATERIAL!;
const runId = process.env.STUDYDY_E2E_ACCOUNT_RUN!;
const revision = process.env.STUDYDY_E2E_ACCOUNT_REVISION!;
const artifactId = process.env.STUDYDY_E2E_ACCOUNT_ARTIFACT!;
const mapPath = `/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(revision)}`;

// Use real cookies, ownership checks, and storage; mock/accounts.spec.ts covers presentation.
test.skip(!learnerId, "Requires the local account API/DB fixture");

async function login(page: Page, email: string, suppliedPassword = password) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(suppliedPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("real accounts survive new browser profiles; logout and back never reveal another owner", async ({
  browser,
}) => {
  const a = await browser.newContext();
  const page = await a.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
  await login(page, "learner_test@example.com", "Wrong synthetic password");
  await expect(page.getByRole("alert")).toHaveText("Incorrect email or password.");
  await login(page, "learner_test@example.com");
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  expect((await (await a.request.get(`${origin}/v1/session`)).json()).learner_id).toBe(learnerId);
  await expect(
    page.getByRole("heading", { name: "Welcome back!", level: 1, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation", exact: true })).toBeVisible();

  await page.goto(mapPath);
  await expect(page.getByRole("button", { name: "Source concept: Stack", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Source concept: Stack", exact: true })).toBeVisible();
  const otherTab = await a.newPage();
  await otherTab.goto(mapPath);
  await expect(
    otherTab.getByRole("button", { name: "Source concept: Stack", exact: true }),
  ).toBeVisible();
  // Inject one transport failure for sign-out; the retry still revokes the session through the real API.
  await page.route(
    "**/v1/session",
    (route) =>
      route.fulfill({
        status: 503,
        json: {
          schema: "api-error/v1",
          request_id: learnerId,
          reason_code: "STORAGE_UNAVAILABLE",
          retryable: true,
          message: "Request could not be completed.",
        },
      }),
    { times: 1 },
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByText(/Sign-out did not complete/)).toBeVisible();
  await expect(page.getByText("Stack", { exact: true })).toHaveCount(0);
  await expect(otherTab.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
  const loggedOut = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/session") &&
      response.request().method() === "DELETE" &&
      response.status() === 204,
  );
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await loggedOut;
  await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
  await otherTab.close();
  expect((await a.request.get(`${origin}/v1/session`)).status()).toBe(401);
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.getByLabel("Email", { exact: true }).fill("browser_account_b@example.com");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  const bId = (await (await a.request.get(`${origin}/v1/session`)).json()).learner_id;
  expect(bId).not.toBe(learnerId);
  await page.goBack();
  await expect(page.getByText("Stack", { exact: true })).toHaveCount(0);
  await page.goto(mapPath);
  await expect(page.getByText("Stack", { exact: true })).toHaveCount(0);
  expect((await a.request.get(`${origin}/v1/artifacts/${artifactId}`)).status()).toBe(404);
  expect((await a.request.get(`${origin}/v1/material-processing-runs/${runId}`)).status()).toBe(
    404,
  );
  await a.close();

  // Sign in from an independent profile without copying cookies or local storage.
  const fresh = await browser.newContext();
  const freshPage = await fresh.newPage();
  await freshPage.goto("/");
  await login(freshPage, "learner_test@example.com");
  await expect(freshPage.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  expect((await (await fresh.request.get(`${origin}/v1/session`)).json()).learner_id).toBe(
    learnerId,
  );
  await freshPage.goto(mapPath);
  await expect(
    freshPage.getByRole("button", { name: "Source concept: Stack", exact: true }),
  ).toBeVisible();
  expect((await fresh.request.get(`${origin}/v1/artifacts/${artifactId}`)).status()).toBe(200);
  await fresh.request.delete(`${origin}/v1/session`, { headers: { Origin: origin } });
  await freshPage.getByRole("button", { name: "Source concept: Stack", exact: true }).click();
  await freshPage.getByRole("button", { name: "Start studying", exact: true }).click();
  await expect(freshPage.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
  await expect(freshPage.getByText("Stack", { exact: true })).toHaveCount(0);
  expect((await fresh.request.get(`${origin}/v1/session`)).status()).toBe(401);
  await fresh.close();
});

test("server Email syntax rejection remains an inline field error", async ({ page }) => {
  await page.goto("/register");
  const email = page.getByLabel("Email", { exact: true });
  await email.fill("learner@localhost");
  expect(await email.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(true);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.locator("#email-error")).toHaveText("Enter a valid email address.");
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toBeFocused();
  await page.getByLabel("Password", { exact: true }).fill("Another synthetic password");
  await expect(page.locator("#email-error")).toBeVisible();
  await email.fill("valid@example.com");
  await expect(page.locator("#email-error")).toHaveCount(0);
});

test("an existing cookie session redirects both authentication routes", async ({ page }) => {
  const response = await page.request.post(`${origin}/v1/session/login`, {
    headers: { Origin: origin },
    data: { email: "learner_test@example.com", password },
  });
  expect(response.status()).toBe(200);
  for (const mode of ["login", "register"] as const) {
    await page.goto(`/${mode}`);
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await expect(page).toHaveURL(`${origin}/`);
  }
});

test("remembered login skips session probes and a revoked cookie is rejected by the data API", async ({
  page,
}) => {
  await page.goto("/login");
  await login(page, "learner_test@example.com");
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  let probes = 0;
  page.on("request", (request) => {
    if (/\/v1\/session(?:\/refresh)?$/.test(request.url()) && request.method() !== "DELETE")
      probes++;
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) window.dispatchEvent(new Event("focus"));
  });
  expect(probes).toBe(0);
  // Retain the display hint while revoking the cookie to prove that hints grant no access.
  await page.request.delete(`${origin}/v1/session`, { headers: { Origin: origin } });
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => localStorage.getItem("studydy.session-hint"))).toBeNull();
});
