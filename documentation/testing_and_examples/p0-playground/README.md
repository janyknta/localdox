# Connected Notes + Live Preview Playground

This is a hands-on workspace for P0 1 (connected notes) and P0 3 (Live Preview). Work through the exercises in order: the last ones rename and move the sample notes.

## Import and start

1. In LocalDox, open **Settings → Workspace**.
2. Under **Transfer → Import workspace**, click **Choose file** and select `p0-feature-playground.json`.
3. Click **Done**. The workspace is named **P0 Feature Playground**; open **00 Start Here** if it is not already selected.
4. For the easiest walkthrough, set **Settings → Reading → Single page**, then click **Done**. The playground does not change your reading preference itself.

Use the sidebar to return to **00 Start Here** between exercises. Click a folder to reveal its notes. In these instructions, **Edit** means the document's Edit button; **Done · Preview** returns to reading.

## Launchpad: click these links

| Try | Link | Expected result |
| --- | --- | --- |
| Unique note name | [[Energy]] | Opens Energy in Concepts |
| Explicit root path | [[/Concepts/Energy|Energy via a path]] | Opens the same note |
| Display label | [[Energy|Read about conserved energy]] | The label changes; the target does not |
| Frontmatter alias | [[Conservation]] | Opens Energy, whose aliases include Conservation |
| Heading text | [[Energy#Worked example|Jump to the worked example]] | Opens the worked-example heading |
| Nested heading | [[Energy#Calculation|Jump to the calculation]] | Opens the nested heading |
| Deduplicated slug | [[Energy#worked-example-1|Jump to the second worked example]] | Opens the later heading with the same title |
| Block identifier | [[Energy#^energy-proof|Jump to one explanation block]] | Opens the marked explanation paragraph |
| Ordinary Markdown | [Energy with a Markdown link](Concepts/Energy.md#Worked%20example) | Opens the same example |
| Reference-style Markdown | [Energy through a shared definition][energy-example] | Opens the same example |
| Duplicate title | [[Overview|Choose an Overview note]] | Shows Mechanics/Overview.md and Optics/Overview.md |
| Explicit duplicate path | [[Mechanics/Overview|Mechanics overview]] | Opens Mechanics, with no chooser |
| Missing note | [[Review/Newton Practice|Create Newton Practice]] | Creates a note and the Review folder, then opens editing |

[energy-example]: Concepts/Energy.md#Worked%20example "Energy example"

## 1. Navigation, labels and aliases

Click the first four launchpad links. Each should reach Energy despite its different label or spelling. Open Energy in **Source** to inspect this frontmatter:

```yaml
---
aliases: [Conservation, "Energy principle"]
---
```

Try adding `"Stored energy"` to the aliases list. Click **Done · Preview**, return here, enter Edit, and add `[[Stored energy]]` on a new line. Finish editing and follow the new link: it should open Energy.

## 2. Heading and block navigation

Try the four heading/block links in the launchpad. The two **Worked example** headings are intentionally repeated; `worked-example-1` selects the second one.

In Energy, the paragraph ending with `^energy-proof` is a reusable block. The marker lives in Markdown source. The link should take you to that paragraph.

Also try **Missing target demo** on the [[Embeds]] page. Its link points to an existing note but an absent heading; expect a message that the heading cannot be found, rather than a newly created note.

## 3. Whole-note, heading and block embeds

Open [[Embeds]]. It contains these actual embed forms:

```md
![[Momentum]]
![[Energy#Worked example]]
![[Energy#^energy-proof]]
```

Check the differences:

- The Momentum embed includes its whole note.
- The heading embed includes the first worked example and its Calculation subsection; it ends before Limitations.
- The block embed includes just the explanation paragraph and its inline equation. It excludes the following sentence about oranges.
- The local SVG image renders without fetching an external image.

If you edit the source note and save, return to Embeds to see the updated content. **Circular A** and **Circular B** deliberately embed each other; opening [[Circular A]] should stop the recursion with an explanatory message.

## 4. Backlinks and outgoing links

Open Energy, scroll to its bottom, and expand **Connections**. You should see source notes such as **00 Start Here**, **Embeds**, **Live Preview Lab**, **Move Lab**, and **Momentum**. Click a source to open it.

Return to this page and expand its Connections footer. Inspect outgoing links and the missing **Review/Newton Practice** target before creating it. Repeated links can appear as multiple outgoing entries; backlinks group occurrences by source note. Connection counts update after autosave, not after every keypress.

## 5. Duplicate titles

Follow **Choose an Overview note** in the launchpad. Choose **Optics/Overview.md** and check that its heading says **Optics overview**. Repeat and choose **Mechanics/Overview.md**.

Press Escape while the chooser is open to close it, or click outside it. The explicit Mechanics path opens directly.

## 6. Create a missing note

Follow **Create Newton Practice**. A blank `Newton Practice.md` should open in editing, inside the new Review folder. Paste:

```md
# Newton Practice

## Question

A 2 kg object accelerates at 3 m/s². Find the net force.

## Answer

$F = ma = 6\,\mathrm{N}$.

Related concept: [[Momentum]]
```

Choose **Done · Preview**, return here, and follow the same link again. It should now open the saved note directly. Reload the app and confirm the new note is still present.

## 7. Completion: files, aliases, headings and blocks

Open [[Completion Lab]], enter Edit, and select **Source**. At the end of the document, try these one at a time:

| Type | Choose | Expected inserted result |
| --- | --- | --- |
| `[[Ene` | Energy, with Concepts/Energy.md in its detail | A path-qualified link ending in `]]` |
| `[[Conser` | Conservation | A path-qualified Energy link with Conservation as its display label |
| `[[Energy#Work` | Worked example | A link to the heading |
| `[[Energy#Calc` | Calculation | A link to the nested heading |
| `[[Energy#^energy` | ^energy-proof | A link to the block |
| `![[Momen` | Momentum | A whole-note embed |

Click a suggestion or select it with arrow keys and Enter. Confirm you get one closing `]]`. Finish editing to follow the links or see the embed. Repeat a completion in **Live Preview**: the current line should stay editable.

Type `[[Not created yet]]` and finish editing. Writing a missing link alone does not create the note; following it does.

## 8. Live Preview: formatted text and active source

Open [[Live Preview Lab]], enter Edit, and select **Live Preview**. Click the final **Typing area** paragraph to place the cursor away from the earlier examples.

Inspect the heading, bold/italic/struck text, inline code, links, math, table, callout, list, code fence, quote, divider, note embed, and local image. Scroll within the editor to see everything.

Click inside a formatted text line: the Markdown syntax should become editable for that line/block. Move the cursor to another paragraph: the previous text should render again.

Hover the rendered table and click **Edit** (keyboard users can Tab to **Edit rendered Markdown block**). Edit `42` to `43`, then move the cursor to another paragraph. The rendered table should show `43`. Rendered block backgrounds also support double-click to expose source. On touch devices, Edit controls remain visible.

## 9. Source, selection and undo/redo

In Live Preview Lab:

1. Switch to **Source** and select a word in the Typing area. Switch to **Live Preview**, then back to Source; the same selection should remain.
2. At the end of the document, type ` HISTORY CHECK`.
3. Switch to Live Preview and press **Cmd+Z** on Mac or **Ctrl+Z** elsewhere. Switch back to Source: the text should disappear.
4. Press **Cmd+Shift+Z** on Mac, or **Ctrl+Shift+Z** elsewhere, to redo. The text should return.
5. Choose **Done · Preview** and reload: the text should still be saved.
6. Enter Edit, append ` DISCARD ME`, and choose **Cancel**. The discarded text should be gone; HISTORY CHECK should remain.

Edits autosave after a short pause. Cancel restores the text present when this editing session opened. The selected editing mode is remembered when you next enter the editor. Source keeps line numbers, highlighting and fold controls.

## 10. Rename a linked file safely

Do this after the earlier exercises. Open Energy, enter Edit, and change its **Document name** to `Energy renamed.md`. Press Enter, then **Done · Preview**.

Return to this page. The path links, heading links, reference-style link, block link, and embeds should still work. Open this page in Source to inspect the repaired destinations; standard Markdown paths encode spaces as `%20`. Links by the stable alias Conservation can remain unchanged because the alias still resolves.

Only the file name changes automatically; the note's `# Energy` heading remains the author's text. The example `[[Energy]]` inside a code fence in Completion Lab should remain literal and unchanged.

## 11. Rename a folder, then move a source note

Use **Concepts → Folder options → Rename folder** and rename it **Physics**. The links and embeds should continue opening their original targets.

Open **Move Lab** in the Lab folder. It has an ordinary relative Markdown link to Energy. Use its **Options → Move to folder → Top level**, or drag its sidebar row onto empty sidebar space, to move it out of Lab. Open it in Source: its outgoing Markdown destination should be repaired relative to its new location. Its links should still open the same Energy note.

## 12. Unsaved text during rename, and Cancel

Open [[Self Check]], enter Edit, append ` UNSAVED TAIL`, and immediately rename the document to `Self Check renamed.md` using Document name.

The self-link should update and UNSAVED TAIL should survive the rename. Choose **Done · Preview** to keep both. For a separate Cancel test, enter Edit again, append ` CANCEL THIS`, rename the file once more, and choose **Cancel**. The rename and repaired self-link should remain; only CANCEL THIS should disappear.

## 13. Export a bounded embed

Open Embeds and use **Options → Export → Web page (.html)**. Local media produces a ZIP; extract it and open its HTML file.

The rendered heading and block embeds should have the same content boundaries as the app. The block's rendered text must exclude the oranges sentence. The exported ZIP can also contain original referenced source files as assets; the boundary check here concerns the rendered HTML.

## 14. Mobile and split view

On a narrow window or phone, open Live Preview Lab and repeat table editing, Source switching, and Cancel. The page should fit the viewport; wide content should scroll inside its own container/editor.

To try connected notes beside each other, use a note's **Options → Add to split view**. Put Energy beside Move Lab, edit Move Lab's text, and rename Energy. Check that the open draft keeps its text and receives repaired links.

## Reset and current scope

Import the original JSON again to start fresh. If asked whether to keep both copies, choose to import a separate copy. Open the fresh playground and repeat the exercises.

This playground tests the active-workspace connection system and the two editing modes. Graph view, cross-workspace refactoring, metadata queries and spaced repetition are separate roadmap features.
