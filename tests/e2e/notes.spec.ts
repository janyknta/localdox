import { test, expect, type Page } from "@playwright/test";

// The Notes panel end to end: copy a selection, find it again after a reload,
// and follow its source link back to the note — on another page of the
// document than the one on screen, so the jump has to resolve the page first.
//
// Notes and highlights are fenced blocks in the document's own Markdown
// (```note, ```yellownote …; see src/lib/markdown/annotations.ts), so what is
// asserted as stored is the file's content in IndexedDB.

const GUIDE = [
  "# Field guide",
  "",
  "Opening words of the guide.",
  "",
  "# Measurements",
  "",
  "Record the **wind speed** before you set up the mast.",
  "",
  "- Check the anemometer",
  "- Log it with `units=m/s`",
  "",
  "Closing paragraph of the measurements page.",
].join("\n");

const QUOTE_START = "Record the wind speed";

async function openGuide(page: Page) {
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
    .setInputFiles({ name: "guide.md", mimeType: "text/markdown", buffer: Buffer.from(GUIDE) });
  await expect(page.getByRole("heading", { name: "Field guide", level: 1 })).toBeVisible();
}

/** A document's Markdown as IndexedDB holds it right now. */
function storedContent(page: Page, name = "guide.md") {
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

/** How many ```note fences a document's stored Markdown holds. */
const storedNoteCount = async (page: Page, name?: string) =>
  ((await storedContent(page, name)) ?? "").match(/^`{3,}note$/gm)?.length ?? 0;

async function goToPage(page: Page, title: string) {
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: new RegExp(`^${title}`) }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
}

test("select, save a note, reload, open it, and return to its source", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  await goToPage(page, "Measurements");

  // Select from the start of the paragraph to the end of the list's code span.
  await page.locator("article").evaluate((article) => {
    const paragraph = [...article.querySelectorAll("p")].find((p) =>
      p.textContent?.startsWith("Record the"),
    )!;
    const code = [...article.querySelectorAll("li code")].find(
      (c) => c.textContent === "units=m/s",
    )!;
    const range = document.createRange();
    range.setStart(paragraph.firstChild!, 0);
    range.setEnd(code.firstChild!, code.textContent!.length);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Copy selection to notes" }).click();
  await expect(page.getByText("Copied to notes")).toBeVisible();

  // The note is written into the document, right after the list the
  // selection ended in, as clean Markdown in a ```note fence.
  const withNote = GUIDE.replace(
    "units=m/s`\n\n",
    "units=m/s`\n\n```note\nRecord the **wind speed** before you set up the mast.\n\n- Check the anemometer\n- Log it with `units=m/s`\n```\n\n",
  );
  await expect.poll(() => storedContent(page)).toBe(withNote);
  // It reads as a note card where it sits, not as a code block.
  const inDocument = page.locator("article").getByRole("note", { name: "Note", exact: true });
  await expect(inDocument).toHaveCount(1);
  await expect(inDocument.locator("strong")).toHaveText("wind speed");
  await expect(page.locator("article")).not.toContainText("```note");

  // A note is not a highlight: nothing is painted.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get("dc-hl-0")
            ?.size ?? 0,
      ),
    )
    .toBe(0);

  await page.getByRole("button", { name: "Notes", exact: true }).click();
  const panel = page.getByRole("region", { name: "Notes panel" });
  await expect(panel).toBeVisible();
  const card = panel.getByRole("listitem").filter({ hasText: QUOTE_START });
  await expect(card).toHaveCount(1);
  await expect(card).not.toContainText("guide.md");
  await expect(card).not.toContainText("just now");
  // Rendered from clean Markdown: emphasis, a real list, inline code.
  await expect(card.locator("strong")).toHaveText("wind speed");
  await expect(card.locator("li")).toHaveText(["Check the anemometer", "Log it with units=m/s"]);

  // And that Markdown is exactly what was stored.
  await card.getByRole("button", { name: "Edit note" }).click();
  // Mid-edit the text lives only in the field's value, so find it by role.
  await expect(panel.getByRole("textbox", { name: "Note text (Markdown)" })).toHaveValue(
    "Record the **wind speed** before you set up the mast.\n\n- Check the anemometer\n- Log it with `units=m/s`",
  );
  await panel.getByRole("button", { name: "Cancel" }).click();

  // Reload: the note (in the document) and the open panel both survive.
  await page.reload();
  // The route may restore the selected page. Open another page explicitly
  // before exercising the note card's navigation below.
  await goToPage(page, "Field guide");
  const reloadedPanel = page.getByRole("region", { name: "Notes panel" });
  await expect(reloadedPanel).toBeVisible();
  const reloadedCard = reloadedPanel.getByRole("listitem").filter({ hasText: QUOTE_START });
  await expect(reloadedCard).toHaveCount(1);

  // Search narrows the list, and finds the note by its source too.
  const search = reloadedPanel.getByRole("searchbox", { name: "Search notes" });
  await search.fill("no such words");
  await expect(reloadedPanel.getByText("No notes match")).toBeVisible();
  await search.fill("guide anemometer");
  await expect(reloadedCard).toHaveCount(1);
  await search.fill("");

  // Action icons operate on the note without jumping to its source.
  await reloadedCard.getByRole("button", { name: "Copy note", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Field guide", level: 1 })).toBeVisible();
  await reloadedCard.getByRole("button", { name: "Edit note", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Field guide", level: 1 })).toBeVisible();
  await reloadedPanel.getByRole("button", { name: "Cancel", exact: true }).click();

  // From another page of the document, clicking the content opens the note,
  // where it sits in the document after its passage.
  await reloadedCard.locator(".docs-note").click({ position: { x: 20, y: 12 } });
  await expect(page.getByRole("heading", { name: "Measurements", level: 1 })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        [
          ...((CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get(
            "dc-saved-flash",
          ) ?? []),
        ].map((r: Range) => r.toString().replace(/\s+/g, " ").trim()),
      ),
    )
    .toEqual([
      "Record the wind speed before you set up the mast. Check the anemometer Log it with units=m/s",
    ]);
  const noteInDocument = page.locator("article").getByRole("note", { name: "Note", exact: true });
  await expect(noteInDocument).toBeInViewport();
  expect(
    await page.evaluate(() => {
      const range = [
        ...((CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get(
          "dc-saved-flash",
        ) ?? []),
      ][0];
      return !!range?.startContainer.parentElement?.closest(".docs-annotation");
    }),
  ).toBe(true);

  // The card also has a keyboard-accessible source action, without a visible label.
  await goToPage(page, "Field guide");
  const jump = reloadedCard.getByRole("button", {
    name: "Go to this note in guide.md",
    exact: true,
  });
  await jump.focus();
  await jump.press("Enter");
  await expect(page.getByRole("heading", { name: "Measurements", level: 1 })).toBeVisible();

  // Deleting from the panel takes the fence out of the document; Undo puts
  // it back.
  await reloadedCard.getByRole("button", { name: "Delete note", exact: true }).click();
  await expect(page.getByText("Note deleted")).toBeVisible();
  await expect(reloadedCard).toHaveCount(0);
  await expect(noteInDocument).toHaveCount(0);
  await expect.poll(() => storedContent(page)).toBe(GUIDE);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(reloadedCard).toHaveCount(1);
  await expect(noteInDocument).toHaveCount(1);
  await expect.poll(() => storedContent(page)).toBe(withNote);

  expect(errors).toEqual([]);
});

test("on a narrow screen the panel is a sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGuide(page);
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Notes" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("No notes yet")).toBeVisible();
  // Not docked beside the document as well.
  await expect(page.getByRole("region", { name: "Notes panel" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

for (const width of [1440, 390]) {
  test(`notes and highlights move to rough work, persist, and can be undone at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openGuide(page);
    await goToPage(page, "Measurements");
    const select = async (prefix: string) => {
      await page.locator("article").evaluate((article, prefix) => {
        const paragraph = [...article.querySelectorAll("p")].find((p) =>
          p.textContent?.startsWith(prefix),
        )!;
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(range);
        paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      }, prefix);
    };
    // Scratchpads are on the workspace record; notes and highlights are
    // fences in guide.md's content.
    const stored = async () => {
      const [record, content] = await Promise.all([
        page.evaluate(
          () =>
            new Promise<{ scratchpads: Array<{ content: string; fileId: string | null }> }>(
              (resolve, reject) => {
                const open = indexedDB.open("localdox");
                open.onerror = () => reject(open.error);
                open.onsuccess = () => {
                  const db = open.result;
                  const all = db.transaction("workspaces").objectStore("workspaces").getAll();
                  all.onerror = () => reject(all.error);
                  all.onsuccess = () => {
                    db.close();
                    resolve(all.result[0]);
                  };
                };
              },
            ),
        ),
        storedContent(page),
      ]);
      return {
        scratchpads: record.scratchpads,
        notes: (content ?? "").match(/^`{3,}note$/gm)?.length ?? 0,
        highlights: (content ?? "").match(/^`{3,}yellownote$/gm)?.length ?? 0,
      };
    };
    const noteText = "Record the **wind speed** before you set up the mast.";
    await select("Record the");
    await page.getByRole("button", { name: "Copy selection to notes" }).click();
    await select("Closing paragraph");
    await page.getByRole("button", { name: "Highlight yellow", exact: true }).click();
    await expect.poll(async () => (await stored()).highlights).toBe(1);
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    const panel =
      width === 1440
        ? page.getByRole("region", { name: "Notes panel" })
        : page.getByRole("dialog", { name: "Notes", exact: true });
    const field = page.locator("textarea[id^='scratchpad-']");
    const notesTab = panel.getByRole("tab", { name: /^Notes/ });
    const roughTab = panel.getByRole("tab", { name: "Rough work", exact: true });

    // Moving uses its own pad and preserves work that was already there.
    await roughTab.click();
    await panel.getByRole("button", { name: "New scratchpad", exact: true }).click();
    await field.fill("Existing rough work");
    await notesTab.click();
    const noteCard = panel.getByRole("listitem").filter({ hasText: "Record the wind speed" });
    await noteCard.getByRole("button", { name: "Move to rough work", exact: true }).click();
    await expect(roughTab).toHaveAttribute("aria-selected", "true");
    await expect(field).toHaveValue(noteText);
    await expect
      .poll(async () => {
        const value = await stored();
        return { notes: value.notes, pads: value.scratchpads.map((pad) => pad.content) };
      })
      .toEqual({ notes: 0, pads: ["Existing rough work", noteText] });
    expect((await stored()).scratchpads.every((pad) => pad.fileId !== null)).toBe(true);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(noteCard).toBeVisible();
    await expect
      .poll(async () => (await stored()).scratchpads.map((pad) => pad.content))
      .toEqual(["Existing rough work"]);

    // Highlight cards have the same action. Undo preserves newly typed work,
    // including text not yet handed over by the debounced editor.
    const highlightCard = panel.getByRole("listitem").filter({ hasText: "Closing paragraph" });
    await highlightCard.getByRole("button", { name: "Move to rough work", exact: true }).click();
    await expect(field).toHaveValue("Closing paragraph of the measurements page.");
    await expect.poll(async () => (await stored()).highlights).toBe(0);
    await field.fill("Changed rough work");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(highlightCard).toBeVisible();
    await expect.poll(async () => (await stored()).highlights).toBe(1);
    await expect
      .poll(async () => (await stored()).scratchpads.map((pad) => pad.content))
      .toEqual(["Existing rough work", "Changed rough work"]);

    await noteCard.getByRole("button", { name: "Move to rough work", exact: true }).click();
    await expect(field).toHaveValue(noteText);
    await expect
      .poll(async () => {
        const value = await stored();
        return { notes: value.notes, pads: value.scratchpads.map((pad) => pad.content) };
      })
      .toEqual({ notes: 0, pads: ["Existing rough work", "Changed rough work", noteText] });
    await page.reload();
    await roughTab.click();
    await expect(field).toHaveValue(noteText);
    await notesTab.click();
    await expect(noteCard).toHaveCount(0);
    await expect(highlightCard).toBeVisible();
    await expect(highlightCard).not.toContainText("guide.md");
    if (width === 390) await page.keyboard.press("Escape");
    await goToPage(page, "Field guide");
    if (width === 390) await page.getByRole("button", { name: "Notes", exact: true }).click();
    await highlightCard.locator(".docs-note").click();
    await expect(page.getByRole("heading", { name: "Measurements", level: 1 })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          [
            ...((CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get(
              "dc-saved-flash",
            ) ?? []),
          ].map((range) => range.toString()),
        ),
      )
      .toEqual(["Closing paragraph of the measurements page."]);
    if (width === 390) await expect(panel).toBeHidden();
  });
}

test("all notes have card and file views, a complete preview, and matching Markdown downloads", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGuide(page);
  const selectParagraph = async (startsWith: string) => {
    await page.locator("article").evaluate((article, prefix) => {
      const paragraph = [...article.querySelectorAll("p")].find((p) =>
        p.textContent?.startsWith(prefix),
      )!;
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    }, startsWith);
  };
  await selectParagraph("Opening words");
  await page.getByRole("button", { name: "Copy selection to notes" }).click();
  await goToPage(page, "Measurements");
  await selectParagraph("Record the");
  await page.getByRole("button", { name: "Copy selection to notes" }).click();
  await selectParagraph("Closing paragraph");
  await page.getByRole("button", { name: "Highlight yellow", exact: true }).click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  const panel = page.getByRole("region", { name: "Notes panel" });
  await expect(
    panel.getByRole("list", { name: "Notes", exact: true }).locator(":scope > li"),
  ).toHaveCount(3);
  const firstParagraphs = panel
    .getByRole("list", { name: "Notes", exact: true })
    .locator(":scope > li .docs-note > p:first-child");
  // In document order: where each sits in the guide, not when it was made.
  await expect(firstParagraphs).toHaveText([
    "Opening words of the guide.",
    "Record the wind speed before you set up the mast.",
    "Closing paragraph of the measurements page.",
  ]);

  const opening = panel.getByRole("listitem").filter({ hasText: "Opening words" });
  await opening.getByRole("button", { name: "Edit note" }).click();
  const longNote = `**Edited opening**\n\n${"Long passage. ".repeat(400)}\n\nEnd of the entire note.`;
  await panel.getByRole("textbox", { name: "Note text (Markdown)" }).fill(longNote);
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(firstParagraphs).toHaveText([
    "Edited opening",
    "Record the wind speed before you set up the mast.",
    "Closing paragraph of the measurements page.",
  ]);
  // Saving rewrote the note's fence in the document.
  await expect.poll(() => storedContent(page)).toContain(`\`\`\`note\n${longNote}\n\`\`\``);
  await panel.getByRole("searchbox", { name: "Search notes" }).fill("wind");
  await expect(panel.getByRole("listitem")).toHaveCount(1);

  const downloadText = async (scope: ReturnType<Page["getByRole"]>, name: string) => {
    const pending = page.waitForEvent("download");
    await scope.getByRole("button", { name, exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe("notes.md");
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  };
  const fromCards = await downloadText(panel, "Download all notes as Markdown");
  expect(fromCards).toContain(longNote);
  expect(fromCards).toContain("Record the **wind speed**");
  expect(fromCards).toContain("Closing paragraph of the measurements page");
  // A highlight contributes the source text it marks.
  expect(fromCards).toBe(
    `${longNote}\n\nRecord the **wind speed** before you set up the mast.\n\nClosing paragraph of the measurements page.\n`,
  );

  await panel.getByRole("button", { name: "File", exact: true }).click();
  await expect(panel.getByRole("button", { name: "File", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const preview = panel.getByLabel("Combined notes content", { exact: true });
  await expect(preview).toContainText("End of the entire note.");
  await expect(preview.locator("strong").filter({ hasText: "wind speed" })).toHaveCount(1);
  await expect(panel.getByRole("button", { name: "Preview", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Markdown", exact: true })).toHaveCount(0);
  const copyContent = async (scope: ReturnType<Page["getByRole"]>) => {
    const copy = scope.getByRole("button", { name: "Copy content", exact: true });
    await expect(copy).toHaveText("");
    await copy.click();
    await expect(scope.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(fromCards);
  };
  await copyContent(panel);
  expect(await downloadText(panel, "Download all notes as Markdown")).toBe(fromCards);

  await panel.getByRole("button", { name: "Preview all notes", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "All notes", exact: true });
  await expect(dialog.getByLabel("Combined notes content", { exact: true })).toContainText(
    "End of the entire note.",
  );
  await copyContent(dialog);
  expect(await downloadText(dialog, "Download Markdown")).toBe(fromCards);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await panel.getByRole("button", { name: "Cards", exact: true }).click();
  await expect(panel.getByRole("searchbox", { name: "Search notes" })).toHaveValue("wind");

  // The same file and expanded preview work inside the mobile sheet.
  await page.setViewportSize({ width: 390, height: 844 });
  const sheet = page.getByRole("dialog", { name: "Notes", exact: true });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "File", exact: true }).click();
  await expect(sheet.getByLabel("Combined notes content", { exact: true })).toContainText(
    "End of the entire note.",
  );
  await copyContent(sheet);
  await sheet.getByRole("button", { name: "Preview all notes", exact: true }).click();
  await expect(dialog).toBeVisible();
  await copyContent(dialog);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(sheet).toBeVisible();
  expect(await downloadText(sheet, "Download all notes as Markdown")).toBe(fromCards);
});

const FIGURES = [
  "# Figures",
  "",
  "Energy obeys $E = mc^2$ here.",
  "",
  "```mermaid",
  "graph TD",
  "  A[Start] --> B[End]",
  "```",
  "",
  "After the diagram.",
].join("\n");

test("a note draws its equations and diagrams, from cache and again after a reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
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
    .setInputFiles({ name: "figures.md", mimeType: "text/markdown", buffer: Buffer.from(FIGURES) });
  // The document's own equation and diagram are drawn first.
  await expect(page.locator("article .docs-math-inline .katex")).toHaveCount(1);
  await expect(page.locator("article svg[id^='mermaid']")).toHaveCount(1);

  await page.locator("article").evaluate((article) => {
    const paragraphs = [...article.querySelectorAll("p")];
    const first = paragraphs.find((p) => p.textContent?.startsWith("Energy obeys"))!;
    const last = paragraphs.find((p) => p.textContent === "After the diagram.")!;
    const range = document.createRange();
    range.setStart(first.firstChild!, 0);
    range.setEnd(last.firstChild!, last.firstChild!.textContent!.length);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    first.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Copy selection to notes" }).click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  const panel = page.getByRole("region", { name: "Notes panel" });
  const card = panel.getByRole("listitem").first();

  // Stored as source: the LaTeX and a mermaid fence, never the SVG's text.
  await card.getByRole("button", { name: "Edit note" }).click();
  await expect(panel.getByRole("textbox", { name: "Note text (Markdown)" })).toHaveValue(
    "Energy obeys $E = mc^2$ here.\n\n```mermaid\ngraph TD\n  A[Start] --> B[End]\n```\n\nAfter the diagram.",
  );
  await panel.getByRole("button", { name: "Cancel" }).click();

  // Drawn in the panel: the equation (a cache hit — the document drew it) and
  // the diagram (the document's SVG, with ids of its own).
  await expect(card.locator(".docs-note-math .katex")).toHaveCount(1);
  await expect(card.locator(".docs-note-diagram svg")).toHaveCount(1);
  // Three drawings: the document's, the note card the document now holds,
  // and the panel's. The panel's has ids of its own. (The two in the document
  // are the same source, which the reader draws under one content-hashed id,
  // as it does for any repeated diagram.)
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll("svg[id^='mermaid']")].map((svg) => ({
      id: svg.id,
      inPanel: !!svg.closest("[aria-label='Notes panel']"),
    })),
  );
  expect(ids).toHaveLength(3);
  const panelIds = ids.filter((svg) => svg.inPanel).map((svg) => svg.id);
  expect(panelIds).toHaveLength(1);
  expect(ids.filter((svg) => !svg.inPanel).map((svg) => svg.id)).not.toContain(panelIds[0]);

  // After a reload every cache is cold: the note's equation is typeset in
  // idle time and its diagram drawn again.
  await expect.poll(() => storedNoteCount(page, "figures.md")).toBe(1);
  await page.reload();
  const reloaded = page.getByRole("region", { name: "Notes panel" }).getByRole("listitem").first();
  await expect(reloaded.locator(".docs-note-math .katex")).toHaveCount(1);
  await expect(reloaded.locator(".docs-note-diagram svg")).toHaveCount(1);
  await expect(reloaded.locator(".docs-note-math")).toContainText("E");
  expect(errors).toEqual([]);
});
