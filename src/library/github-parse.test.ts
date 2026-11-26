import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeGitHubScope, parseGitHubRepository, selectGitHubFiles } from "./github-parse.ts";

test("accepts a public repository URL and explicit branch/folder scope", () => {
  assert.deepEqual(parseGitHubRepository("https://github.com/Zleap-AI/SAG-Wiki.git#readme"), { owner: "Zleap-AI", repo: "SAG-Wiki" });
  assert.deepEqual(normalizeGitHubScope("release/docs", "/docs/en/"), { branch: "release/docs", folder: "docs/en" });
  assert.deepEqual(normalizeGitHubScope("", ""), { branch: "", folder: "" });
  assert.throws(() => parseGitHubRepository("https://github.com/owner/repo/issues"), /格式/);
  assert.throws(() => normalizeGitHubScope("main", "docs/../private"), /路径无效/);
});

test("selects only Markdown in the chosen folder and rejects a truncated tree", () => {
  const sha = "a".repeat(40);
  const tree = { truncated: false, tree: [
    { path: "docs/en/README", type: "blob", sha, size: 200 },
    { path: "docs/en/guide.markdown", type: "blob", sha, size: 300 },
    { path: "docs/english/other.md", type: "blob", sha, size: 400 },
    { path: "docs/en/image.png", type: "blob", sha, size: 500 },
    { path: "docs/en/sub", type: "tree", sha },
  ] };
  assert.deepEqual(selectGitHubFiles(tree, "docs/en").map((file) => file.path), ["docs/en/README", "docs/en/guide.markdown"]);
  assert.throws(() => selectGitHubFiles({ ...tree, truncated: true }, "docs/en"), /不完整/);
});
