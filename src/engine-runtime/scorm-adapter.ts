/** SCORM 1.2 API adapter. No DOM dependencies beyond window; bundled into packages. */

interface Scorm12Api {
  LMSInitialize(arg: string): string;
  LMSFinish(arg: string): string;
  LMSGetValue(key: string): string;
  LMSSetValue(key: string, value: string): string;
  LMSCommit(arg: string): string;
  LMSGetLastError(): string;
  LMSGetErrorString(code: string): string;
  LMSGetDiagnostic(code: string): string;
}

export interface ScormSession {
  mode: "scorm" | "standalone";
  setScore(raw: number): void;
  setCompleted(): void;
  saveSuspendData<T>(state: T): boolean;
  loadSuspendData<T>(): T | null;
  finish(): void;
}

// SCORM 1.2 cmi.suspend_data has a hard 4096-character limit (UTF-16 code
// units, i.e. JS string .length) enforced by the spec and most LMSes.
const MAX_SUSPEND = 4096;

// Coalesce rapid LMSSetValue bursts (e.g. drag ticks, autosave) into at most
// one LMSCommit per this window, rather than committing on every write.
const COMMIT_THROTTLE_MS = 500;

function findApi(win: Window): Scorm12Api | null {
  let w: Window | null = win;
  for (let hops = 0; w && hops < 10; hops++) {
    // Cross-origin frames throw on property access in real browsers; degrade
    // to standalone mode rather than crashing when that happens.
    try {
      const api = (w as Window & { API?: Scorm12Api }).API;
      if (api) return api;
      const parent: Window = w.parent;
      if (parent === w) break;
      w = parent;
    } catch {
      break;
    }
  }
  try {
    const opener = (win as Window & { opener?: Window }).opener;
    const api = opener && (opener as Window & { API?: Scorm12Api }).API;
    if (api) return api;
  } catch { /* cross-origin opener access throws — ignore */ }
  return null;
}

function standaloneSession(): ScormSession {
  return {
    mode: "standalone",
    setScore() {},
    setCompleted() {},
    saveSuspendData<T>(state: T): boolean { void state; return true; },
    loadSuspendData<T>(): T | null { return null; },
    finish() {},
  };
}

export function createScormSession(win: Window): ScormSession {
  const api = findApi(win);
  if (!api) return standaloneSession();

  const initResult = api.LMSInitialize("");
  if (initResult === "false") {
    const code = api.LMSGetLastError();
    console.warn(
      `SCORM LMSInitialize failed (error ${code}): ${api.LMSGetErrorString(code)} — falling back to standalone mode`
    );
    return standaloneSession();
  }

  let completed = false;
  let finished = false;
  let commitTimer: ReturnType<typeof setTimeout> | null = null;
  // Warn at most once per session per operation kind — LMSSetValue fires on
  // every keystroke/drag tick and we don't want to spam the console.
  let warnedSetValue = false;
  let warnedCommit = false;

  const warnLmsError = (action: string) => {
    const code = api.LMSGetLastError();
    console.warn(`SCORM ${action} failed (error ${code}): ${api.LMSGetErrorString(code)}`);
  };

  const set = (key: string, value: string) => {
    const result = api.LMSSetValue(key, value);
    if (result === "false" && !warnedSetValue) {
      warnedSetValue = true;
      warnLmsError(`LMSSetValue("${key}")`);
    }
    return result;
  };

  // Cancels any pending scheduled commit and commits immediately.
  const flush = () => {
    if (commitTimer !== null) {
      clearTimeout(commitTimer);
      commitTimer = null;
    }
    const result = api.LMSCommit("");
    if (result === "false" && !warnedCommit) {
      warnedCommit = true;
      warnLmsError("LMSCommit");
    }
  };

  // Schedules a single flush() COMMIT_THROTTLE_MS from now, unless one is
  // already pending.
  const scheduleCommit = () => {
    if (commitTimer !== null) return;
    commitTimer = setTimeout(flush, COMMIT_THROTTLE_MS);
  };

  // An abandoned attempt should read "incomplete", not "not attempted".
  set("cmi.core.lesson_status", "incomplete");
  scheduleCommit();

  return {
    mode: "scorm",
    setScore(raw: number) {
      const clamped = Math.max(0, Math.min(100, Math.round(raw)));
      set("cmi.core.score.raw", String(clamped));
      set("cmi.core.score.min", "0");
      set("cmi.core.score.max", "100");
      scheduleCommit();
    },
    setCompleted() {
      // Idempotent: a second call must not re-write/re-commit (avoids commit
      // storms if the engine's own completion guard is ever bypassed).
      if (completed) return;
      completed = true;
      set("cmi.core.lesson_status", "completed");
      // Completion is rare and important enough to commit right away rather
      // than risk losing it in the throttle window.
      flush();
    },
    saveSuspendData<T>(state: T): boolean {
      const json = JSON.stringify(state);
      if (json.length > MAX_SUSPEND) return false;
      set("cmi.suspend_data", json);
      scheduleCommit();
      return true;
    },
    loadSuspendData<T>(): T | null {
      const raw = api.LMSGetValue("cmi.suspend_data");
      if (!raw) return null;
      try { return JSON.parse(raw) as T; } catch { return null; }
    },
    finish() {
      if (finished) return;
      finished = true;
      // "suspend" tells the LMS to preserve suspend_data for resume; only an
      // explicitly completed attempt exits clean.
      set("cmi.core.exit", completed ? "" : "suspend");
      flush();
      api.LMSFinish("");
    },
  };
}

/* Bundle entry behavior: attach to window and finish on unload/hide. */
declare global {
  interface Window { ILBScorm?: ScormSession }
}
if (typeof window !== "undefined" && typeof document !== "undefined" && !("__vitest_worker__" in globalThis)) {
  const session = createScormSession(window);
  window.ILBScorm = session;
  // finish() is idempotent, so it's safe for both events to fire.
  window.addEventListener("beforeunload", () => session.finish());
  // pagehide is more reliable than beforeunload on iOS/Canvas mobile webviews.
  window.addEventListener("pagehide", () => session.finish());
}
