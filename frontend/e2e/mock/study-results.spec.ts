import { expect, test } from "@playwright/test";
import { studyLayoutFixture } from "../fixtures/study-layout.mjs";

for (const width of [1366, 390]) {
  test(`result hierarchy and complete answer review at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    const fixture = await studyLayoutFixture(page, "completed", { preparingHistory: true });
    await fixture.open();
    const summary = page.locator(".assessment-set-summary");
    await expect(summary).toHaveCount(1);
    await expect(summary).toContainText("Correct2 / 4 questions");
    await expect(summary).toContainText("Needs practice2 points");
    await expect(summary).toContainText("Completed4 / 4 questions");
    await expect(summary).not.toContainText(/Unanswered|Not assessed|Improved through follow-up/);
    const history = page.locator(".assessment-set-history");
    await expect(history.locator("summary")).toHaveText("Practice set history(2)");
    const cards = page.locator(".assessment-review-point");
    await expect(cards).toHaveCount(2);
    const first = (await cards.nth(0).boundingBox())!;
    const second = (await cards.nth(1).boundingBox())!;
    if (width >= 1280) {
      expect(first.y).toBeCloseTo(second.y, 0);
      expect(second.x).toBeGreaterThan(first.x + first.width);
    } else expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
    const review = page.locator(".assessment-answer-review");
    await expect(review.locator(".feedback-card").first()).not.toBeVisible();
    await review.locator("summary").click();
    await expect(review.locator(".feedback-card")).toHaveCount(4);
    for (const card of await review.locator(".feedback-card").all()) {
      await expect(card).toBeVisible();
      for (const label of ["Question", "Your answer", "Why?", "Source evidence"])
        await expect(card).toContainText(label);
    }
    await review
      .getByRole("button", { name: /PDF page 1/ })
      .first()
      .click();
    await expect(page.getByRole("dialog", { name: "Sources" })).toBeVisible();
    await page.keyboard.press("Escape");
    await review.locator("summary").click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

for (const [name, scenario, expected] of [
  ["all correct", { wrong: [] }, ["Correct4 / 4 questions", "Completed4 / 4 questions"]],
  ["unanswered", { wrong: [1], unanswered: 1 }, ["Unanswered1 points"]],
  ["unavailable", { wrong: [1], unavailable: 1 }, ["Not assessed1 points"]],
  [
    "remediation",
    { kind: "remediation", wrong: [3] },
    ["Follow-up passed3 / 4 questions", "Still needs practice1 points", "Follow-up completed4 / 4 questions"],
  ],
] as const) {
  test(`result metrics: ${name}`, async ({ page }) => {
    const fixture = await studyLayoutFixture(page, "completed", scenario);
    await fixture.open();
    const summary = page.locator(".assessment-set-summary");
    await expect(summary).toHaveCount(1);
    for (const text of expected) await expect(summary).toContainText(text);
    if (name === "all correct") {
      await expect(summary.locator("span")).toHaveCount(2);
      await expect(page.locator(".assessment-review-section")).toHaveCount(0);
    }
    if (name !== "unanswered") await expect(summary).not.toContainText("Unanswered");
    if (name !== "unavailable") await expect(summary).not.toContainText("Not assessed");
    await expect(summary).not.toContainText("Improved through follow-up");
  });
}

test("history excludes empty preparing sets and keeps published sets", async ({ page }) => {
  const fixture = await studyLayoutFixture(page, "preparing", {});
  await page.goto(fixture.historyPath);
  const history = page.locator(".assessment-set-history");
  await expect(history.locator("summary")).toHaveText("Practice set history(1)");
  await expect(history.getByRole("button")).toHaveCount(1);
  await expect(history).not.toContainText("0/0");
  await history.getByRole("button").click();
  await expect(page.locator(".assessment-cycle")).toBeVisible();
  fixture.setStage("ready");
  await page.goto(fixture.path);
  await expect(history.locator("summary")).toHaveText("Practice set history(2)");
  await expect(history).toContainText("Not answered");
  await expect(history).not.toContainText("Answered 0/4");
});
