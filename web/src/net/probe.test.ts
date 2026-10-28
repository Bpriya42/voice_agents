import { afterEach, describe, expect, it, vi } from "vitest";
import { HealthProbe, watchConnectivity } from "./probe.js";

afterEach(() => vi.useRealTimers());

const asFetch = (fn: unknown) => fn as typeof fetch;

describe("HealthProbe", () => {
  it("runs one probe at a time and shares its result", async () => {
    let calls = 0;
    let release!: () => void;
    const probe = new HealthProbe(
      asFetch(() => {
        calls++;
        return new Promise<Response>((resolve) => {
          release = () => resolve(new Response("{}"));
        });
      }),
    );
    const a = probe.check();
    const b = probe.check();
    expect(probe.busy).toBe(true);
    expect(calls).toBe(1);
    release();
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(probe.busy).toBe(false);
    void probe.check();
    expect(calls).toBe(2);
  });

  it("treats any HTTP answer as reachable, even a 500", async () => {
    const probe = new HealthProbe(
      asFetch(() => Promise.resolve(new Response("", { status: 500 }))),
    );
    expect(await probe.check()).toBe(true);
  });

  it("a network error is offline", async () => {
    const probe = new HealthProbe(asFetch(() => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await probe.check()).toBe(false);
  });

  it("aborts after 2 s", async () => {
    vi.useFakeTimers();
    const probe = new HealthProbe(
      asFetch(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );
    const p = probe.check();
    await vi.advanceTimersByTimeAsync(1999);
    expect(probe.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe(false);
  });
});

describe("watchConnectivity", () => {
  it("maps online / offline events and unsubscribes", () => {
    const target = new EventTarget();
    const seen: boolean[] = [];
    const off = watchConnectivity(target, (o) => seen.push(o));
    target.dispatchEvent(new Event("offline"));
    target.dispatchEvent(new Event("online"));
    off();
    target.dispatchEvent(new Event("offline"));
    expect(seen).toEqual([false, true]);
  });
});
