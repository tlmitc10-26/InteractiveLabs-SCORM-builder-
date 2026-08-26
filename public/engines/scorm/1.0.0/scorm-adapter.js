"use strict";
(() => {
  // src/engine-runtime/scorm-adapter.ts
  var MAX_SUSPEND = 4096;
  var COMMIT_THROTTLE_MS = 500;
  function findApi(win) {
    let w = win;
    for (let hops = 0; w && hops < 10; hops++) {
      try {
        const api = w.API;
        if (api) return api;
        const parent = w.parent;
        if (parent === w) break;
        w = parent;
      } catch {
        break;
      }
    }
    try {
      const opener = win.opener;
      const api = opener && opener.API;
      if (api) return api;
    } catch {
    }
    return null;
  }
  function standaloneSession() {
    return {
      mode: "standalone",
      setScore() {
      },
      setCompleted() {
      },
      saveSuspendData(state) {
        void state;
        return true;
      },
      loadSuspendData() {
        return null;
      },
      finish() {
      }
    };
  }
  function createScormSession(win) {
    const api = findApi(win);
    if (!api) return standaloneSession();
    const initResult = api.LMSInitialize("");
    if (initResult === "false") {
      const code = api.LMSGetLastError();
      console.warn(
        `SCORM LMSInitialize failed (error ${code}): ${api.LMSGetErrorString(code)} \u2014 falling back to standalone mode`
      );
      return standaloneSession();
    }
    let completed = false;
    let finished = false;
    let commitTimer = null;
    let warnedSetValue = false;
    let warnedCommit = false;
    const warnLmsError = (action) => {
      const code = api.LMSGetLastError();
      console.warn(`SCORM ${action} failed (error ${code}): ${api.LMSGetErrorString(code)}`);
    };
    const set = (key, value) => {
      const result = api.LMSSetValue(key, value);
      if (result === "false" && !warnedSetValue) {
        warnedSetValue = true;
        warnLmsError(`LMSSetValue("${key}")`);
      }
      return result;
    };
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
    const scheduleCommit = () => {
      if (commitTimer !== null) return;
      commitTimer = setTimeout(flush, COMMIT_THROTTLE_MS);
    };
    set("cmi.core.lesson_status", "incomplete");
    scheduleCommit();
    return {
      mode: "scorm",
      setScore(raw) {
        const clamped = Math.max(0, Math.min(100, Math.round(raw)));
        set("cmi.core.score.raw", String(clamped));
        set("cmi.core.score.min", "0");
        set("cmi.core.score.max", "100");
        scheduleCommit();
      },
      setCompleted() {
        if (completed) return;
        completed = true;
        set("cmi.core.lesson_status", "completed");
        flush();
      },
      saveSuspendData(state) {
        const json = JSON.stringify(state);
        if (json.length > MAX_SUSPEND) return false;
        set("cmi.suspend_data", json);
        scheduleCommit();
        return true;
      },
      loadSuspendData() {
        const raw = api.LMSGetValue("cmi.suspend_data");
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      },
      finish() {
        if (finished) return;
        finished = true;
        set("cmi.core.exit", completed ? "" : "suspend");
        flush();
        api.LMSFinish("");
      }
    };
  }
  if (typeof window !== "undefined" && typeof document !== "undefined" && !("__vitest_worker__" in globalThis)) {
    const session = createScormSession(window);
    window.ILBScorm = session;
    window.addEventListener("beforeunload", () => session.finish());
    window.addEventListener("pagehide", () => session.finish());
  }
})();
