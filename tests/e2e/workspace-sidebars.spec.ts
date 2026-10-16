import { test, expect, type Page } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
});

async function uploadMaterials(page: Page) {
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(
      Array.from({ length: 40 }, (_, index) => ({
        name: `Sidebar ${String(index + 1).padStart(2, "0")}.md`,
        mimeType: "text/markdown",
        buffer: Buffer.from(
          `# Sidebar fixture ${index + 1}\n\n${"Reading content.\n\n".repeat(80)}`,
        ),
      })),
    );
  await expect(page.locator("aside [data-sidebar-file]")).toHaveCount(40);
}

async function expectFooterInViewport(page: Page) {
  await expect
    .poll(() =>
      page.locator("aside > div:last-child").evaluate((node) => {
        const { top, bottom } = node.getBoundingClientRect();
        return top >= 0 && bottom <= innerHeight + 1;
      }),
    )
    .toBe(true);
}

async function importNestedFolders(page: Page) {
  await page.goto("/settings/workspace");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.locator('input[type="file"]').setInputFiles({
    name: "nested-folders.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "localdox-workspace",
        version: 2,
        workspace: {
          id: "nested-folders",
          name: "Nested folders",
          createdAt: 1,
          updatedAt: 1,
          folders: [
            { id: "a", name: "A", createdAt: 1 },
            { id: "aa", name: "AA", parentId: "a", createdAt: 1 },
            { id: "ab", name: "AB", parentId: "a", createdAt: 1 },
            { id: "aaa", name: "AAA", parentId: "aa", createdAt: 1 },
          ],
          files: [
            { id: "ac", name: "AC.md", folderId: "a", content: "# AC" },
            { id: "aa-file", name: "AA file.md", folderId: "aa", content: "# AA file" },
            { id: "ab-file", name: "AB file.md", folderId: "ab", content: "# AB file" },
            { id: "deep-file", name: "Deep file.md", folderId: "aaa", content: "# Deep file" },
          ],
          bookmarks: [],
          ui: { activeFileId: "ac", expanded: {}, sidebarCollapsed: false, scrollTop: 0 },
        },
      }),
    ),
  });
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator('aside [data-sidebar-folder="a"]')).toBeVisible();
}

test("folders reveal one level at a time and remember individual expansion", async ({ page }) => {
  await importNestedFolders(page);
  const nav = page.locator("aside nav");
  const folder = (name: string) =>
    nav
      .locator("[data-sidebar-folder] > button")
      .filter({ has: page.getByText(name, { exact: true }) });
  const file = (name: string) => nav.getByRole("button", { name, exact: true });

  await expect(folder("A")).toHaveAttribute("aria-expanded", "false");
  await expect(folder("AA")).toHaveCount(0);
  await expect(file("AC")).toHaveCount(0);
  await folder("A").click();
  await expect(folder("AA")).toHaveAttribute("aria-expanded", "false");
  await expect(folder("AB")).toHaveAttribute("aria-expanded", "false");
  await expect(file("AC")).toBeVisible();
  await expect(folder("AAA")).toHaveCount(0);
  await expect(file("AA file")).toHaveCount(0);
  await expect(file("AB file")).toHaveCount(0);

  await folder("AA").click();
  await expect(folder("AAA")).toHaveAttribute("aria-expanded", "false");
  await expect(file("AA file")).toBeVisible();
  await expect(file("Deep file")).toHaveCount(0);
  await expect(file("AB file")).toHaveCount(0);
  await folder("AAA").click();
  await expect(file("Deep file")).toBeVisible();

  await folder("AA").click();
  await expect(file("AA file")).toHaveCount(0);
  await expect(file("Deep file")).toHaveCount(0);
  await expect(file("AC")).toBeVisible();
  await folder("AA").click();
  await expect(file("Deep file")).toBeVisible();
  await expect(folder("AB")).toHaveAttribute("aria-expanded", "false");
});

test("files and folders move to root from the empty explorer area and padding", async ({
  page,
}) => {
  await importNestedFolders(page);
  const nav = page.locator("aside nav");
  const root = nav.locator("[data-sidebar-root]");
  const folder = (id: string) => nav.locator(`[data-sidebar-folder="${id}"]`);
  const file = nav.locator('[data-sidebar-file="aa-file"]');
  await folder("a").locator(":scope > button").click();
  await folder("aa").locator(":scope > button").click();
  const bounds = await nav.boundingBox();
  if (!bounds) throw new Error("Explorer is not visible");
  const bottom = { x: bounds.width / 2, y: bounds.height - 20 };

  // Far below the tree: the old drop strip left this space inert.
  await file.dragTo(nav, { targetPosition: bottom });
  await expect(root.locator('[data-sidebar-file="aa-file"]')).toBeVisible();
  await expect(folder("aa").locator("..").locator('[data-sidebar-file="aa-file"]')).toHaveCount(0);
  // The explorer's left padding is also outside any folder destination.
  await folder("aa").dragTo(nav, { targetPosition: { x: 2, y: bounds.height - 20 } });
  await expect(nav.locator(':scope > div > [data-sidebar-folder="aa"]')).toBeVisible();
  await expect(folder("a").locator("..").locator('[data-sidebar-folder="aa"]')).toHaveCount(0);
  await expect(folder("aa").locator("..").locator('[data-sidebar-folder="aaa"]')).toBeVisible();

  // A nested target must still win over the root's bubbling drop handler.
  await file.dragTo(folder("ab"));
  await expect(root.locator('[data-sidebar-file="aa-file"]')).toHaveCount(0);
  await folder("ab").locator(":scope > button").click();
  await expect(folder("ab").locator("..").locator('[data-sidebar-file="aa-file"]')).toBeVisible();
  await folder("aa").dragTo(folder("a"));
  await expect(folder("a").locator("..").locator('[data-sidebar-folder="aa"]')).toBeVisible();
  await expect(nav.locator(':scope > div > [data-sidebar-folder="aa"]')).toHaveCount(0);

  await file.dragTo(nav, { targetPosition: bottom });
  await folder("aa").dragTo(nav, { targetPosition: bottom });
  await expect(root.locator('[data-sidebar-file="aa-file"]')).toBeVisible();
  await expect(nav.locator(':scope > div > [data-sidebar-folder="aa"]')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const request = indexedDB.open("localdox");
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const tx = db.transaction(["workspaces", "files"]);
              const workspace = tx.objectStore("workspaces").get("nested-folders");
              const file = tx.objectStore("files").get(["nested-folders", "aa-file"]);
              tx.oncomplete = () => {
                resolve({
                  parentId: workspace.result?.folders.find((f: { id: string }) => f.id === "aa")
                    ?.parentId,
                  folderId: file.result?.folderId,
                });
                db.close();
              };
              tx.onabort = () => reject(tx.error);
            };
          }),
      ),
    )
    .toEqual({ parentId: null, folderId: null });
  await page.reload();
  await expect(root.locator('[data-sidebar-file="aa-file"]')).toBeVisible();
  await expect(nav.locator(':scope > div > [data-sidebar-folder="aa"]')).toBeVisible();
});

test("document sidebar scrolls independently and only its visible controls receive focus", async ({
  page,
}) => {
  await page.goto("/");
  await uploadMaterials(page);
  // Also catches missing Tailwind utilities when a Git ignore rule hides docs.
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeHidden();
  await expectFooterInViewport(page);
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toHaveCount(0);
  const list = page.locator("aside nav");
  await list.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(page.locator("aside [data-sidebar-file]").last()).toBeInViewport();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await expectFooterInViewport(page);

  await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeFocused();
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Search docs", exact: true })).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Toggle sidebar", exact: true })).toBeFocused();
  await expect(page.getByRole("complementary")).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toHaveCount(0);
  await expectFooterInViewport(page);
});
