import { test, expect, type Page } from "@playwright/test";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { exportFile } from "./sidebar-menu";

async function load(page: Page, files: Record<string, string>) {
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({
        name: "Reader",
        namePrompted: true,
        aiEnabled: false,
        readingMode: "single",
      }),
    ),
  );
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(
      Object.entries(files).map(([name, text]) => ({
        name,
        mimeType: "text/markdown",
        buffer: Buffer.from(text),
      })),
    );
  await expect(page.locator("article").first()).toBeVisible();
}
async function open(page: Page, name: string) {
  await page.locator("aside").getByRole("button", { name, exact: true }).first().click();
}
async function edit(page: Page) {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Markdown source", exact: true })).toBeVisible();
}

test("wiki/Markdown links navigate to headings, backlinks show sources, and block embeds stay bounded", async ({
  page,
}) => {
  await load(page, {
    "Index.md":
      "# Index\n\n[[Concept#Details|meaning]] and [normal](Concept.md#Details).\n\n![[Concept#^proof]]\n",
    "Concept.md":
      "# Concept\n\n## Details\n\nA reusable proof. $E=mc^2$. ^proof\n\n## Unrelated\n\nDo not embed this section.\n",
  });
  await open(page, "Index");
  await expect(page.locator("article").first()).toContainText("A reusable proof.");
  await expect(page.locator("article").first()).not.toContainText("Do not embed this section.");
  await expect(page.locator("article .artifact-markdown .katex")).toBeVisible();
  await page.getByRole("link", { name: "meaning", exact: true }).click();
  await expect(page.locator("article h1").first()).toHaveText("Concept");
  await expect(page.locator("article h2").filter({ hasText: "Details" })).toBeInViewport();
  await page.getByRole("button", { name: /Connections/ }).click();
  await expect(page.getByRole("region", { name: "Note connections" })).toContainText("1 backlinks");
  await page
    .getByRole("region", { name: "Note connections" })
    .getByRole("button", { name: /Index/ })
    .click();
  await page.getByRole("link", { name: "normal", exact: true }).click();
  await expect(page.locator("article h1").first()).toHaveText("Concept");
});

test("export of a block transclusion includes only that block", async ({ page }) => {
  await load(page, {
    "Index.md": "# Index\n\n![[Concept#^proof]]",
    "Concept.md": "# Concept\n\nA reusable proof. ^proof\n\nPrivate other section.",
  });
  await open(page, "Index");
  const download = await exportFile(page, "Web page (.html)");
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  const html = await zip.file(/\.html$/)[0].async("string");
  expect(html).toContain("A reusable proof.");
  expect(html).not.toContain("Private other section.");
});

test("follow an unresolved wiki link to create a note in its requested folder", async ({
  page,
}) => {
  await load(page, { "Index.md": "# Index\n\n[[Course/New idea|Capture idea]]" });
  await page.getByRole("link", { name: "Capture idea" }).click();
  await expect(page.getByRole("textbox", { name: "Document name" })).toHaveValue("New idea.md");
  const editor = page.locator("#markdown-source");
  await editor.fill("# New idea\n\nCaptured without a name prompt.");
  await page.getByRole("button", { name: /Done.*Preview/ }).click();
  await expect(page.locator("article h1")).toHaveText("New idea");
  await page.reload();
  await expect(page.locator("article h1")).toHaveText("New idea");
});

test("completion suggests aliases and heading targets with balanced closing brackets", async ({
  page,
}) => {
  await load(page, {
    "Index.md": "# Index\n",
    "Concept.md": "---\naliases: [Insight]\n---\n# Concept\n\n## Details\n\nBody.",
  });
  await open(page, "Index");
  await edit(page);
  const editor = page.locator("#markdown-source");
  await editor.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await editor.press("Enter");
  await editor.pressSequentially("[[Ins");
  await expect(page.getByRole("option", { name: /Insight/ })).toBeVisible();
  await page.getByRole("option", { name: /Insight/ }).click();
  await expect(editor).toContainText("[[/Concept|Insight]]");
  await editor.press("Enter");
  await editor.pressSequentially("[[Concept#Det");
  await expect(page.getByRole("option", { name: /Details/ })).toBeVisible();
  await editor.press("Enter");
  await expect(editor).toContainText("[[Concept#Details]]");
});

test("renaming a note updates self/inbound links without dropping unsaved editor text", async ({
  page,
}) => {
  await load(page, {
    "Index.md": "# Index\n\n[[Index]]",
    "Other.md": "# Other\n\n[[Index|start]] [start](Index.md)",
  });
  await open(page, "Index");
  await edit(page);
  const editor = page.locator("#markdown-source");
  await editor.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await editor.pressSequentially(" unsaved tail");
  const name = page.getByRole("textbox", { name: "Document name" });
  await name.fill("Renamed.md");
  await name.press("Enter");
  await expect(editor).toContainText("[[/Renamed]] unsaved tail");
  await page.getByRole("button", { name: /Done.*Preview/ }).click();
  await open(page, "Other");
  await page.getByRole("link", { name: "start", exact: true }).first().click();
  await expect(page.locator("article").first()).toContainText("unsaved tail");
  await page.reload();
  await expect(page.locator("article").first()).toContainText("unsaved tail");
});

test("Live Preview renders inactive blocks and preserves source, undo, and autosave across mode switches", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const source =
    "# Live document\n\nA **strong** idea and *emphasis*, with $x^2$.\n\n| Name | Value |\n| --- | --- |\n| Answer | 42 |\n\n> [!TIP]\n> Think in your own words.\n\n```javascript\nconst answer = 42;\n```\n\n$$\nx^2 + y^2\n$$\n\n- First listed idea\n- Second listed idea\n\nLast paragraph.\n";
  await load(page, { "Live.md": source });
  await edit(page);
  const editor = page.locator("#markdown-source");
  await editor.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await page.getByRole("button", { name: "Live Preview", exact: true }).click();
  await expect(page.locator(".cm-live-preview")).toBeVisible();
  await expect(editor.getByRole("table")).toBeVisible();
  await expect(editor.getByRole("note")).toContainText("Think in your own words.");
  await expect(editor.getByRole("listitem").filter({ hasText: "First listed idea" })).toBeVisible();
  await expect(editor.locator(".katex").first()).toBeVisible();
  await expect(editor).toContainText("strong");
  await expect(editor).not.toContainText("**strong**");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(editor).toContainText("**strong**");
  await editor.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await editor.pressSequentially(" Added.");
  await page.getByRole("button", { name: "Live Preview", exact: true }).click();
  await editor.press("ControlOrMeta+z");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(editor).not.toContainText("Added.");
  await editor.press("ControlOrMeta+Shift+z");
  await expect(editor).toContainText("Added.");
  await page.getByRole("button", { name: "Live Preview", exact: true }).click();
  await page.screenshot({ path: "/private/tmp/localdox-live-preview.png", fullPage: true });
  await page.getByRole("button", { name: /Done.*Preview/ }).click();
  await expect(page.locator("article").first()).toContainText("Added.");
  await page.reload();
  await expect(page.locator("article").first()).toContainText("Added.");
  expect(errors).toEqual([]);
});

test("Live Preview block edit reveals source; mode and cancel work on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await load(page, {
    "Live.md": "# Live\n\n| Item | Count |\n| --- | --- |\n| First | 1 |\n\nEnd.",
  });
  await edit(page);
  const editor = page.locator("#markdown-source");
  await editor.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await page.getByRole("button", { name: "Live Preview", exact: true }).click();
  await editor.getByRole("button", { name: "Edit rendered Markdown block" }).click();
  await expect(editor).toContainText("| First | 1 |");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await editor.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await editor.pressSequentially(" Discard this.");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("article").first()).not.toContainText("Discard this.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("duplicate titles require a choice; folder rename and source move repair path links", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({
        name: "Reader",
        namePrompted: true,
        aiEnabled: false,
        readingMode: "single",
      }),
    ),
  );
  await page.goto("/settings/workspace");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.locator('input[type="file"]').setInputFiles({
    name: "links.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "localdox-workspace",
        version: 2,
        workspace: {
          id: "linked-fixture",
          name: "Linked notes",
          createdAt: 1,
          updatedAt: 1,
          folders: [
            { id: "a", name: "A", createdAt: 1 },
            { id: "b", name: "B", createdAt: 1 },
          ],
          files: [
            {
              id: "index",
              name: "Index.md",
              content: "# Index\n\n[[Concept]] and [path](A/Concept.md).",
            },
            { id: "one", name: "Concept.md", folderId: "a", content: "# First concept" },
            { id: "two", name: "Concept.md", folderId: "b", content: "# Second concept" },
          ],
          bookmarks: [],
          ui: { activeFileId: "index", expanded: {}, sidebarCollapsed: false, scrollTop: 0 },
        },
      }),
    ),
  });
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("link", { name: "Concept", exact: true }).click();
  const chooser = page.getByRole("group", { name: "Choose linked note" });
  await expect(chooser.getByRole("button", { name: "A/Concept.md", exact: true })).toBeVisible();
  await chooser.getByRole("button", { name: "B/Concept.md", exact: true }).click();
  await expect(page.locator("article h1").first()).toHaveText("Second concept");
  await open(page, "Index");
  const folder = (id: string) => page.locator(`aside [data-sidebar-folder="${id}"]`);
  await folder("a").getByRole("button", { name: "Folder options", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept("Physics"));
  await page.getByRole("button", { name: "Rename folder", exact: true }).click();
  await page.locator('aside [data-sidebar-file="index"]').dragTo(folder("b"));
  await edit(page);
  await expect(page.locator("#markdown-source")).toContainText("[path](../Physics/Concept.md)");
  await page.getByRole("button", { name: /Done.*Preview/ }).click();
  await page.getByRole("link", { name: "path", exact: true }).click();
  await expect(page.locator("article h1").first()).toHaveText("First concept");
});

test("Live Preview keeps a long document's mounted widgets bounded while typing", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const text =
    "# Long live note\n\n" +
    Array.from(
      { length: 1500 },
      (_, index) => `Paragraph ${index}: **bold** and $x_${index}$.\n\n`,
    ).join("");
  await load(page, { "Long.md": text });
  await edit(page);
  await page.getByRole("button", { name: "Live Preview", exact: true }).click();
  const editor = page.locator("#markdown-source");
  await expect(editor.locator(".cm-live-inline").first()).toBeVisible();
  expect(await editor.locator(".cm-live-inline").count()).toBeLessThan(100);
  await editor.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await editor.pressSequentially("Tail survives.");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(editor).toContainText("Tail survives.");
  expect(errors).toEqual([]);
});
