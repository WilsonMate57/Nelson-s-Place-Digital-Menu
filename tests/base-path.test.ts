import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/server/config";
import { makeTestContext, PASSWORD } from "./helpers";

describe("serving under a sub-path (BASE_PATH)", () => {
  it("normalises and validates BASE_PATH", () => {
    expect(loadConfig({ BASE_PATH: "/menu/" }).basePath).toBe("/menu");
    expect(loadConfig({}).basePath).toBe("");
    expect(() => loadConfig({ BASE_PATH: "menu" })).toThrow(/BASE_PATH/);
  });

  it("answers with and without the prefix and scopes the session cookie to it", async () => {
    const ctx = await makeTestContext({ env: { BASE_PATH: "/menu" } });
    expect((await ctx.request("/menu/api/health")).status).toBe(200);
    // Proxies that strip the prefix still reach the same routes.
    expect((await ctx.request("/api/health")).status).toBe(200);

    const res = await ctx.request("/menu/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "admin@test.local", password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/Path=\/menu\/api/);
  });
});
