import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { changePasswordSchema, loginSchema } from "../../shared/schemas";
import { AppError } from "../http/errors";
import {
  RateLimiter,
  SESSION_COOKIE,
  clientIp,
  readJson,
  requireCsrfHeader,
  requireStaff,
  type AppEnv,
} from "../http/middleware";
import type { Services } from "../app";

export function authRoutes(s: Services) {
  const app = new Hono<AppEnv>();
  // Per IP and per account, so one attacker cannot lock out everyone on the hotel network.
  const ipLimiter = new RateLimiter(30, 15 * 60_000);
  const accountLimiter = new RateLimiter(8, 15 * 60_000);

  app.use("*", requireCsrfHeader());

  app.post("/login", async (c) => {
    const { email, password } = await readJson(c, loginSchema);
    const ip = clientIp(c, s.config.trustProxy);
    const retry = ipLimiter.hit(`ip:${ip}`) ?? accountLimiter.hit(`acct:${email}`);
    if (retry !== null) {
      c.header("Retry-After", String(retry));
      throw new AppError(429, "RATE_LIMITED", "Demasiadas tentativas. Aguarde alguns minutos.");
    }
    const result = await s.auth.login(email, password);
    accountLimiter.reset(`acct:${email}`);
    setCookie(c, SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: s.config.cookieSecure,
      sameSite: "Strict",
      path: `${s.config.basePath}/api`,
      expires: result.expiresAt,
    });
    return c.json({ staff: result.staff });
  });

  app.post("/logout", (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) s.auth.logout(token);
    deleteCookie(c, SESSION_COOKIE, { path: `${s.config.basePath}/api`, secure: s.config.cookieSecure });
    return c.body(null, 204);
  });

  app.get("/me", requireStaff(s.auth), (c) => c.json({ staff: c.get("staff") }));

  app.post("/password", requireStaff(s.auth), async (c) => {
    const input = await readJson(c, changePasswordSchema);
    await s.auth.changePassword(c.get("staff").id, c.get("sessionToken"), input.currentPassword, input.newPassword);
    return c.body(null, 204);
  });

  return app;
}
