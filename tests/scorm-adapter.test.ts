// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createScormSession } from "@/engine-runtime/scorm-adapter";

function mockApi() {
  const data: Record<string, string> = {};
  return {
    data,
    LMSInitialize: vi.fn(() => "true"),
    LMSFinish: vi.fn(() => "true"),
    LMSGetValue: vi.fn((k: string) => data[k] ?? ""),
    LMSSetValue: vi.fn((k: string, v: string) => { data[k] = v; return "true"; }),
    LMSCommit: vi.fn(() => "true"),
    LMSGetLastError: vi.fn(() => "0"),
    LMSGetErrorString: vi.fn(() => ""),
    LMSGetDiagnostic: vi.fn(() => ""),
  };
}

describe("createScormSession", () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).API;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("standalone mode when no API found", () => {
    const s = createScormSession(window);
    expect(s.mode).toBe("standalone");
    expect(() => s.setScore(50)).not.toThrow();
  });

  it("finds API on window and initializes", () => {
    const api = mockApi();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).API = api;
    const s = createScormSession(window);
    expect(s.mode).toBe("scorm");
    expect(api.LMSInitialize).toHaveBeenCalledWith("");
  });

  it("finds API on a parent window", () => {
    const api = mockApi();
    const child = { parent: { API: api } } as unknown as Window;
    // make parent chain terminate
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (child.parent as any).parent = child.parent;
    const s = createScormSession(child);
    expect(s.mode).toBe("scorm");
  });

  it("lesson_status becomes 'incomplete' on session creation", () => {
    const api = mockApi();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).API = api;
    createScormSession(window);
    expect(api.data["cmi.core.lesson_status"]).toBe("incomplete");
  });

  it("setScore clamps to 0-100, writes raw/min/max, commits", () => {
    const api = mockApi();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).API = api;
    vi.useFakeTimers();
    const s = createScormSession(window);
    s.setScore(150);
    expect(api.data["cmi.core.score.raw"]).toBe("100");
    expect(api.data["cmi.core.score.min"]).toBe("0");
    expect(api.data["cmi.core.score.max"]).toBe("100");
    vi.advanceTimersByTime(500);
    expect(api.LMSCommit).toHaveBeenCalled();
  });

  it("rapid setScore calls produce ONE commit after timer advance", () => {
    const api = mockApi();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).API = api;
    vi.useFakeTimers();
    const s = createScormSession(window);
    api.LMSCommit.mockClear(); // ignore the initial lesson_status commit scheduling
    s.setScore(10);
    s.setScore(20);
    s.setScore(30);
    vi.advanceTimersByTime(500);
    expect(api.LMSCommit).toHaveBeenCalledTimes(1);
  });

  it("setCompleted sets lesson_status and commits", () => {
    const api = mockApi();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).API = api;
    const s = createScormSession(window);
    s.setCompleted();
    expect(api.data["cmi.core.lesson_status"]).toBe("completed");
    expect(api.LMSCommit).toHaveBeenCalled();
  });

  it("suspend data round-trips and rejects >4096 chars", () => {
    const api = mockApi();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).API = api;
    const s = createScormSession(window);
    expect(s.saveSuspendData({ a: 1 })).toBe(true);
    expect(s.loadSuspendData()).toEqual({ a: 1 });
    expect(s.saveSuspendData({ big: "x".repeat(5000) })).toBe(false);
  });

  it("finish() on an incomplete session writes exit='suspend' and calls LMSFinish once", () => {
    const api = mockApi();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).API = api;
    const s = createScormSession(window);
    s.finish();
    s.finish();
    expect(api.data["cmi.core.exit"]).toBe("suspend");
    expect(api.LMSFinish).toHaveBeenCalledTimes(1);
  });

  it("finish() after setCompleted writes exit=''", () => {
    const api = mockApi();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).API = api;
    const s = createScormSession(window);
    s.setCompleted();
    s.finish();
    expect(api.data["cmi.core.exit"]).toBe("");
    expect(api.LMSFinish).toHaveBeenCalledTimes(1);
  });

  it("LMSInitialize returning 'false' yields standalone mode", () => {
    const api = mockApi();
    api.LMSInitialize = vi.fn(() => "false");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).API = api;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = createScormSession(window);
    expect(s.mode).toBe("standalone");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
