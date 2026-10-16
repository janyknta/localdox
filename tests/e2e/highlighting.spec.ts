import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const moduleScript = (path: string, name: string) => {
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return `{ const exports = {}; ${js}; window.${name} = exports; }`;
};

/**
 * A document's Markdown as IndexedDB holds it right now. Highlights live in
 * the file itself, as ```<colour>note fences, so this is where they persist.
 */
function storedContent(page: Page, name: string) {
  return page.evaluate(
    (fileName) =>
      new Promise<string | null>((resolve, reject) => {
        const open = indexedDB.open("localdox");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction("files").objectStore("files").getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            db.close();
            const rows = all.result as Array<{ name: string; content: string }>;
            resolve(rows.find((row) => row.name === fileName)?.content ?? null);
          };
        };
      }),
    name,
  );
}

async function openMarkdown(page: Page, name: string, source: string) {
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
    .setInputFiles({ name, mimeType: "text/markdown", buffer: Buffer.from(source) });
}

/** Select `phrase` inside the paragraph that starts with `prefix`, as a reader would. */
async function selectInParagraph(page: Page, prefix: string, phrase: string) {
  await page.locator("article").evaluate(
    (article, [start, needle]) => {
      const paragraph = [...article.querySelectorAll("p")].find((p) =>
        p.textContent?.startsWith(start),
      );
      if (!paragraph) throw new Error(`no paragraph starts with “${start}”`);
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      for (
        let node = walker.nextNode() as Text | null;
        node;
        node = walker.nextNode() as Text | null
      ) {
        const at = node.data.indexOf(needle);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + needle.length);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(range);
        paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return;
      }
      throw new Error(`“${needle}” not found in “${start}”`);
    },
    [prefix, phrase] as const,
  );
}

test("ranges survive synchronous edits, preserve Unicode offsets and resolve late repeated quotes", async ({
  page,
}) => {
  await page.setContent("<main></main>");
  await page.addScriptTag({ content: moduleScript("src/lib/markdown/text-offsets.ts", "offsets") });
  const result = await page.evaluate(() => {
    const api = (window as any).offsets;
    const root = document.createElement("div");
    document.body.append(root);
    root.innerHTML = "<p>İ alpha <strong>bravo</strong> charlie 😀 target</p>";
    const unicode = api.firstTextRange(root, "target")?.toString();
    const crossNode = api.queryRanges(root, "bravo charlie").map((r: Range) => r.toString());
    const emoji = api.queryRanges(root, "😀").map((r: Range) => r.toString());
    api.buildRange(root, 0, 3);
    root.textContent = "new content";
    const replaced = api.buildRange(root, 0, 3)?.toString();
    root.firstChild!.textContent = "updated";
    const edited = api.buildRange(root, 0, 7)?.toString();
    root.textContent = "same ".repeat(600);
    const repeated = api.findAnchor(root, "same", "", "", 550 * 5);
    root.textContent = "prefix  line\n break suffix";
    const whitespace = api.findAnchor(root, "line break");
    const compact = api.buildRange(root, whitespace.start, whitespace.end)?.toString();
    root.textContent = "a+b [x]";
    const literal = api.queryRanges(root, "a+b [x]").map((r: Range) => r.toString());
    const invalid = [api.buildRange(root, NaN, 2), api.buildRange(root, 0, 100)];
    api.releaseTextIndex(root);
    return { unicode, crossNode, emoji, replaced, edited, repeated, compact, literal, invalid };
  });
  expect(result).toEqual({
    unicode: "target",
    crossNode: ["bravo charlie"],
    emoji: ["😀"],
    replaced: "new",
    edited: "updated",
    repeated: { start: 2750, end: 2754 },
    compact: "line\n break",
    literal: ["a+b [x]"],
    invalid: [null, null],
  });
});

test("split panes share CSS colors without erasing each other's ranges", async ({ page }) => {
  await page.setContent("<main></main>");
  await page.addScriptTag({
    content: moduleScript("src/lib/markdown/highlight-registry.ts", "painting"),
  });
  const result = await page.evaluate(() => {
    const api = (window as any).painting;
    const root = document.createElement("div");
    root.textContent = "one two";
    document.body.append(root);
    const first = document.createRange();
    first.setStart(root.firstChild!, 0);
    first.setEnd(root.firstChild!, 3);
    const second = document.createRange();
    second.setStart(root.firstChild!, 4);
    second.setEnd(root.firstChild!, 7);
    const a = api.createHighlightPainter();
    const b = api.createHighlightPainter();
    a.paint({ "dc-hl-0": [first] });
    b.paint({ "dc-hl-0": [second] });
    const css = (CSS as any).highlights;
    const both = css.get("dc-hl-0").size;
    a.clear();
    const remaining = [...css.get("dc-hl-0")].map((r: any) => r.toString());
    b.clear();
    return { both, remaining, cleared: !css.has("dc-hl-0") };
  });
  expect(result).toEqual({ both: 2, remaining: ["two"], cleared: true });
});

test("application search preserves the article DOM and saved highlights repaint after async replacement", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
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
    .setInputFiles({
      name: "highlights.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# Highlight checks\n\nİ alpha **bravo** charlie target passage.\n\nSecond target paragraph.",
      ),
    });
  await expect(page.getByRole("heading", { name: "Highlight checks", exact: true })).toBeVisible();
  const paragraph = page.locator("article p").filter({ hasText: "İ alpha" }).first();
  // Create a saved passage through the real selection menu.
  await paragraph.evaluate((el) => {
    const node = el.lastChild!;
    const range = document.createRange();
    const at = node.textContent!.indexOf("target");
    range.setStart(node, at);
    range.setEnd(node, at + 6);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  // Measured before the dropdown opens: an open Radix menu hides the rest of
  // the page from the accessibility tree.
  const highlightLayer = await page
    .getByRole("button", { name: "Highlight yellow", exact: true })
    .evaluate((button) => Number(getComputedStyle(button.closest(".fixed")!).zIndex));
  await page.getByRole("button", { name: "More highlight actions" }).click();
  const actionsLayer = await page
    .getByRole("menu")
    .evaluate((menu) => Number(getComputedStyle(menu).zIndex));
  expect(actionsLayer).toBeGreaterThan(highlightLayer);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Highlight yellow", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (CSS as any).highlights.get("dc-hl-0")?.size ?? 0))
    .toBe(1);
  // The highlight is a fence in the document itself, right after its paragraph.
  const original =
    "# Highlight checks\n\nİ alpha **bravo** charlie target passage.\n\nSecond target paragraph.";
  const marked = (color: string) =>
    original.replace("passage.\n\n", `passage.\n\n\`\`\`${color}note\ntarget\n\`\`\`\n\n`);
  await expect.poll(() => storedContent(page, "highlights.md")).toBe(marked("yellow"));
  await paragraph.evaluate((el) => {
    el.innerHTML = "İ alpha <strong>bravo</strong> charlie target passage.";
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...((CSS as any).highlights.get("dc-hl-0") ?? [])].map((r: any) => r.toString()),
      ),
    )
    .toEqual(["target"]);
  const before = await page.locator("article *").count();
  await page
    .locator("button:visible")
    .filter({ has: page.locator("svg.lucide-search") })
    .first()
    .click();
  await page.getByPlaceholder("Search all documents...").fill("target");
  await page.locator("aside button[title]").filter({ hasText: "target" }).first().click();
  await expect
    .poll(() => page.evaluate(() => (CSS as any).highlights.get("dc-query")?.size ?? 0))
    .toBe(2);
  expect(await page.locator("article *").count()).toBe(before);
  expect(await page.locator("article mark").count()).toBe(0);
  // Click the painted passage, recolor it, then remove it through the menu.
  const clickHighlight = async (group: string) => {
    const point = await page.evaluate((name) => {
      const range = [...(CSS as any).highlights.get(name)][0] as Range;
      const rect = range.getClientRects()[0];
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, group);
    await page.mouse.click(point.x, point.y);
    await expect(page.getByRole("button", { name: "Remove highlight" })).toBeVisible();
  };
  await clickHighlight("dc-hl-0");
  await page.getByRole("button", { name: "Highlight green", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (CSS as any).highlights.get("dc-hl-1")?.size ?? 0))
    .toBe(1);
  // Recolouring rewrites the fence's info word, in place.
  await expect.poll(() => storedContent(page, "highlights.md")).toBe(marked("green"));
  await clickHighlight("dc-hl-1");
  await expect(page.getByRole("button", { name: "Highlight green", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Remove highlight" }).click();
  await expect
    .poll(() => page.evaluate(() => (CSS as any).highlights.get("dc-hl-1")?.size ?? 0))
    .toBe(0);
  // Removing it leaves the document exactly as it was before.
  await expect.poll(() => storedContent(page, "highlights.md")).toBe(original);
  expect(errors).toEqual([]);
});

test("math highlights keep the complete quote and survive reopening", async ({ page }) => {
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
    .setInputFiles({
      name: "math-highlights.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# Math highlights\n\nInline $a = b$ alone.\n\nBefore $E = mc^2$ after.\n\n$$\n\\frac{a+b}{c} = x^2\n$$\n",
      ),
    });
  await expect(page.locator("article .katex")).toHaveCount(3);
  const expected: string[] = [];
  for (const [selector, label] of [
    ["article .docs-math-inline", ""],
    ['article p[data-src]:has-text("Before")', "Passage"],
    ["article .docs-math-rendered", "Equation"],
  ]) {
    const quote = await page
      .locator(selector)
      .first()
      .evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        const quote = range.toString();
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return quote;
      });
    // A display equation is painted as one block, without its (aria-hidden)
    // number.
    expected.push(quote);
    if (label) {
      await page.getByPlaceholder("Add a label...").fill(label);
      await page.getByPlaceholder("Add a label...").press("Enter");
    } else {
      await page.getByRole("button", { name: "Highlight yellow", exact: true }).click();
    }
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...((CSS as any).highlights.get("dc-hl-0") ?? [])].map((r: Range) => r.toString()),
        ),
      )
      .toEqual(expected);
  }
  // Each one is a fence holding the passage's own source, LaTeX included.
  await expect
    .poll(() => storedContent(page, "math-highlights.md"))
    .toMatch(/```yellownote Equation\n/);
  const content = await storedContent(page, "math-highlights.md");
  expect(content).toContain("```yellownote\n$a = b$\n```");
  expect(content).toContain("```yellownote Passage\nBefore $E = mc^2$ after.\n```");
  expect(content).toMatch(/```yellownote Equation\n[^`]*\\frac\{a\+b\}\{c\} = x\^2[^`]*\n```/);
  await page.reload();
  await expect(page.locator("article .katex")).toHaveCount(3);
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...((CSS as any).highlights.get("dc-hl-0") ?? [])].map((r: Range) => r.toString()),
      ),
    )
    .toEqual(expected);
});

test("a highlight is a fence after its paragraph: painted, kept across reloads and edits, never lost", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const source = [
    "# Field notes",
    "",
    "The tide comes in twice a day.",
    "",
    "At the pier the water turns slowly at noon.",
    "",
    "Closing line.",
  ].join("\n");
  await openMarkdown(page, "field.md", source);
  await expect(page.getByRole("heading", { name: "Field notes", level: 1 })).toBeVisible();

  await selectInParagraph(page, "At the pier", "turns slowly");
  await page.getByRole("button", { name: "Highlight yellow", exact: true }).click();
  const highlighted = source.replace(
    "at noon.\n\n",
    "at noon.\n\n```yellownote\nturns slowly\n```\n\n",
  );
  await expect.poll(() => storedContent(page, "field.md")).toBe(highlighted);
  // Painted on its passage; the fence itself is not shown.
  const paintedIn = () =>
    page.evaluate(() =>
      [...((CSS as any).highlights.get("dc-hl-0") ?? [])].map((r: Range) => ({
        text: r.toString(),
        paragraph: r.startContainer.parentElement?.closest("p")?.textContent,
      })),
    );
  const onPier = [
    { text: "turns slowly", paragraph: "At the pier the water turns slowly at noon." },
  ];
  await expect.poll(paintedIn).toEqual(onPier);
  await expect(page.locator("article")).not.toContainText("yellownote");
  await expect(page.getByRole("note")).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Field notes", level: 1 })).toBeVisible();
  await expect.poll(paintedIn).toEqual(onPier);

  // Text added above moves the fence with its passage: nothing to re-anchor.
  const edit = async (next: string) => {
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.locator("#markdown-source").fill(next);
    await page.getByRole("button", { name: /Done/ }).click();
    await expect(page.getByRole("heading", { name: "Field notes", level: 1 })).toBeVisible();
    await expect.poll(() => storedContent(page, "field.md")).toBe(next);
  };
  await edit(
    highlighted.replace("# Field notes\n\n", "# Field notes\n\nA new opening paragraph.\n\n"),
  );
  await expect(page.getByText("A new opening paragraph.")).toBeVisible();
  await expect.poll(paintedIn).toEqual(onPier);

  // Edit the passage away: the highlight shows as a card where it was.
  await edit(highlighted.replace("the water turns slowly at noon", "the water drifts at noon"));
  const orphan = page.getByRole("note", { name: "Highlight · passage not found" });
  await expect(orphan).toBeVisible();
  await expect(orphan).toContainText("turns slowly");
  await expect.poll(paintedIn).toEqual([]);
  expect(errors).toEqual([]);
});

test("PDF search paints exact matches and changes the active occurrence within one span", async ({
  page,
  context,
}) => {
  const source = await context.newPage();
  await source.setContent('<p style="font:20px Arial">alpha target middle target omega</p>');
  const buffer = await source.pdf();
  await source.close();
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
  await page.goto("/");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({ name: "highlights.pdf", mimeType: "application/pdf", buffer });
  await page.getByRole("button", { name: "Search in document", exact: true }).click();
  await page.getByRole("textbox", { name: "Search in document", exact: true }).fill("target");
  const read = () =>
    page.evaluate(() => ({
      active: [...((CSS as any).highlights.get("pdf-search-hit-active") ?? [])].map((r: any) => ({
        text: r.toString(),
        start: r.startOffset,
      })),
      other: [...((CSS as any).highlights.get("pdf-search-hit") ?? [])].map((r: any) =>
        r.toString(),
      ),
    }));
  await expect.poll(async () => (await read()).active.map((r) => r.text)).toEqual(["target"]);
  const first = await read();
  expect(first.other).toEqual(["target"]);
  await page.getByRole("button", { name: "Next match", exact: true }).click();
  await expect.poll(async () => (await read()).active[0]?.start).not.toBe(first.active[0].start);
  expect((await read()).active[0].text).toBe("target");
  await page.getByRole("button", { name: "Close search", exact: true }).click();
  await expect.poll(async () => (await read()).active.length).toBe(0);
});

test("the selection menu opens beside the selection, never over it", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.addInitScript(() =>
    localStorage.setItem(
      "localdox:prefs",
      JSON.stringify({ name: "Reader", namePrompted: true, aiEnabled: false }),
    ),
  );
  await page.goto("/");
  const paragraphs = Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1} body text.`);
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "placement.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(`# Placement\n\n${paragraphs.join("\n\n")}`),
    });
  await expect(page.getByRole("heading", { name: "Placement", exact: true })).toBeVisible();
  // Selects a paragraph's text, then returns the selection's and the menu's boxes.
  const open = (text: string, block: ScrollLogicalPosition) =>
    page
      .locator("article p")
      .filter({ hasText: text })
      .first()
      .evaluate(async (el, at) => {
        el.scrollIntoView({ block: at, behavior: "instant" });
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const range = document.createRange();
        range.selectNodeContents(el);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(range);
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        const menu = await new Promise<Element>((resolve) => {
          const find = () => {
            const button = document.querySelector('[aria-label="More highlight actions"]');
            if (button) resolve(button.closest(".fixed")!);
            else requestAnimationFrame(find);
          };
          find();
        });
        const s = range.getBoundingClientRect();
        const m = menu.getBoundingClientRect();
        return { selTop: s.top, selBottom: s.bottom, menuTop: m.top, menuBottom: m.bottom };
      }, block);

  // Room below: the menu sits under the selection.
  const middle = await open("Paragraph 10 body", "center");
  expect(middle.menuTop).toBeGreaterThanOrEqual(middle.selBottom);
  await page.keyboard.press("Escape");

  // The last line of the window: no room below, so the menu flips above.
  const bottom = await open("Paragraph 30 body", "end");
  expect(bottom.menuBottom).toBeLessThanOrEqual(bottom.selTop);
  expect(bottom.menuBottom).toBeLessThanOrEqual(600);
});
