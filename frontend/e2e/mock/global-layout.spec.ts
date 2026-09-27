import { expect, test } from "@playwright/test";

const id = "11111111-1111-4111-8111-111111111111";
const identity = { schema: "learner-identity/v1", learner_id: id };
const responses: Record<string, unknown> = {
  "/v1/session/refresh": identity,
  "/v1/session": identity,
  "/v1/source-capabilities": {
    schema: "source-capabilities/v1",
    formats: [{ extension: ".pdf", media_type: "application/pdf", max_bytes: 104857600 }],
    quality_notice: "PDF",
  },
  "/v1/materials": { schema: "material-library/v1", materials: [] },
};

test.beforeEach(async ({ page }) => {
  await page.route(/\/v[12]\//, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!responses[path]) throw new Error(`Unexpected layout request: ${request.method()} ${path}`);
    expect(request.method()).toBe(path === "/v1/session/refresh" ? "POST" : "GET");
    return route.fulfill({ json: responses[path] });
  });
});

// 2560px reaches the 1600px maximum; 768px and 900px share the standard layout branch.
for (const width of [2560, 1536, 1366, 1024, 900, 390, 320]) {
  test(`standard frames stay centered without clipping at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1080 });
    for (const [path, heading] of [
      ["/", "Welcome back!"],
      ["/materials", "My materials"],
      ["/upload", "Upload materials"],
    ]) {
      await page.goto(path);
      const frame = page.locator(".app-main > section");
      await expect(
        frame.getByRole("heading", { name: heading, level: 1, exact: true }),
      ).toBeVisible();
      if (path === "/") {
        await expect(page.getByRole("region", { name: "Learning overview" })).toBeVisible();
        await expect(page.locator(".dashboard-stats")).toHaveAttribute("aria-busy", "false");
      }
      if (path === "/upload")
        await expect(page.getByLabel("Choose material files", { exact: true })).toBeEnabled();
      const layout = await frame.evaluate((element) => {
        const main = element.parentElement!;
        const bounds = main.getBoundingClientRect();
        const css = getComputedStyle(main);
        const box = element.getBoundingClientRect();
        return {
          centerOffset: box.x + box.width / 2 - (bounds.x + bounds.width / 2),
          width: box.width,
          usableWidth: bounds.width - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight),
          top: box.y,
          headingTop: element.querySelector("h1")!.getBoundingClientRect().y,
          documentWidth: document.documentElement.scrollWidth,
          clipped: Array.from(element.querySelectorAll("h1, h2, p, button, strong"))
            .filter((e) => e.scrollWidth > e.clientWidth + 1)
            .map((e) => e.textContent),
        };
      });
      expect(Math.abs(layout.centerOffset)).toBeLessThanOrEqual(2);
      expect(layout.width).toBeCloseTo(Math.min(layout.usableWidth, 1600), 0);
      if (path === "/upload")
        expect((await page.locator(".file-drop").boundingBox())!.width).toBeLessThanOrEqual(880);
      expect(layout.headingTop).toBeCloseTo(layout.top, 0);
      expect(layout.documentWidth).toBe(width);
      expect(layout.clipped).toEqual([]);
    }
  });
}

test("full-page failure uses the reading frame and keyboard retry without writes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  let reads = 0;
  await page.route("**/v1/materials", (route) => {
    expect(route.request().method()).toBe("GET");
    reads++;
    return route.fulfill({
      status: 503,
      json: {
        schema: "api-error/v1",
        request_id: id,
        reason_code: "STORAGE_UNAVAILABLE",
        retryable: true,
        message: "Request could not be completed.",
      },
    });
  });
  await page.goto("/materials");
  const state = page.locator(".state-view--page");
  await expect(state.getByRole("heading", { level: 1 })).toHaveText("Unable to load materials");
  await expect(state).toContainText("Storage is temporarily unavailable");
  expect(reads).toBe(1);
  expect((await state.boundingBox())!.width).toBeLessThanOrEqual(880);
  await state.getByRole("button", { name: "Refresh" }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => reads).toBe(2);
  await expect(state.getByRole("heading", { level: 1 })).toHaveText("Unable to load materials");
  await expect(state).toContainText("Storage is temporarily unavailable");
});
