const ANON_KEY = "lanshan-analytics-anon";
const INSTALL_KEY = "lanshan-analytics-install";
const EXPLORED_KEY = "lanshan-analytics-explored";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 隐私模式或配额满：本会话内仍可用内存值 */
  }
}

let anonId = "";
let sessionId = "";
let installAt = 0;
let explored = false;
let exploredReady = false;
let coldStart = true;

export function ensureIdentity() {
  if (!anonId) {
    anonId = read(ANON_KEY) || crypto.randomUUID();
    write(ANON_KEY, anonId);
  }
  if (!installAt) {
    const raw = read(INSTALL_KEY);
    installAt = raw ? Number(raw) || Date.now() : Date.now();
    write(INSTALL_KEY, String(installAt));
  }
  if (!sessionId) sessionId = crypto.randomUUID();
  if (!exploredReady) {
    explored = read(EXPLORED_KEY) === "1";
    exploredReady = true;
  }
}

export function getAnonId() {
  ensureIdentity();
  return anonId;
}

export function getSessionId() {
  ensureIdentity();
  return sessionId;
}

export function getInstallAt() {
  ensureIdentity();
  return installAt;
}

export function hoursSinceInstall() {
  return Math.max(0, Math.round((Date.now() - getInstallAt()) / 3_600_000));
}

export function takeColdStart() {
  ensureIdentity();
  const v = coldStart;
  coldStart = false;
  return v;
}

export function hasEffectiveExplore() {
  ensureIdentity();
  return explored;
}

export function markEffectiveExplore() {
  ensureIdentity();
  if (explored) return false;
  explored = true;
  write(EXPLORED_KEY, "1");
  return true;
}

/** 测试用：清空内存态（不碰 localStorage，由测试自行控制） */
export function resetIdentityForTest(opts?: { anon?: string; session?: string; installAt?: number; explored?: boolean }) {
  anonId = opts?.anon ?? "";
  sessionId = opts?.session ?? "";
  installAt = opts?.installAt ?? 0;
  explored = opts?.explored ?? false;
  exploredReady = opts !== undefined;
  coldStart = true;
}
