import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { chatMessageSchema, orderSubmissionSchema } from "../../shared/schemas";
import type { PublicMenuDto, PublicSettings } from "../../shared/types";
import { AppError, badRequest } from "../http/errors";
import { RateLimiter, clientIp, rateLimit, readJson } from "../http/middleware";
import type { Services } from "../app";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** Guest-facing endpoints. No authentication; everything is validated and rate-limited. */
export function publicRoutes(s: Services) {
  const app = new Hono();
  const ip = (c: Parameters<typeof clientIp>[0]) => clientIp(c, s.config.trustProxy);
  // Generous limits: many guests may share the hotel Wi-Fi's public IP.
  const orderLimiter = new RateLimiter(30, 10 * 60_000);
  const trackLimiter = new RateLimiter(300, 10 * 60_000);

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/menu", (c) => {
    const settings = s.settingsRepo.get();
    const publicSettings: PublicSettings = {
      hotelName: settings.hotelName,
      currency: settings.currency,
      currencySymbol: settings.currencySymbol,
      ordersEnabled: settings.ordersEnabled,
      ordersPausedMessage: settings.ordersPausedMessage,
      locationTypes: settings.locationTypes,
      requireGuestName: settings.requireGuestName,
      requireContactPhone: settings.requireContactPhone,
      charges: settings.charges,
      preOrdersEnabled: settings.preOrdersEnabled,
      kitchenOpen: settings.kitchenOpen,
      kitchenClose: settings.kitchenClose,
      minLeadMinutes: settings.minLeadMinutes,
      maxDaysAhead: settings.maxDaysAhead,
      // Take-away is only offered once the hotel has said how to pay the deposit.
      takeawayEnabled: settings.takeawayEnabled && settings.paymentInstructions !== null,
      takeawayDepositPercent: settings.takeawayDepositPercent,
      paymentInstructions: settings.paymentInstructions,
      whatsappContactNumber: settings.whatsappNumber || null,
      whatsappMode: s.whatsapp.mode,
    };
    const products = s.menuRepo
      .listProducts({ includeArchived: false, activeCategoriesOnly: true })
      .map(({ isArchived: _a, createdAt: _c, updatedAt: _u, ...p }) => p);
    const body: PublicMenuDto = {
      settings: publicSettings,
      categories: s.menuRepo.listCategories(false).map(({ productCount: _n, createdAt: _c, updatedAt: _u, ...cat }) => cat),
      products,
    };
    return c.json(body);
  });

  app.post(
    "/orders",
    bodyLimit({ maxSize: 64 * 1024, onError: () => { throw badRequest("BODY_TOO_LARGE", "Pedido demasiado grande"); } }),
    rateLimit(orderLimiter, (c) => `order:${ip(c)}`),
    async (c) => {
      const submission = await readJson(c, orderSubmissionSchema);
      const result = s.orders.submit(submission);
      return c.json(result.order, result.created ? 201 : 200);
    },
  );

  app.get("/orders/track/:token", rateLimit(trackLimiter, (c) => `track:${ip(c)}`), (c) => {
    const token = c.req.param("token");
    if (!TOKEN_PATTERN.test(token)) throw new AppError(404, "NOT_FOUND", "Pedido não encontrado");
    return c.json(s.orders.guestStatus(token));
  });

  // Chat with the hotel about this order (the private token identifies the guest).
  const chatLimiter = new RateLimiter(60, 10 * 60_000);
  app.get("/orders/track/:token/messages", rateLimit(trackLimiter, (c) => `track:${ip(c)}`), (c) => {
    const token = c.req.param("token");
    if (!TOKEN_PATTERN.test(token)) throw new AppError(404, "NOT_FOUND", "Pedido não encontrado");
    return c.json(s.chat.guestThread(token));
  });
  app.post(
    "/orders/track/:token/messages",
    bodyLimit({ maxSize: 8 * 1024, onError: () => { throw badRequest("BODY_TOO_LARGE", "Mensagem demasiado grande"); } }),
    rateLimit(chatLimiter, (c) => `chat:${ip(c)}`),
    async (c) => {
      const token = c.req.param("token");
      if (!TOKEN_PATTERN.test(token)) throw new AppError(404, "NOT_FOUND", "Pedido não encontrado");
      const { body } = await readJson(c, chatMessageSchema);
      return c.json(s.chat.guestSend(token, body), 201);
    },
  );

  app.post("/orders/track/:token/whatsapp-opened", rateLimit(trackLimiter, (c) => `track:${ip(c)}`), (c) => {
    const token = c.req.param("token");
    if (!TOKEN_PATTERN.test(token)) throw new AppError(404, "NOT_FOUND", "Pedido não encontrado");
    s.orders.recordWhatsAppLinkOpened(token);
    return c.body(null, 204);
  });

  return app;
}
