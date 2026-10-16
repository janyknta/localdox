import { test } from "node:test";
import assert from "node:assert/strict";
import { indexedDB, IDBKeyRange, IDBCursor } from "fake-indexeddb";
import {
  newWorkspaceRecord,
  persistence,
  serializeWorkspace,
} from "../src/lib/workspace/persistence.ts";

Object.assign(globalThis, { indexedDB, IDBKeyRange });

test("removing legacy workspace types is atomic and preserves identities and document kinds", async (t) => {
  const workspaces = ["exam", "reader", "documentation"].map((kind) => ({
    ...newWorkspaceRecord(`Existing ${kind}`),
    kind,
    revision: `revision-${kind}`,
    files: [{ id: "paper", name: "paper.xam", content: "Exam content", kind: "exam" as const }],
  }));
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("localdox", 4);
    req.onupgradeneeded = () => {
      const db = req.result;
      const records = db.createObjectStore("workspaces", { keyPath: "id" });
      const files = db.createObjectStore("files", { keyPath: ["workspaceId", "id"] });
      files.createIndex("workspaceId", "workspaceId");
      const summaries = db.createObjectStore("workspace-summaries", { keyPath: "id" });
      for (const workspace of workspaces) {
        const { files: documents, ...metadata } = workspace;
        records.put({ ...metadata, fileIds: documents.map((file) => file.id) });
        files.put({ ...documents[0], workspaceId: workspace.id });
        summaries.put({
          id: workspace.id,
          name: workspace.name,
          kind: workspace.kind,
          createdAt: workspace.createdAt,
          updatedAt: workspace.updatedAt,
          docCount: 1,
          bytes: 123,
        });
      }
    };
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });

  await t.test("an aborted upgrade leaves all legacy records intact", async () => {
    const original = IDBCursor.prototype.update;
    IDBCursor.prototype.update = function (value) {
      const req = original.call(this, value);
      req.addEventListener("success", () => (this.source as IDBObjectStore).transaction.abort());
      return req;
    };
    try {
      await assert.rejects(persistence.getWorkspace(workspaces[0].id));
    } finally {
      IDBCursor.prototype.update = original;
    }
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("localdox");
      req.onsuccess = () => {
        const db = req.result;
        assert.equal(db.version, 4);
        const tx = db.transaction("workspaces");
        const rows = tx.objectStore("workspaces").getAll();
        tx.oncomplete = () => {
          assert.deepEqual(rows.result.map((row) => row.kind).sort(), [
            "documentation",
            "exam",
            "reader",
          ]);
          db.close();
          resolve();
        };
      };
      req.onerror = () => reject(req.error);
    });
  });

  await t.test("the retry removes types without rewriting files or revisions", async () => {
    for (const { kind: _kind, ...expected } of workspaces) {
      const loaded = (await persistence.getWorkspace(expected.id))!;
      assert.deepEqual(loaded, expected);
      assert.equal((await persistence.getWorkspaceEntries(expected.id))!.files[0].kind, "exam");
    }
    const summaries = await persistence.listWorkspaceSummaries();
    assert.equal(summaries.length, 3);
    for (const summary of summaries) {
      assert.equal("kind" in summary, false);
      assert.equal(summary.bytes, 123);
    }
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("localdox");
      req.onsuccess = () => {
        const db = req.result;
        assert.equal(db.version, 5);
        const tx = db.transaction("workspaces");
        const rows = tx.objectStore("workspaces").getAll();
        tx.oncomplete = () => {
          assert.ok(rows.result.every((row) => !("kind" in row)));
          db.close();
          resolve();
        };
      };
      req.onerror = () => reject(req.error);
    });
  });

  await t.test("saving and exporting an old caller's snapshot cannot restore a type", async () => {
    const legacy = workspaces[0];
    await persistence.putWorkspace(legacy);
    assert.equal("kind" in (await persistence.getWorkspace(legacy.id))!, false);
    assert.equal("kind" in JSON.parse(await serializeWorkspace(legacy)).workspace, false);
  });
  await persistence.destroy();
});
