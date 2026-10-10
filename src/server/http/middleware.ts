import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { z } from "zod";
import type { StaffRole } from "../../shared/constants";
import type { StaffDto } from "../../shared/types";
import type { AuthService } from "../services/auth-service";
import { AppError, badRequest, forbidden, unauthorized } from "./errors";

export type AppEnv = { Variables: { staff: StaffDto; sessionToken: string } };

export const SESSION_COOKIE = "np_session";
/** Custom header required on authenticated state-changing requests (CSRF defence in depth with SameSite=Strict). */
export const CSRF_HEADER = "x-np-request";

export function securityHeaders(isProduction: boolean): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("X-Frame-Options", "DENY");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    c.header(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ].join("; "),
    );
    if (isProduction) c.header("Strict-Transport-Security", "max-age=15552000");
    if (c.req.path.startsWith("/api/")) c.header("Cache-Control", "no-store");
  };
}

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    // Use the right-most entry: it is appended by our own proxy (nginx/Plesk).
    // Left-most entries are supplied by the client and can be forged.
    const forwarded = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (forwarded) return forwarded;
    const realIp = c.req.header("x-real-ip")?.trim();
    if (realIp) return realIp;
  }
  let address: string | undefined;
  try {
    address = getConnInfo(c).remote.address;
  } catch {
    // e.g. in-process test requests
  }
  if (!address && !warnedUnknownIp && process.env.NODE_ENV === "production") {
    warnedUnknownIp = true;
    console.warn(
      "Could not determine client IP addresses; all guests share one rate-limit bucket. " +
        "Set TRUST_PROXY=true behind Plesk/nginx (see docs/PLESK.md).",
    );
  }
  return address ?? "unknown";
}
let warnedUnknownIp = false;

/** Fixed-window, in-memory rate limiter. Adequate for a single-process deployment. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Returns seconds until reset if the limit is exceeded, otherwise null. */
  hit(key: string, now = Date.now()): number | null {
    if (this.hits.size > 10_000) this.sweep(now);
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return null;
    }
    entry.count++;
    return entry.count > this.max ? Math.ceil((entry.resetAt - now) / 1000) : null;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}

export function rateLimit(limiter: RateLimiter, keyOf: (c: Context) => string): MiddlewareHandler {
  return async (c, next) => {
    const retryAfter = limiter.hit(keyOf(c));
    if (retryAfter !== null) {
      c.header("Retry-After", String(retryAfter));
      throw new AppError(429, "RATE_LIMITED", "Demasiados pedidos. Aguarde um momento e tente novamente.");
    }
    await next();
  };
}

export function requireCsrfHeader(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.header(CSRF_HEADER) !== "1") {
      throw forbidden("Pedido rejeitado (cabeçalho de segurança em falta)");
    }
    await next();
  };
}

export function requireStaff(auth: AuthService): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const staff = token ? auth.authenticate(token) : null;
    if (!token || !staff) throw unauthorized();
    c.set("staff", staff);
    c.set("sessionToken", token);
    await next();
  };
}

export function requireRole(...roles: StaffRole[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!roles.includes(c.get("staff").role)) throw forbidden();
    await next();
  };
}

export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest("INVALID_JSON", "Corpo do pedido inválido");
  }
  return validate(schema, body);
}

export function validate<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(
      "VALIDATION_ERROR",
      "Dados inválidos",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}

export function parseId(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("INVALID_ID", "Identificador inválido");
  return id;
}
