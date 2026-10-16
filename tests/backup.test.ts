import assert from "node:assert/strict";
import { test } from "node:test";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import {
  persistence,
  newWorkspaceRecord,
  parseWorkspaceImport,
  serializeWorkspace,
  type WorkspaceRecord,
} from "../src/lib/workspace/persistence.ts";
import { MAX_IMPORT_BYTES, ImportValidationError } from "../src/lib/workspace/import-schema.ts";
import { binaryBody, portableFiles, portableData } from "../src/lib/workspace/binary.ts";
import {
  buildWorkspaceShare,
  countAnnotations,
  compressAndEncode,
  decodeAndDecompress,
  parseSharedFiles,
  serializeSharedFiles,
} from "../src/lib/workspace/share.ts";

Object.assign(globalThis, { indexedDB, IDBKeyRange });

const HASH = "a".repeat(64);

/** Every kind of state a reader can create, so one round trip covers it all. */
function richWorkspace(): WorkspaceRecord {
  const w = newWorkspaceRecord("Research");
  w.folders = [
    { id: "outer", name: "Papers", createdAt: 1, parentId: null },
    { id: "inner", name: "2026", createdAt: 2, parentId: "outer" },
    { id: "media", name: "Attachments", createdAt: 3, parentId: null, purpose: "embed-media" },
  ];
  w.files = [
    {
      id: "note",
      name: "note.md",
      content:
        "# Title\n\n```yellownote heading note\nTitle\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n" +
        "```note\nPrivate reading note\n```\n\n```js\nx()\n```\n",
      addedAt: 10,
      kind: "markdown",
      folderId: "inner",
    },
    {
      id: "binned",
      name: "old.md",
      content: "binned text",
      addedAt: 11,
      kind: "markdown",
      deletedAt: 1_700_000_000_000,
      folderId: null,
    },
    {
      id: "pdf",
      name: "paper.pdf",
      content: "",
      data: binaryBody(new Blob(["%PDF-1.4"], { type: "application/pdf" })),
      mimeType: "application/pdf",
      size: 8,
      addedAt: 12,
      kind: "pdf",
      folderId: "outer",
    },
    {
      id: "derived",
      name: "paper.md",
      content: "converted",
      addedAt: 13,
      kind: "markdown",
      folderId: null,
      derivedFrom: {
        sourceFileId: "pdf",
        sourceName: "paper.pdf",
        inputHash: HASH,
        converter: "anydoc",
        converterVersion: "0.2.4",
        convertedAt: 14,
      },
    },
  ];
  w.saved = [
    {
      id: "star-table",
      fileId: "note",
      kind: "block",
      blockType: "table",
      title: "Table",
      text: "a b 1 2",
      note: "Compare with chapter 3",
      subtopicId: "title",
      start: 9,
      end: 16,
      prefix: "Title ",
      suffix: " x()",
      createdAt: 20,
    },
    {
      id: "star-code",
      fileId: "note",
      kind: "block",
      blockType: "code",
      title: "x()",
      note: "Entry point",
      createdAt: 21,
    },
    { id: "star-file", fileId: "binned", kind: "file", title: "old.md", createdAt: 22 },
  ];
  w.bookmarks = ["note#title"];
  w.ui = {
    activeFileId: "derived",
    expanded: { outer: true, inner: false },
    sidebarCollapsed: true,
    scrollTop: 420,
    fileOrder: ["derived", "note", "pdf", "binned"],
    recentFileIds: ["derived", "note"],
    panes: [
      { id: "left", tabs: ["note", "pdf"], activeTabId: "pdf" },
      { id: "right", tabs: ["derived"], activeTabId: "derived" },
    ],
    focusedPaneId: "right",
  };
  return w;
}

/** The fields a restore must reproduce exactly (the id and timestamps are new). */
async function comparable(w: WorkspaceRecord) {
  const { id: _id, updatedAt: _u, revision: _r, ...rest } = w;
  return { ...rest, files: await portableFiles(rest.files) };
}

test("backup round trip preserves saved items, notes, Bin state, folders, panes and derivations", async () => {
  const original = richWorkspace();
  const restored = parseWorkspaceImport(await serializeWorkspace(original));
  assert.deepEqual(await comparable(restored), await comparable(original));
  // The audit's concrete failure: these two fields were dropped.
  assert.equal(restored.saved?.length, 3);
  assert.equal(restored.saved?.[0].note, "Compare with chapter 3");
  assert.equal(restored.files[1].deletedAt, 1_700_000_000_000);
});

test("export → clear database → import → reload reproduces the workspace", async () => {
  const original = richWorkspace();
  await persistence.putWorkspace(original);
  const exported = await serializeWorkspace((await persistence.getWorkspace(original.id))!);

  await persistence.destroy();
  assert.deepEqual(await persistence.listWorkspaceSummaries(), []);

  const imported = parseWorkspaceImport(exported);
  await persistence.putWorkspace(imported);
  const reloaded = (await persistence.getWorkspace(imported.id))!;
  assert.deepEqual(await comparable(reloaded), await comparable(original));
  await persistence.destroy();
});

test("version 1 and unwrapped legacy backups remain readable", () => {
  const legacy = {
    format: "localdox-workspace",
    version: 1,
    workspace: {
      id: "old",
      name: "Old",
      createdAt: 5,
      updatedAt: 6,
      files: [{ id: "a", name: "a.md", content: "hello" }],
      bookmarks: ["a#intro", 7],
      ui: { activeFileId: "a", expanded: {}, sidebarCollapsed: false, scrollTop: 0 },
    },
  };
  const w = parseWorkspaceImport(JSON.stringify(legacy));
  assert.equal(w.name, "Old");
  assert.deepEqual(w.bookmarks, ["a#intro"]);
  // No `saved` means "rebuild from bookmarks", which hydrate does; an empty
  // array here would silently discard those legacy stars.
  assert.equal(w.saved, undefined);
  assert.deepEqual(w.folders, []);
  assert.deepEqual(w.ui.panes, []);

  const unwrapped = parseWorkspaceImport(JSON.stringify(legacy.workspace));
  assert.equal(unwrapped.files[0].content, "hello");
});

test("record-level highlights and notes in old backups and share links are dropped", () => {
  // Before highlights and notes moved into the Markdown they were arrays on
  // the record. Those arrays are discarded, not migrated — but a backup or a
  // link that still carries them must open, even when they would not have
  // validated (duplicate ids, missing fields).
  const legacy = {
    format: "localdox-workspace",
    version: 2,
    workspace: {
      id: "old",
      name: "Old",
      files: [{ id: "a", name: "a.md", content: "# A\n\nKey idea.\n" }],
      highlights: [
        { id: "h", fileId: "a", text: "Key idea", color: "yellow" },
        { id: "h", fileId: "gone", text: 3 },
      ],
      notes: [
        { id: "n", fileId: "a", fileName: "a.md", content: "My note", source: { quote: "Key" } },
        { id: "n" },
      ],
      bookmarks: [],
      ui: { activeFileId: "a", expanded: {}, sidebarCollapsed: false, scrollTop: 0 },
    },
  };
  const w = parseWorkspaceImport(JSON.stringify(legacy));
  assert.equal(w.name, "Old");
  assert.equal(w.files[0].content, "# A\n\nKey idea.\n");
  assert.equal("highlights" in w, false);
  assert.equal("notes" in w, false);
  const unwrapped = parseWorkspaceImport(JSON.stringify(legacy.workspace));
  assert.equal("highlights" in unwrapped || "notes" in unwrapped, false);
});

test("a stored workspace row that still has highlights and notes loads without them", async () => {
  const w = newWorkspaceRecord("Stored");
  w.files = [{ id: "a", name: "a.md", content: "# A" }];
  await persistence.putWorkspace(w);
  // Add the legacy arrays to the stored row, as an older build wrote it.
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("localdox");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("workspaces", "readwrite");
      const store = tx.objectStore("workspaces");
      const row = store.get(w.id);
      row.onsuccess = () =>
        store.put({
          ...row.result,
          highlights: [{ id: "h", fileId: "a", text: "A", color: "yellow" }],
          notes: [{ id: "n", fileId: "a", content: "old note" }],
        });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => reject(tx.error);
    };
  });
  const loaded = (await persistence.getWorkspace(w.id))!;
  assert.equal("highlights" in loaded, false);
  assert.equal("notes" in loaded, false);
  assert.equal(loaded.files[0].content, "# A");
  assert.ok(!(await serializeWorkspace(loaded)).includes("old note"));
  const entries = (await persistence.getWorkspaceEntries(w.id))!;
  assert.equal("highlights" in entries || "notes" in entries, false);
  // The next save writes the row without them.
  await persistence.putWorkspace(loaded);
  assert.equal("notes" in (await persistence.getWorkspace(w.id))!, false);
  await persistence.destroy();
});

test("unknown document kinds and fields from a newer build are tolerated", () => {
  const w = richWorkspace();
  const json = JSON.stringify({
    format: "localdox-workspace",
    version: 2,
    workspace: { ...w, futureField: 1, files: [{ ...w.files[0], kind: "hologram", extra: true }] },
  });
  const imported = parseWorkspaceImport(json);
  assert.equal(imported.files[0].kind, undefined);
  assert.equal("extra" in imported.files[0], false);
});

test("malformed, duplicated, cyclic, too deep and oversized backups are rejected before any write", async () => {
  const base = richWorkspace();
  const portable = { ...base, files: await portableFiles(base.files) };
  const bad = (mutate: (w: any) => void, pattern: RegExp) => {
    const w = structuredClone(portable) as any;
    mutate(w);
    assert.throws(
      () =>
        parseWorkspaceImport(
          JSON.stringify({ format: "localdox-workspace", version: 2, workspace: w }),
        ),
      (error: Error) => error instanceof ImportValidationError && pattern.test(error.message),
    );
  };
  bad((w) => (w.files = "nope"), /files/);
  bad((w) => (w.files[0].content = 3), /files\.0\.content/);
  bad((w) => (w.files[1].id = w.files[0].id), /two files/);
  bad((w) => (w.saved[1].id = w.saved[0].id), /two saved items/);
  bad((w) => (w.folders[0].parentId = "inner"), /nested inside itself/);
  bad((w) => {
    w.folders = Array.from({ length: 70 }, (_, i) => ({
      id: `f${i}`,
      name: `f${i}`,
      createdAt: 0,
      parentId: i ? `f${i - 1}` : null,
    }));
  }, /levels deep/);
  bad((w) => {
    // Well under the JSON limit as text, but the declared payload is the
    // decoded budget: one base64 file just over it.
    w.files[2].data =
      "data:application/pdf;base64," + "A".repeat(Math.ceil(MAX_IMPORT_BYTES / 0.75) + 8);
  }, /limit/);

  assert.throws(() => parseWorkspaceImport("{not json"), /not valid JSON/);
  assert.throws(
    () =>
      parseWorkspaceImport(
        JSON.stringify({ format: "localdox-workspace", version: 99, workspace: base }),
      ),
    /newer version/,
  );
  assert.throws(
    () => parseWorkspaceImport(JSON.stringify({ format: "something-else", version: 1 })),
    /not a Localdox workspace backup/,
  );
});

test("dangling references are dropped instead of pointing at nothing", async () => {
  const w = richWorkspace();
  w.saved!.push({ id: "ghost", fileId: "missing", kind: "file", title: "x", createdAt: 1 });
  w.ui.panes![0].tabs.push("missing");
  w.files[0].folderId = "no-such-folder";
  const imported = parseWorkspaceImport(await serializeWorkspace(w));
  assert.equal(
    imported.saved!.some((s) => s.id === "ghost"),
    false,
  );
  assert.deepEqual(imported.ui.panes![0].tabs, ["note", "pdf"]);
  assert.equal(imported.files[0].folderId, null);
});

test("shared-file payloads are validated and remap derivations to included files only", async () => {
  const w = richWorkspace();
  const payload = parseSharedFiles(await serializeSharedFiles([w.files[3]], "Research"));
  assert.equal(payload.files[0].derivedFrom?.sourceFileId, undefined);
  assert.throws(
    () => parseSharedFiles(JSON.stringify({ files: [w.files[0], w.files[0]] })),
    /two files/,
  );
});

test("compressed share payloads stop decompressing at the import budget", async () => {
  const small = await compressAndEncode(JSON.stringify({ hello: "world" }));
  assert.equal(await decodeAndDecompress(small), JSON.stringify({ hello: "world" }));

  // ~150 MiB of zeros compresses to a few hundred KiB.
  const bomb = await compressAndEncode("0".repeat(MAX_IMPORT_BYTES + 1024 * 1024));
  assert.ok(bomb.length < 1024 * 1024);
  await assert.rejects(decodeAndDecompress(bomb), /import limit/);
});

// ---- A03: what a share link carries ----

const liveIds = (w: WorkspaceRecord) => w.files.filter((f) => f.deletedAt == null).map((f) => f.id);

test("a default workspace share leaves out the Bin, annotations, history and layout", async () => {
  const w = richWorkspace();
  const shared = buildWorkspaceShare(w, { fileIds: liveIds(w), includeAnnotations: false });
  const json = await serializeWorkspace(shared);

  assert.deepEqual(
    shared.files.map((f) => f.id),
    ["note", "pdf", "derived"],
  );
  assert.ok(!json.includes("binned text"), "binned content must not be uploaded");
  for (const secret of [
    "Compare with chapter 3",
    "Entry point",
    "heading note",
    "Private reading note",
  ])
    assert.ok(!json.includes(secret), `private note "${secret}" must not be uploaded`);
  // Highlights and notes are fenced blocks in the Markdown; the document
  // itself still travels intact around them.
  const note = shared.files.find((f) => f.id === "note")!;
  assert.doesNotMatch(note.content, /```(yellow)?note/);
  assert.match(note.content, /^# Title\n\n\| a \| b \|/);
  assert.match(note.content, /```js\nx\(\)\n```\n$/);
  assert.equal(countAnnotations(shared, liveIds(shared)), 0);
  assert.equal("highlights" in shared, false);
  assert.equal("notes" in shared, false);
  assert.deepEqual(shared.saved, []);
  assert.deepEqual(shared.bookmarks, []);
  assert.deepEqual(shared.ui.recentFileIds, []);
  assert.deepEqual(shared.ui.panes, []);
  assert.deepEqual(shared.ui.expanded, {});
  assert.equal(shared.ui.scrollTop, 0);
  assert.equal(shared.ui.activeFileId, "derived");
  assert.deepEqual(shared.ui.fileOrder, ["derived", "note", "pdf"]);
  assert.notEqual(shared.id, w.id, "the sender's workspace id stays local");
  assert.ok(shared.files.every((f) => !("deletedAt" in f)));
  // The source workspace is untouched.
  assert.equal(w.saved?.length, 3);
});

test("a share keeps only the folders on the path to a shared file", () => {
  const w = richWorkspace();
  const onlyNote = buildWorkspaceShare(w, { fileIds: ["note"], includeAnnotations: false });
  assert.deepEqual(onlyNote.folders?.map((f) => f.id).sort(), ["inner", "outer"]);
  assert.equal(onlyNote.files[0].folderId, "inner");

  const onlyDerived = buildWorkspaceShare(w, { fileIds: ["derived"], includeAnnotations: false });
  assert.deepEqual(onlyDerived.folders, [], "empty folder names don't travel");
  // Its source PDF isn't shared, so the link to it is cut rather than dangling.
  assert.equal(onlyDerived.files[0].derivedFrom?.sourceFileId, undefined);
  assert.equal(onlyDerived.files[0].derivedFrom?.sourceName, "paper.pdf");
});

test("annotations travel only when opted in, and only for shared files", async () => {
  const w = richWorkspace();
  // Stars are kept in the record but are no longer visible, so they are
  // neither counted nor shared. The count is the fenced blocks in the
  // selected files' Markdown: one highlight and one note.
  assert.equal(countAnnotations(w, liveIds(w)), 2);
  assert.equal(countAnnotations(w, ["pdf", "derived"]), 0);
  const shared = buildWorkspaceShare(w, { fileIds: liveIds(w), includeAnnotations: true });
  assert.deepEqual(shared.saved, []);
  assert.equal(shared.files.find((f) => f.id === "note")!.content, w.files[0].content);
  assert.equal(countAnnotations(shared, liveIds(shared)), 2);
  const json = await serializeWorkspace(shared);
  assert.ok(json.includes("heading note") && json.includes("Private reading note"));
  assert.deepEqual(shared.bookmarks, []);

  // A binned file the sender ticks explicitly arrives live.
  const withBin = buildWorkspaceShare(w, { fileIds: ["binned"], includeAnnotations: true });
  assert.equal(withBin.files[0].deletedAt, undefined);
  assert.deepEqual(withBin.saved, []);
});

test("a shared workspace imports as the previewed selection", async () => {
  const w = richWorkspace();
  const shared = buildWorkspaceShare(w, { fileIds: ["note", "pdf"], includeAnnotations: false });
  const received = parseWorkspaceImport(await serializeWorkspace(shared));
  assert.deepEqual(
    received.files.map((f) => [f.id, f.folderId, f.deletedAt]),
    [
      ["note", "inner", undefined],
      ["pdf", "outer", undefined],
    ],
  );
  assert.equal(await portableData(received.files[1].data), await portableData(w.files[2].data));
  assert.deepEqual(received.saved ?? [], []);
  assert.equal("highlights" in received, false);

  // The file-link payload is built from the same selection.
  const files = parseSharedFiles(await serializeSharedFiles(shared.files, w.name));
  assert.deepEqual(
    files.files.map((f) => f.id),
    ["note", "pdf"],
  );
});
