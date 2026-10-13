import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "./config";
import type { Db } from "./db/connection";
import { AppError } from "./http/errors";
import { securityHeaders } from "./http/middleware";
import { AuditRepo } from "./repositories/audit-repo";
import { IntegrationRepo } from "./repositories/integration-repo";
import { MenuRepo } from "./repositories/menu-repo";
import { OrdersRepo } from "./repositories/orders-repo";
import { ReportRepo } from "./repositories/report-repo";
import { MessagesRepo } from "./repositories/messages-repo";
import { ChatService } from "./services/chat-service";
import { DailySummaryRepo } from "./repositories/daily-summary-repo";
import { createEmailSender, DailySummaryService, type EmailSender } from "./services/daily-summary-service";
import { SettingsRepo } from "./repositories/settings-repo";
import { StaffRepo } from "./repositories/staff-repo";
import { adminRoutes } from "./routes/admin-routes";
import { authRoutes } from "./routes/auth-routes";
import { publicRoutes } from "./routes/public-routes";
import { AuthService } from "./services/auth-service";
import { ImageStore } from "./services/image-store";
import { OrderService } from "./services/order-service";
import { ReportService } from "./services/report-service";
import { CloudApiSender, type FetchLike } from "./whatsapp/cloud-api";
import { WhatsAppService } from "./whatsapp/whatsapp-service";

export interface Services {
  config: AppConfig;
  db: Db;
  menuRepo: MenuRepo;
  ordersRepo: OrdersRepo;
  settingsRepo: SettingsRepo;
  staffRepo: StaffRepo;
  auditRepo: AuditRepo;
  integrationRepo: IntegrationRepo;
  auth: AuthService;
  orders: OrderService;
  reports: ReportService;
  chat: ChatService;
  dailySummary: DailySummaryService;
  messagesRepo: MessagesRepo;
  whatsapp: WhatsAppService;
  images: ImageStore;
}

export interface AppDeps {
  /** Injected in tests to mock the WhatsApp Cloud API. */
  fetchImpl?: FetchLike;
  log?: (message: string, error?: unknown) => void;
  /** Injected in tests to fix the clock (kitchen hours, scheduling). */
  now?: () => Date;
  /** Injected in tests instead of the SMTP sender. */
  emailSender?: EmailSender | null;
}

export function createServices(config: AppConfig, db: Db, deps: AppDeps = {}): Services {
  const log = deps.log ?? ((message: string, error?: unknown) => console.error(`[${new Date().toISOString()}] ${message}`, error ?? ""));
  const menuRepo = new MenuRepo(db);
  const ordersRepo = new OrdersRepo(db, deps.now);
  const messagesRepo = new MessagesRepo(db, deps.now);
  const settingsRepo = new SettingsRepo(db);
  const staffRepo = new StaffRepo(db);
  const auditRepo = new AuditRepo(db);
  const integrationRepo = new IntegrationRepo(db);
  const sender =
    config.whatsapp.mode === "cloud_api"
      ? new CloudApiSender(
          {
            token: config.whatsapp.cloudApiToken,
            phoneNumberId: config.whatsapp.phoneNumberId,
            apiVersion: config.whatsapp.apiVersion,
            templateName: config.whatsapp.templateName,
            templateLanguage: config.whatsapp.templateLanguage,
          },
          deps.fetchImpl,
        )
      : null;
  const reports = new ReportService(new ReportRepo(db));
  const whatsapp = new WhatsAppService(config.whatsapp.mode, settingsRepo, ordersRepo, integrationRepo, sender, config.publicBaseUrl);
  return {
    config,
    db,
    menuRepo,
    ordersRepo,
    settingsRepo,
    staffRepo,
    auditRepo,
    integrationRepo,
    auth: new AuthService(staffRepo, auditRepo, config.sessionTtlHours),
    orders: new OrderService(db, menuRepo, ordersRepo, settingsRepo, whatsapp, log, deps.now),
    reports,
    dailySummary: new DailySummaryService(
      reports,
      settingsRepo,
      new DailySummaryRepo(db, deps.now),
      deps.emailSender !== undefined ? deps.emailSender : createEmailSender(config.smtp),
      sender && config.whatsapp.summaryTemplateName ? { sender, templateName: config.whatsapp.summaryTemplateName } : null,
      deps.now,
      log,
    ),
    chat: new ChatService(ordersRepo, messagesRepo, auditRepo, deps.now),
    messagesRepo,
    whatsapp,
    images: new ImageStore(config.uploadsDir),
  };
}

export function createApp(services: Services, deps: AppDeps = {}) {
  const { config } = services;
  const log = deps.log ?? ((message: string, error?: unknown) => console.error(`[${new Date().toISOString()}] ${message}`, error ?? ""));
  const app = new Hono();

  app.use("*", securityHeaders(config.env === "production"));

  app.route("/api", publicRoutes(services));
  app.route("/api/auth", authRoutes(services));
  app.route("/api/admin", adminRoutes(services));
  app.all("/api/*", () => {
    throw new AppError(404, "NOT_FOUND", "Endpoint inexistente");
  });

  // Uploaded product images. Names are random UUIDs, so they can be cached.
  app.use(
    "/uploads/*",
    serveStatic({
      root: config.uploadsDir,
      rewriteRequestPath: (path) => path.replace(/^\/uploads/, ""),
      onFound: (_path, c) => {
        c.header("Cache-Control", "public, max-age=2592000, immutable");
      },
    }),
  );

  // Built frontend (production). In development Vite serves the frontend instead.
  if (existsSync(config.staticDir)) {
    app.use(
      "/assets/*",
      serveStatic({
        root: config.staticDir,
        onFound: (_path, c) => {
          c.header("Cache-Control", "public, max-age=31536000, immutable");
        },
      }),
    );
    app.get("/admin", (c) => c.redirect("/admin/", 301));
    app.use(
      "*",
      serveStatic({
        root: config.staticDir,
        onFound: (path, c) => {
          if (path.endsWith(".html")) c.header("Cache-Control", "no-cache");
        },
      }),
    );
  }

  const notFoundPage = join(config.staticDir, "404.html");
  app.notFound((c) => {
    if (existsSync(notFoundPage)) return c.html(readFileSync(notFoundPage, "utf8"), 404);
    return c.text("404 — Página não encontrada", 404);
  });

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
    }
    // Never leak internals to the client.
    log(`Unhandled error on ${c.req.method} ${c.req.path}`, err);
    return c.json({ error: { code: "INTERNAL_ERROR", message: "Ocorreu um erro inesperado. Tente novamente." } }, 500);
  });

  return app;
}
