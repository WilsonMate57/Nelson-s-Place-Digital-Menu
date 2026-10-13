import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp, createServices, type Services } from "../src/server/app";
import { loadConfig } from "../src/server/config";
import { openDatabase } from "../src/server/db/connection";
import { hashPassword } from "../src/server/auth/passwords";
import { seedDemoMenu } from "../src/server/cli/seed-demo";
import type { FetchLike } from "../src/server/whatsapp/cloud-api";
import type { OrderSubmissionInput } from "../src/shared/schemas";
import type { PublicMenuDto } from "../src/shared/types";

export const PASSWORD = "correct-horse-battery";

export interface TestContext {
  app: ReturnType<typeof createApp>;
  services: Services;
  logs: string[];
  request: (path: string, init?: RequestInit & { cookie?: string }) => Promise<Response>;
  login: (email: string, password?: string) => Promise<string>;
  menu: () => Promise<PublicMenuDto>;
}

/** Default test clock: 2026-10-13 12:00 in Maputo (kitchen open, lunch time). */
export const TEST_NOW = new Date("2026-10-13T10:00:00.000Z");

export async function makeTestContext(
  options: { env?: Record<string, string>; fetchImpl?: FetchLike; now?: () => Date } = {},
): Promise<TestContext> {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_PATH: ":memory:",
    UPLOADS_DIR: mkdtempSync(join(tmpdir(), "np-uploads-")),
    STATIC_DIR: join(tmpdir(), "np-no-static"),
    ...options.env,
  });
  const db = openDatabase(":memory:");
  const logs: string[] = [];
  const deps = { fetchImpl: options.fetchImpl, log: (m: string) => void logs.push(m), now: options.now ?? (() => TEST_NOW) };
  const services = createServices(config, db, deps);
  const app = createApp(services, deps);

  seedDemoMenu(db);
  const hash = await hashPassword(PASSWORD);
  services.staffRepo.create({ email: "admin@test.local", displayName: "Admin", role: "admin", passwordHash: hash, createdBy: null });
  services.staffRepo.create({ email: "reception@test.local", displayName: "Recepção", role: "reception", passwordHash: hash, createdBy: null });

  const request = (path: string, init: RequestInit & { cookie?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.body && typeof init.body === "string" && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (!headers.has("x-np-request")) headers.set("x-np-request", "1");
    if (init.cookie) headers.set("cookie", init.cookie);
    return Promise.resolve(app.request(path, { ...init, headers }));
  };

  const login = async (email: string, password = PASSWORD) => {
    const res = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`);
    const cookie = res.headers.get("set-cookie")!;
    return cookie.split(";")[0]!;
  };

  const menu = async () => (await (await request("/api/menu")).json()) as PublicMenuDto;

  return { app, services, logs, request, login, menu };
}

export function productByName(menu: PublicMenuDto, pt: string) {
  const product = menu.products.find((p) => p.name.pt === pt);
  if (!product) throw new Error(`product ${pt} not in menu`);
  return product;
}

export function buildSubmission(overrides: Partial<OrderSubmissionInput> = {}): OrderSubmissionInput {
  return {
    idempotencyKey: randomUUID(),
    language: "pt",
    location: { type: "room", label: "12" },
    guestName: "Ana",
    contactPhone: null,
    notes: null,
    items: [],
    ...overrides,
  };
}
