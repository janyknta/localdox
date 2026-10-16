import { test } from "node:test";
import assert from "node:assert/strict";
import { readAppRoute, settingsPath, workspacePath } from "../src/lib/app/routes.ts";

test("workspace and file URLs round-trip opaque identifiers", () => {
  const path = workspacePath("workspace / one", "file#two");
  assert.equal(path, "/workspaces/workspace%20%2F%20one/files/file%23two");
  assert.equal(readAppRoute(path).workspaceId, "workspace / one");
  assert.equal(readAppRoute(path).fileId, "file#two");
});
test("settings sections and rulesets are addressable", () => {
  assert.equal(settingsPath("exams", "rules / one"), "/settings/exams/rules%20%2F%20one");
  assert.equal(readAppRoute(settingsPath("exams", "rules / one")).rulesId, "rules / one");
  assert.equal(readAppRoute("/settings/reading").section, "reading");
  assert.equal(settingsPath("practice", "file / one"), "/settings/practice/file%20%2F%20one");
  assert.equal(readAppRoute(settingsPath("practice", "file / one")).practiceId, "file / one");
  assert.equal(readAppRoute("/settings/practice/file").rulesId, undefined);
  assert.equal(readAppRoute("/settings").section, "appearance");
  assert.equal(readAppRoute("/settings/unknown").section, "appearance");
  assert.equal(readAppRoute("/settings/reading/extra").rulesId, undefined);
});
