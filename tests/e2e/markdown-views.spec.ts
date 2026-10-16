import { test, expect } from "@playwright/test";

const source =
  "# First chapter\n\nFirst introduction.\n\n## Basics\n\nBasic content.\n\n### Example\n\nExample content.\n\n```md\n## Not a heading\n```\n\n# Second chapter\n\nSecond introduction.\n\n## Details\n\nDetailed content.\n";

for (const readingMode of ["paginated", "single"] as const) {
  test(`Markdown view modes navigate and wrap every section in ${readingMode} preview`, async ({
    page,
  }) => {
    await page.addInitScript(
      (mode) =>
        localStorage.setItem(
          "localdox:prefs",
          JSON.stringify({
            name: "Reader",
            namePrompted: true,
            aiEnabled: false,
            readingMode: mode,
          }),
        ),
      readingMode,
    );
    await page.goto("/");
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: "views.md", mimeType: "text/markdown", buffer: Buffer.from(source) });
    const modes = page.getByRole("group", { name: "Markdown view", exact: true });
    await expect(modes.getByRole("button", { name: "Preview", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByText("First introduction.", { exact: true })).toBeVisible();

    await modes.getByRole("button", { name: "Tree view", exact: true }).click();
    const outline = page.getByRole("navigation", { name: "Markdown outline" });
    await expect(outline).toBeVisible();
    await expect(page.locator("article")).toBeHidden();
    await expect(outline.getByRole("button")).toHaveCount(5);
    const root = await outline.locator(".md-outline-root").boundingBox();
    const first = await outline
      .getByRole("button", { name: "H1 First chapter", exact: true })
      .boundingBox();
    const second = await outline
      .getByRole("button", { name: "H1 Second chapter", exact: true })
      .boundingBox();
    const basics = await outline
      .getByRole("button", { name: "H2 Basics", exact: true })
      .boundingBox();
    const example = await outline
      .getByRole("button", { name: "H3 Example", exact: true })
      .boundingBox();
    expect(first!.y).toBeGreaterThan(root!.y + root!.height);
    expect(second!.y).toBe(first!.y);
    expect(first!.x + first!.width).toBeLessThan(second!.x);
    expect(root!.x + root!.width / 2).toBeGreaterThan(first!.x + first!.width / 2);
    expect(root!.x + root!.width / 2).toBeLessThan(second!.x + second!.width / 2);
    expect(basics!.y).toBeGreaterThan(first!.y + first!.height);
    expect(example!.y).toBeGreaterThan(basics!.y + basics!.height);
    await page.screenshot({ path: test.info().outputPath("downward-tree.png") });
    await expect(outline.getByText("Not a heading", { exact: true })).toHaveCount(0);
    await expect(
      outline
        .locator("li")
        .filter({ has: page.getByRole("button", { name: "H2 Basics", exact: true }) })
        .first()
        .getByRole("button", { name: "H3 Example", exact: true }),
    ).toBeVisible();
    await outline.getByRole("button", { name: "H2 Details", exact: true }).click();
    await expect(modes.getByRole("button", { name: "Preview", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("#details")).toBeInViewport();
    await expect(page.getByText("Detailed content.", { exact: true })).toBeVisible();

    await modes.getByRole("button", { name: "Wrap all sections", exact: true }).click();
    await expect(page.locator("article h1#first-chapter")).toBeVisible();
    await expect(page.locator("article h1#second-chapter")).toBeVisible();
    await expect(page.getByText("First introduction.", { exact: true })).toBeHidden();
    await expect(page.getByText("Detailed content.", { exact: true })).toBeHidden();
    await page.locator("#first-chapter").getByRole("button", { name: "Expand section" }).click();
    await expect(page.getByText("First introduction.", { exact: true })).toBeVisible();
    await expect(page.locator("#basics")).toBeVisible();
    await expect(page.getByText("Basic content.", { exact: true })).toBeHidden();
    await page.locator("#basics").getByRole("button", { name: "Expand section" }).click();
    await expect(page.getByText("Basic content.", { exact: true })).toBeVisible();
    await expect(page.getByText("Example content.", { exact: true })).toBeHidden();

    await modes.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.getByText("Detailed content.", { exact: true })).toBeVisible();
    await modes.getByRole("button", { name: "Tree view", exact: true }).click();
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "plain.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("Plain document without headings."),
      });
    await page.locator("aside").getByRole("button", { name: "plain", exact: true }).click();
    await expect(modes.getByRole("button", { name: "Preview", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await modes.getByRole("button", { name: "Tree view", exact: true }).click();
    await expect(outline).toContainText("This document has no headings.");
  });
}

test("the three modes and wrapped section controls fit a phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "phone.md", mimeType: "text/markdown", buffer: Buffer.from(source) });
  const modes = page.getByRole("group", { name: "Markdown view", exact: true });
  await modes.getByRole("button", { name: "Wrap all sections", exact: true }).click();
  await page.locator("#first-chapter").getByRole("button", { name: "Expand section" }).click();
  await expect(page.getByText("First introduction.", { exact: true })).toBeVisible();
  const bounds = await modes.evaluate((el) => ({
    left: el.getBoundingClientRect().left,
    right: el.getBoundingClientRect().right,
  }));
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(320);
  await page.screenshot({ path: test.info().outputPath("wrapped-phone.png") });
  await modes.getByRole("button", { name: "Tree view", exact: true }).click();
  const diagram = page.getByRole("region", { name: "Markdown tree diagram", exact: true });
  const layout = await diagram.evaluate((el) => {
    const root = el.querySelector(".md-outline-root")!.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return {
      rootCenter: root.left + root.width / 2,
      diagramCenter: box.left + box.width / 2,
      scrollable: el.scrollWidth > el.clientWidth,
      pageFits: document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
  expect(Math.abs(layout.rootCenter - layout.diagramCenter)).toBeLessThanOrEqual(1);
  expect(layout.scrollable).toBe(true);
  expect(layout.pageFits).toBe(true);
  await page.screenshot({ path: test.info().outputPath("downward-tree-phone.png") });
  await page
    .getByRole("navigation", { name: "Markdown outline" })
    .getByRole("button", { name: "H2 Details", exact: true })
    .click();
  await expect(page.getByText("Detailed content.", { exact: true })).toBeVisible();
});
