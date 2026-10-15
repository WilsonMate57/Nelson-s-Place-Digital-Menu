import { basename } from "node:path";
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
  roleInputSchema,
  purgeQuerySchema,
  purgeSchema,
} from "../../shared/schemas";
import type { Permission } from "../../shared/permissions";
import type { ProductInput } from "../../shared/schemas";
import type { AdminProductDto } from "../../shared/types";
import { buildWhatsAppLink } from "../../shared/whatsapp-message";
import { hashPassword } from "../auth/passwords";
import { badRequest, conflict, forbidden, notFound } from "../http/errors";
import { parseId, readJson, requireCsrfHeader, requirePermission, requireStaff, validate, type AppEnv } from "../http/middleware";
import { hashToken } from "../services/auth-service";
import { HOTEL_UTC_OFFSET } from "../services/order-service";
import { MAX_IMAGE_BYTES } from "../services/image-store";
import type { Services } from "../app";

/** True if the edit changes the base price or any option surcharge. */
function changesPrices(before: AdminProductDto | null, input: ProductInput): boolean {
  if (!before) return true;
  if (before.priceCents !== input.priceCents) return true;
  const deltas = new Map(before.optionGroups.flatMap((g) => g.options).map((o) => [o.id, o.priceDeltaCents]));
  return input.optionGroups.some((g) => g.options.some((o) => (o.id === undefined ? o.priceDeltaCents > 0 : deltas.get(o.id) !== o.priceDeltaCents)));
}

/**
 * Staff endpoints. Every route requires a valid session and the permission
 * named on it (see src/shared/permissions.ts); roles are editable profiles.
 */
export function adminRoutes(s: Services) {
  const app = new Hono<AppEnv>();
  const can = (...p: Permission[]) => requirePermission(...p);
  /** Runs a staff/role change and undoes it if nobody active could manage staff any more. */
  const keepStaffManager = (change: () => void) =>
    s.db.transaction(() => {
      change();
      if (s.staffRepo.countActiveWith("staff.manage") === 0) {
        throw conflict("LAST_ADMIN", "Tem de existir pelo menos uma pessoa activa que possa gerir a equipa.");
      }
    })();

  app.use("*", requireCsrfHeader(), requireStaff(s.auth));
  app.use("*", bodyLimit({ maxSize: MAX_IMAGE_BYTES + 64 * 1024, onError: () => { throw badRequest("BODY_TOO_LARGE", "Pedido demasiado grande"); } }));

  // --- Orders -------------------------------------------------------------

  app.get("/orders", can("orders.view"), (c) => {
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

  app.get("/orders/:id", can("orders.view"), (c) => c.json(s.orders.detail(parseId(c.req.param("id")))));

  app.post("/orders/:id/status", can("orders.status", "orders.cancel"), async (c) => {
    const id = parseId(c.req.param("id"));
    const input = await readJson(c, orderStatusUpdateSchema);
    const staff = c.get("staff");
    const needed: Permission = input.to === "CANCELLED" ? "orders.cancel" : "orders.status";
    if (!staff.permissions.includes(needed)) throw forbidden();
    const result = s.orders.changeStatus(id, input.expectedStatus, input.to, staff.id, input.note);
    return c.json(result);
  });

  // --- Chat with the guest ---------------------------------------------------

  app.get("/orders/:id/messages", can("orders.view"), (c) => c.json(s.chat.staffThread(parseId(c.req.param("id")))));

  app.post("/orders/:id/messages", can("chat.reply"), async (c) => {
    const id = parseId(c.req.param("id"));
    const { body } = await readJson(c, chatMessageSchema);
    return c.json(s.chat.staffSend(id, c.get("staff").id, body), 201);
  });

  /** Staff confirm they received the take-away deposit (checked in M-Pesa, bank, etc.). */
  app.post("/orders/:id/deposit/confirm", can("orders.deposit"), (c) => {
    const id = parseId(c.req.param("id"));
    const result = s.orders.confirmDeposit(id, c.get("staff").id);
    s.auditRepo.record(c.get("staff").id, "deposit_confirmed", "order", id, { depositCents: result.depositCents, reference: result.paymentReference });
    return c.json(result);
  });

  app.get("/orders/:id/whatsapp", can("orders.view"), (c) => {
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

  app.post("/orders/:id/whatsapp/retry", can("orders.status"), async (c) => {
    const id = parseId(c.req.param("id"));
    const status = await s.whatsapp.retry(id);
    s.auditRepo.record(c.get("staff").id, "whatsapp_retry", "order", id, { status });
    return c.json(s.orders.detail(id));
  });

  // --- Menu ---------------------------------------------------------------

  app.get("/menu", can("menu.availability", "menu.edit", "orders.view"), (c) =>
    c.json({
      categories: s.menuRepo.listCategories(true),
      products: s.menuRepo.listProducts({ includeArchived: true, activeCategoriesOnly: false }),
    }),
  );

  app.patch("/products/:id/availability", can("menu.availability", "menu.edit"), async (c) => {
    const id = parseId(c.req.param("id"));
    const { isAvailable } = await readJson(c, availabilitySchema);
    s.menuRepo.setAvailability(id, isAvailable);
    s.auditRepo.record(c.get("staff").id, "product_availability", "product", id, { isAvailable });
    return c.json(s.menuRepo.getProduct(id));
  });

  app.post("/products", can("menu.edit"), async (c) => {
    const input = await readJson(c, productInputSchema);
    if (changesPrices(null, input) && !c.get("staff").permissions.includes("menu.prices")) {
      throw forbidden("Criar um artigo define o seu preço: precisa da permissão «Alterar preços».");
    }
    const id = s.menuRepo.createProduct(input);
    s.auditRepo.record(c.get("staff").id, "product_created", "product", id, { name: input.name.pt, priceCents: input.priceCents });
    return c.json(s.menuRepo.getProduct(id), 201);
  });

  app.put("/products/:id", can("menu.edit"), async (c) => {
    const id = parseId(c.req.param("id"));
    const input = await readJson(c, productInputSchema);
    const before = s.menuRepo.getProduct(id);
    if (changesPrices(before, input) && !c.get("staff").permissions.includes("menu.prices")) {
      throw forbidden("Não tem permissão para alterar preços.");
    }
    s.menuRepo.updateProduct(id, input);
    s.auditRepo.record(c.get("staff").id, "product_updated", "product", id, {
      name: input.name.pt,
      priceCents: { from: before.priceCents, to: input.priceCents },
    });
    return c.json(s.menuRepo.getProduct(id));
  });

  app.post("/products/:id/archive", can("menu.edit"), (c) => {
    const id = parseId(c.req.param("id"));
    s.menuRepo.setArchived(id, true);
    s.auditRepo.record(c.get("staff").id, "product_archived", "product", id);
    return c.json(s.menuRepo.getProduct(id));
  });

  app.post("/products/:id/restore", can("menu.edit"), (c) => {
    const id = parseId(c.req.param("id"));
    s.menuRepo.setArchived(id, false);
    s.auditRepo.record(c.get("staff").id, "product_restored", "product", id);
    return c.json(s.menuRepo.getProduct(id));
  });

  app.post("/products/:id/image", can("menu.edit"), async (c) => {
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

  app.delete("/products/:id/image", can("menu.edit"), async (c) => {
    const id = parseId(c.req.param("id"));
    const previous = s.menuRepo.getImagePath(id);
    s.menuRepo.setImagePath(id, null);
    await s.images.remove(previous);
    s.auditRepo.record(c.get("staff").id, "product_image_removed", "product", id);
    return c.json(s.menuRepo.getProduct(id));
  });

  app.post("/categories", can("menu.edit"), async (c) => {
    const input = await readJson(c, categoryInputSchema);
    const id = s.menuRepo.createCategory(input);
    s.auditRepo.record(c.get("staff").id, "category_created", "category", id, { name: input.name.pt });
    return c.json({ id }, 201);
  });

  app.put("/categories/:id", can("menu.edit"), async (c) => {
    const id = parseId(c.req.param("id"));
    const input = await readJson(c, categoryInputSchema);
    s.menuRepo.updateCategory(id, input);
    s.auditRepo.record(c.get("staff").id, "category_updated", "category", id, { name: input.name.pt, isActive: input.isActive });
    return c.json({ id });
  });

  app.delete("/categories/:id", can("menu.edit"), (c) => {
    const id = parseId(c.req.param("id"));
    s.menuRepo.deleteCategory(id);
    s.auditRepo.record(c.get("staff").id, "category_deleted", "category", id);
    return c.body(null, 204);
  });

  // --- Staff (admin) -------------------------------------------------------

  app.get("/staff", can("staff.manage"), (c) => c.json(s.staffRepo.list()));

  app.post("/staff", can("staff.manage"), async (c) => {
    const input = await readJson(c, staffCreateSchema);
    if (s.staffRepo.findByEmail(input.email)) throw conflict("EMAIL_TAKEN", "Já existe um utilizador com este email");
    s.roleRepo.get(input.roleId);
    const id = s.staffRepo.create({
      email: input.email,
      displayName: input.displayName,
      roleId: input.roleId,
      passwordHash: await hashPassword(input.password),
      createdBy: c.get("staff").id,
    });
    s.auditRepo.record(c.get("staff").id, "staff_created", "staff", id, { email: input.email, roleId: input.roleId });
    return c.json({ id }, 201);
  });

  app.put("/staff/:id", can("staff.manage"), async (c) => {
    const id = parseId(c.req.param("id"));
    const input = await readJson(c, staffUpdateSchema);
    const target = s.staffRepo.findById(id);
    if (!target) throw notFound("Utilizador não encontrado");
    s.roleRepo.get(input.roleId);
    keepStaffManager(() => s.staffRepo.update(id, input));
    if (!input.isActive) s.staffRepo.deleteSessionsForStaff(id);
    s.auditRepo.record(c.get("staff").id, "staff_updated", "staff", id, input);
    return c.json({ id });
  });

  app.post("/staff/:id/password", can("staff.manage"), async (c) => {
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

  // Every signed-in staff member reads settings (currency, the orders on/off switch).
  app.get("/settings", (c) => c.json({ ...s.settingsRepo.get(), whatsappMode: s.whatsapp.mode }));

  app.put("/settings", can("settings.manage"), async (c) => {
    const input = await readJson(c, settingsInputSchema);
    const saved = s.settingsRepo.save(input, c.get("staff").id);
    s.auditRepo.record(c.get("staff").id, "settings_updated", "settings", "general", saved);
    return c.json({ ...saved, whatsappMode: s.whatsapp.mode });
  });

  /** Any staff member can pause/resume ordering (e.g. kitchen closed). */
  app.patch("/settings/orders-enabled", can("orders.pause"), async (c) => {
    const { ordersEnabled } = await readJson(c, ordersEnabledSchema);
    const current = s.settingsRepo.get();
    const { currency: _currency, ...rest } = current;
    const saved = s.settingsRepo.save({ ...rest, ordersEnabled }, c.get("staff").id);
    s.auditRepo.record(c.get("staff").id, ordersEnabled ? "orders_resumed" : "orders_paused", "settings", "general");
    return c.json({ ...saved, whatsappMode: s.whatsapp.mode });
  });

  app.get("/audit", can("audit.view"), (c) => c.json(s.auditRepo.recent(200)));

  // --- Data clean-up (e.g. test orders before opening) ----------------------

  app.get("/maintenance/orders", can("settings.manage"), (c) => {
    const { from, to, scope } = validate(purgeQuerySchema, c.req.query());
    return c.json(s.maintenance.previewPurge(from, to, scope));
  });

  app.post("/maintenance/orders/delete", can("settings.manage"), async (c) => {
    const { from, to, scope } = await readJson(c, purgeSchema);
    const result = await s.maintenance.purge(from, to, scope);
    s.auditRepo.record(c.get("staff").id, "orders_deleted", "order", null, {
      from,
      to,
      scope,
      deleted: result.deleted,
      backup: result.backupFile ? basename(result.backupFile) : null,
    });
    return c.json(result);
  });

  // --- Access profiles (perfis) ---------------------------------------------

  app.get("/roles", can("staff.manage"), (c) => c.json(s.roleRepo.list()));

  app.post("/roles", can("staff.manage"), async (c) => {
    const input = await readJson(c, roleInputSchema);
    const id = s.roleRepo.create(input);
    s.auditRepo.record(c.get("staff").id, "role_created", "role", id, input);
    return c.json(s.roleRepo.get(id), 201);
  });

  app.put("/roles/:id", can("staff.manage"), async (c) => {
    const id = parseId(c.req.param("id"));
    const input = await readJson(c, roleInputSchema);
    keepStaffManager(() => s.roleRepo.update(id, input));
    s.auditRepo.record(c.get("staff").id, "role_updated", "role", id, input);
    return c.json(s.roleRepo.get(id));
  });

  app.delete("/roles/:id", can("staff.manage"), (c) => {
    const id = parseId(c.req.param("id"));
    s.roleRepo.delete(id);
    s.auditRepo.record(c.get("staff").id, "role_deleted", "role", id);
    return c.body(null, 204);
  });

  // --- Reports (include sales figures) --------------------------------------

  app.get("/reports", can("reports.view"), (c) => {
    const { from, to } = validate(reportQuerySchema, c.req.query());
    return c.json(s.reports.build(from, to));
  });

  app.get("/reports/daily-summary", can("reports.view"), (c) => c.json(s.dailySummary.status()));

  /** Sends the summary for a day now (e.g. to test the configuration). */
  app.post("/reports/daily-summary/send", can("reports.export"), async (c) => {
    const { day } = await readJson(c, dailySummarySendSchema);
    const status = await s.dailySummary.send(day);
    s.auditRepo.record(c.get("staff").id, "daily_summary_sent_manually", "report", day, { status });
    return c.json(s.dailySummary.status());
  });

  app.get("/reports/orders.csv", can("reports.export"), (c) => {
    const { from, to } = validate(reportQuerySchema, c.req.query());
    s.auditRepo.record(c.get("staff").id, "report_exported", "report", null, { from, to });
    return c.body(s.reports.csv(from, to), 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pedidos-${from}-a-${to}.csv"`,
    });
  });

  return app;
}
