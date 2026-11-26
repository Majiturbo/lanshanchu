export interface GitHubFile { path: string; sha: string; size: number }

export function parseGitHubRepository(raw: string): { owner: string; repo: string } {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error("请输入 GitHub 公开仓库地址"); }
  const parts = url.pathname.replace(/\/$/u, "").split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.username || url.password || url.search
    || parts.length !== 2 || !parts.every((part) => /^[\w.-]{1,100}$/u.test(part))) {
    throw new Error("请输入 https://github.com/所有者/仓库 格式的地址");
  }
  const repo = parts[1].replace(/\.git$/iu, "");
  if (!repo) throw new Error("请输入有效的 GitHub 仓库名");
  return { owner: parts[0], repo };
}

export function normalizeGitHubScope(branch: string, folder: string): { branch: string; folder: string } {
  const selectedBranch = branch.trim();
  const selectedFolder = folder.trim().replace(/^\/+|\/+$/gu, "");
  if (selectedBranch.length > 200 || /[\u0000-\u001f?#\\]/u.test(selectedBranch)) throw new Error("分支名称无效");
  if (selectedFolder.length > 500 || (selectedFolder && selectedFolder.split("/").some((part) => part === "." || part === ".." || !part || /[\u0000-\u001f?#\\]/u.test(part)))) {
    throw new Error("子目录路径无效");
  }
  return { branch: selectedBranch, folder: selectedFolder };
}

export function selectGitHubFiles(data: unknown, folder: string): GitHubFile[] {
  if (!data || typeof data !== "object" || !("tree" in data) || !Array.isArray(data.tree) || !("truncated" in data) || typeof data.truncated !== "boolean") {
    throw new Error("GitHub 文件列表格式错误");
  }
  if (data.truncated) throw new Error("仓库文件列表不完整；请选择更小的子目录");
  const files = data.tree.flatMap((entry: unknown): GitHubFile[] => {
    if (!entry || typeof entry !== "object" || !("type" in entry) || entry.type !== "blob"
      || !("path" in entry) || typeof entry.path !== "string" || !("sha" in entry) || typeof entry.sha !== "string"
      || !("size" in entry) || typeof entry.size !== "number") return [];
    if (folder && !entry.path.startsWith(`${folder}/`)) return [];
    const name = entry.path.split("/").pop() ?? "";
    if (!(/\.(?:md|markdown)$/iu.test(name) || /^readme$/iu.test(name))) return [];
    if (!/^[0-9a-f]{40}$/iu.test(entry.sha) || entry.size < 0) return [];
    return [{ path: entry.path, sha: entry.sha, size: entry.size }];
  });
  if (files.length > 300) throw new Error("单个仓库范围最多导入 300 份 Markdown；请选择子目录");
  return files;
}
