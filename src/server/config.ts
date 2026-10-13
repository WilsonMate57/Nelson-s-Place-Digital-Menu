import { z } from "zod";
import { WHATSAPP_MODES } from "../shared/constants";

/**
 * Server configuration, read from environment variables only.
 * Secrets (WhatsApp token) live here and are never sent to the browser.
 */

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().default("data/nelsons-place.db"),
  UPLOADS_DIR: z.string().default("uploads"),
  STATIC_DIR: z.string().default("dist/client"),
  /** Public URL of the site, e.g. https://menu.example.co.mz — used for dashboard links in messages. */
  PUBLIC_BASE_URL: z.union([z.url(), z.literal("")]).default(""),
  /** Set to true when running behind Plesk/nginx/Passenger so X-Forwarded-For is trusted. */
  TRUST_PROXY: bool,
  /** Defaults to true in production. Set false only for local HTTP testing. */
  COOKIE_SECURE: z.enum(["true", "false", ""]).optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),

  WHATSAPP_MODE: z.enum(WHATSAPP_MODES).default("link"),
  WHATSAPP_CLOUD_API_TOKEN: z.string().default(""),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(""),
  WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v21.0"),
  WHATSAPP_TEMPLATE_NAME: z.string().default(""),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default("pt_PT"),
  /** Optional second template for the automatic daily summary (cloud_api mode). */
  WHATSAPP_SUMMARY_TEMPLATE_NAME: z.string().default(""),

  /** Optional SMTP account for emailing the daily summary to the manager. */
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_FROM: z.string().default(""),
});

export interface AppConfig {
  env: "development" | "production" | "test";
  host: string;
  port: number;
  databasePath: string;
  uploadsDir: string;
  staticDir: string;
  publicBaseUrl: string;
  trustProxy: boolean;
  cookieSecure: boolean;
  sessionTtlHours: number;
  whatsapp: {
    mode: (typeof WHATSAPP_MODES)[number];
    cloudApiToken: string;
    phoneNumberId: string;
    apiVersion: string;
    templateName: string;
    templateLanguage: string;
    summaryTemplateName: string;
  };
  smtp: { host: string; port: number; secure: boolean; user: string; pass: string; from: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const e = parsed.data;
  const config: AppConfig = {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    databasePath: e.DATABASE_PATH,
    uploadsDir: e.UPLOADS_DIR,
    staticDir: e.STATIC_DIR,
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/$/, ""),
    trustProxy: e.TRUST_PROXY,
    cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE === "true" : e.NODE_ENV === "production",
    sessionTtlHours: e.SESSION_TTL_HOURS,
    whatsapp: {
      mode: e.WHATSAPP_MODE,
      cloudApiToken: e.WHATSAPP_CLOUD_API_TOKEN,
      phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID,
      apiVersion: e.WHATSAPP_API_VERSION,
      templateName: e.WHATSAPP_TEMPLATE_NAME,
      templateLanguage: e.WHATSAPP_TEMPLATE_LANGUAGE,
      summaryTemplateName: e.WHATSAPP_SUMMARY_TEMPLATE_NAME,
    },
    smtp: {
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE,
      user: e.SMTP_USER,
      pass: e.SMTP_PASS,
      from: e.SMTP_FROM || e.SMTP_USER,
    },
  };
  if (config.whatsapp.mode === "cloud_api") {
    const missing = (["cloudApiToken", "phoneNumberId", "templateName"] as const).filter((k) => !config.whatsapp[k]);
    if (missing.length) {
      throw new Error(`WHATSAPP_MODE=cloud_api requires: ${missing.join(", ")} (see docs/WHATSAPP.md)`);
    }
  }
  return config;
}
