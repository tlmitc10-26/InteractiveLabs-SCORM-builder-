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
  saveSuspendData(state: unknown): boolean;
  loadSuspendData(): unknown | null;
  finish(): void;
}

const MAX_SUSPEND = 4096;

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

export function createScormSession(win: Window): ScormSession {
  const api = findApi(win);
  if (!api) {
    return {
      mode: "standalone",
      setScore() {}, setCompleted() {},
      saveSuspendData() { return true; },
      loadSuspendData() { return null; },
      finish() {},
    };
  }
  api.LMSInitialize("");
  let finished = false;
  const set = (k: string, v: string) => api.LMSSetValue(k, v);
  const commit = () => api.LMSCommit("");

  return {
    mode: "scorm",
    setScore(raw: number) {
      const clamped = Math.max(0, Math.min(100, Math.round(raw)));
      set("cmi.core.score.raw", String(clamped));
      set("cmi.core.score.min", "0");
      set("cmi.core.score.max", "100");
      commit();
    },
    setCompleted() {
      set("cmi.core.lesson_status", "completed");
      commit();
    },
    saveSuspendData(state: unknown): boolean {
      const json = JSON.stringify(state);
      if (json.length > MAX_SUSPEND) return false;
      set("cmi.suspend_data", json);
      commit();
      return true;
    },
    loadSuspendData(): unknown | null {
      const raw = api.LMSGetValue("cmi.suspend_data");
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    finish() {
      if (finished) return;
      finished = true;
      set("cmi.core.exit", "");
      commit();
      api.LMSFinish("");
    },
  };
}

/* Bundle entry behavior: attach to window and finish on unload. */
declare global {
  interface Window { ILBScorm?: ScormSession }
}
if (typeof window !== "undefined" && typeof document !== "undefined" && !("__vitest_worker__" in globalThis)) {
  const session = createScormSession(window);
  window.ILBScorm = session;
  window.addEventListener("beforeunload", () => session.finish());
}
