import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mountSpa } from "./spa.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ava-spa-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("mountSpa", () => {
  it("does nothing when there is no build", () => {
    expect(mountSpa(new Hono(), dir)).toBe(false);
  });

  it("serves files, falls back to index.html, and keeps /api out of the SPA", async () => {
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "<html>spa-index</html>");
    writeFileSync(join(dir, "assets", "app.js"), "console.log('asset')");

    const app = new Hono();
    app.all("/api/*", (c) => c.json({ code: "not_found" }, 404));
    expect(mountSpa(app, dir)).toBe(true);

    expect(await (await app.request("/")).text()).toContain("spa-index");
    expect(await (await app.request("/some/client/route")).text()).toContain("spa-index");
    expect(await (await app.request("/assets/app.js")).text()).toContain("asset");
    const api = await app.request("/api/unknown");
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ code: "not_found" });
  });
});
