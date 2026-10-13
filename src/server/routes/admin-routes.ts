import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  availabilitySchema,
  chatMessageSchema,
  categoryInputSchema,
  orderListQuerySchema,
  orderStatusUpdateSchema,
  ordersEnabledSchema,
  productInputSchema,
  reportQuerySchema,
  dailySummarySendSchema,
  settingsInputSchema,
  staffCreateSchema,
  staffPasswordResetSchema,
  staffUpdateSchema,
} from "../../shared/schemas";
import { buildWhatsAppLink } from "../../shared/whatsapp-message";
import { hashPassword } from "../auth/passwords";
import { badRequest, conflict, notFound } from "../http/errors";
import { parseId, readJson, requireCsrfHeader, requireRole, requireStaff, validate, type AppEnv } from "../http/middleware";
import { hashToken } from "../services/auth-service";
import { HOTEL_UTC_OFFSET } from "../services/order-service";
import { MAX_IMAGE_BYTES } from "../services/image-store";
import type { Services } from "../app";

/**
 * Staff endpoints. Every route requires a valid session; menu structure,
 * prices, staff and settings additionally require the `admin` role.
 */
export function adminRoutes(s: Services) {
  const app = new Hono<AppEnv>();
  const adminOnly = requireRole("admin");

  app.use("*", requireCsrfHeader(), requireStaff(s.auth));
  app.use("*", bodyLimit({ maxSize: MAX_IMAGE_BYTES + 64 * 1024, onError: () => { throw badRequest("BODY_TOO_LARGE", "Pedido demasiado grande"); } }));

  // --- Orders (all staff roles) -------------------------------------------

  app.get("/orders", (c) => {
    const q = validate(orderListQuerySchema, c.req.query());
    return c.json(
      s.orders.list({
        status: q.status,
        q: q.q || undefined,
        fromIso: q.from ? new Date(`${q.from}T00:00:00${HOTEL_UTC_OFFSET}`).toISOString() : undefined,
        toIso: q.to ? new Date(`${q.to}T23:59:59.999${HOTEL_UTC_OFFSET}`).toISOString() : undefined,
        limit: q.limit,
      }),
    );
  });

  app.get("/orders/:id", (c) => c.json(s.orders.detail(parseId(c.req.param("id")))));

  app.post("/orders/:id/status", async (c) => {
    const id = parseId(c.req.param("id"));
    const input = await readJson(c, orderStatusUpdateSchema);
    const staff = c.get("staff");
    const result = s.orders.changeStatus(id, input.expectedStatus, input.to, staff.id, input.note);
    return c.json(result);
  });

  // --- Chat with the guest (all staff roles) ---------------------------------

  app.get("/orders/:id/messages", (c) => c.json(s.chat.staffThread(parseId(c.req.param("id")))));

  app.post("/orders/:id/messages", async (c) => {
    const id = parseId(c.req.param("id"));
    const { body } = await readJson(c, chatMessageSchema);
    return c.json(s.chat.staffSend(id, c.get("staff").id, body), 201);
  });

  /** Staff confirm they received the take-away deposit (checked in M-Pesa, bank, etc.). */
  app.post("/orders/:id/deposit/confirm", (c) => {
    const id = parseId(c.req.param("id"));
    const result = s.orders.confirmDeposit(id, c.get("staff").id);
    s.auditRepo.record(c.get("staff").id, "deposit_confirmed", "order", id, { depositCents: result.depositCents, reference: result.paymentReference });
    return c.json(result);
  });

  app.get("/orders/:id/whatsapp", (c) => {
    const id = parseId(c.req.param("id"));
    const order = s.ordersRepo.get(id);
    if (!order) throw notFound("Pedido não encontrado");
    const text = s.whatsapp.message(order, true);
    const number = s.settingsRepo.get().whatsappNumber || null;
    return c.json({
      text,
      // Opens WhatsApp with the text so staff can forward it to any chat (e.g. the kitchen).
      shareUrl: buildWhatsAppLink(null, text),
      hotelUrl: number ? buildWhatsAppLink(number, text) : null,
      mode: s.whatsapp.mode,
    });
  });

  app.post("/orders/:id/whatsapp/retry", async (c) => {
    const id = parseId(c.req.param("id"));
    const status = await s.whatsapp.retry(id);
    s.auditRepo.record(c.get("staff").id, "whatsapp_retry", "order", id, { status });
    return c.json(s.orders.detail(id));
  });

  // --- Menu (read + availability: all staff; edits: admin) ----------------

  app.get("/menu", (c) =>
    c.json({
      categories: s.menuRepo.listCategories(true),
      products: s.menuRepo.listProducts({ includeArchived: true, activeCategoriesOnly: false }),
    }),
  );

  app.patch("/products/:id/availability", async (c) => {
    const id = parseId(c.req.param("id"));
    const { isAvailable } = await readJson(c, availabilitySchema);
    s.menuRepo.setAvailability(id, isAvailable);
    s.auditRepo.record(c.get("staff").id, "product_availability", "product", id, { isAvailable });
    return c.json(s.menuRepo.getProduct(id));
  });

  app.post("/products", adminOnly, async (c) => {
    const input = await readJson(c, productInputSchema);
    const id = s.menuRepo.createProduct(input);
    s.auditRepo.record(c.get("staff").id, "product_created", "product", id, { name: input.name.pt, priceCents: input.priceCents });
    return c.json(s.menuRepo.getProduct(id), 201);
  });

  app.put("/products/:id", adminOnly, async (c) => {
    const id = parseId(c.req.param("id"));
    const input = await readJson(c, productInputSchema);
    const before = s.menuRepo.getProduct(id);
    s.menuRepo.updateProduct(id, input);
    s.auditRepo.record(c.get("staff").id, "product_updated", "product", id, {
      name: input.name.pt,
      priceCents: { from: before.priceCents, to: input.priceCents },
    });
    return c.json(s.menuRepo.getProduct(id));
  });

  app.post("/products/:id/archive", adminOnly, (c) => {
    const id = parseId(c.req.param("id"));
    s.menuRepo.setArchived(id, true);
    s.auditRepo.record(c.get("staff").id, "product_archived", "product", id);
    return c.json(s.menuRepo.getProduct(id));
  });

  app.post("/products/:id/restore", adminOnly, (c) => {
    const id = parseId(c.req.param("id"));
    s.menuRepo.setArchived(id, false);
    s.auditRepo.record(c.get("staff").id, "product_restored", "product", id);
    return c.json(s.menuRepo.getProduct(id));
  });

  app.post("/products/:id/image", adminOnly, async (c) => {
    const id = parseId(c.req.param("id"));
    const previous = s.menuRepo.getImagePath(id);
    const body = await c.req.parseBody();
    const file = body["image"];
    if (!(file instanceof File)) throw badRequest("IMAGE_MISSING", "Envie um ficheiro no campo 'image'");
    const path = await s.images.save(new Uint8Array(await file.arrayBuffer()));
    s.menuRepo.setImagePath(id, path);
    await s.images.remove(previous);
    s.auditRepo.record(c.get("staff").id, "product_image_updated", "product", id);
    return c.json(s.menuRepo.getProduct(id));
  });

  app.delete("/products/:id/image", adminOnly, async (c) => {
    const id = parseId(c.req.param("id"));
    const previous = s.menuRepo.getImagePath(id);
    s.menuRepo.setImagePath(id, null);
    await s.images.remove(previous);
    s.auditRepo.record(c.get("staff").id, "product_image_removed", "product", id);
    return c.json(s.menuRepo.getProduct(id));
  });

  app.post("/categories", adminOnly, async (c) => {
    const input = await readJson(c, categoryInputSchema);
    const id = s.menuRepo.createCategory(input);
    s.auditRepo.record(c.get("staff").id, "category_created", "category", id, { name: input.name.pt });
    return c.json({ id }, 201);
  });

  app.put("/categories/:id", adminOnly, async (c) => {
    const id = parseId(c.req.param("id"));
    const input = await readJson(c, categoryInputSchema);
    s.menuRepo.updateCategory(id, input);
    s.auditRepo.record(c.get("staff").id, "category_updated", "category", id, { name: input.name.pt, isActive: input.isActive });
    return c.json({ id });
  });

  app.delete("/categories/:id", adminOnly, (c) => {
    const id = parseId(c.req.param("id"));
    s.menuRepo.deleteCategory(id);
    s.auditRepo.record(c.get("staff").id, "category_deleted", "category", id);
    return c.body(null, 204);
  });

  // --- Staff (admin) -------------------------------------------------------

  app.get("/staff", adminOnly, (c) => c.json(s.staffRepo.list()));

  app.post("/staff", adminOnly, async (c) => {
    const input = await readJson(c, staffCreateSchema);
    if (s.staffRepo.findByEmail(input.email)) throw conflict("EMAIL_TAKEN", "Já existe um utilizador com este email");
    const id = s.staffRepo.create({
      email: input.email,
      displayName: input.displayName,
      role: input.role,
      passwordHash: await hashPassword(input.password),
      createdBy: c.get("staff").id,
    });
    s.auditRepo.record(c.get("staff").id, "staff_created", "staff", id, { email: input.email, role: input.role });
    return c.json({ id }, 201);
  });

  app.put("/staff/:id", adminOnly, async (c) => {
    const id = parseId(c.req.param("id"));
    const input = await readJson(c, staffUpdateSchema);
    const target = s.staffRepo.findById(id);
    if (!target) throw notFound("Utilizador não encontrado");
    const losesAdmin = target.role === "admin" && target.isActive && (input.role !== "admin" || !input.isActive);
    if (losesAdmin && s.staffRepo.countActiveAdmins() <= 1) {
      throw conflict("LAST_ADMIN", "Tem de existir pelo menos um administrador activo.");
    }
    s.staffRepo.update(id, input);
    if (!input.isActive) s.staffRepo.deleteSessionsForStaff(id);
    s.auditRepo.record(c.get("staff").id, "staff_updated", "staff", id, input);
    return c.json({ id });
  });

  app.post("/staff/:id/password", adminOnly, async (c) => {
    const id = parseId(c.req.param("id"));
    const { password } = await readJson(c, staffPasswordResetSchema);
    if (!s.staffRepo.findById(id)) throw notFound("Utilizador não encontrado");
    s.staffRepo.setPasswordHash(id, await hashPassword(password));
    // Sign the user out everywhere, except the admin's own current session.
    s.staffRepo.deleteSessionsForStaff(id, id === c.get("staff").id ? hashToken(c.get("sessionToken")) : undefined);
    s.auditRepo.record(c.get("staff").id, "staff_password_reset", "staff", id);
    return c.body(null, 204);
  });

  // --- Settings ------------------------------------------------------------

  app.get("/settings", (c) => c.json({ ...s.settingsRepo.get(), whatsappMode: s.whatsapp.mode }));

  app.put("/settings", adminOnly, async (c) => {
    const input = await readJson(c, settingsInputSchema);
    const saved = s.settingsRepo.save(input, c.get("staff").id);
    s.auditRepo.record(c.get("staff").id, "settings_updated", "settings", "general", saved);
    return c.json({ ...saved, whatsappMode: s.whatsapp.mode });
  });

  /** Any staff member can pause/resume ordering (e.g. kitchen closed). */
  app.patch("/settings/orders-enabled", async (c) => {
    const { ordersEnabled } = await readJson(c, ordersEnabledSchema);
    const current = s.settingsRepo.get();
    const { currency: _currency, ...rest } = current;
    const saved = s.settingsRepo.save({ ...rest, ordersEnabled }, c.get("staff").id);
    s.auditRepo.record(c.get("staff").id, ordersEnabled ? "orders_resumed" : "orders_paused", "settings", "general");
    return c.json({ ...saved, whatsappMode: s.whatsapp.mode });
  });

  app.get("/audit", adminOnly, (c) => c.json(s.auditRepo.recent(200)));

  // --- Reports (admin: they include sales figures) --------------------------

  app.get("/reports", adminOnly, (c) => {
    const { from, to } = validate(reportQuerySchema, c.req.query());
    return c.json(s.reports.build(from, to));
  });

  app.get("/reports/daily-summary", adminOnly, (c) => c.json(s.dailySummary.status()));

  /** Sends the summary for a day now (e.g. to test the configuration). */
  app.post("/reports/daily-summary/send", adminOnly, async (c) => {
    const { day } = await readJson(c, dailySummarySendSchema);
    const status = await s.dailySummary.send(day);
    s.auditRepo.record(c.get("staff").id, "daily_summary_sent_manually", "report", day, { status });
    return c.json(s.dailySummary.status());
  });

  app.get("/reports/orders.csv", adminOnly, (c) => {
    const { from, to } = validate(reportQuerySchema, c.req.query());
    s.auditRepo.record(c.get("staff").id, "report_exported", "report", null, { from, to });
    return c.body(s.reports.csv(from, to), 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pedidos-${from}-a-${to}.csv"`,
    });
  });

  return app;
}
