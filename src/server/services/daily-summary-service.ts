import nodemailer from "nodemailer";
import { buildDailySummary, periodLabel } from "../../shared/daily-summary";
import { hotelClock, parseHm } from "../../shared/schedule";
import type { DailySummaryStatusDto } from "../../shared/types";
import type { AppConfig } from "../config";
import type { DailySummaryRepo } from "../repositories/daily-summary-repo";
import type { SettingsRepo } from "../repositories/settings-repo";
import { sanitiseTemplateParam, type CloudApiSender } from "../whatsapp/cloud-api";
import type { ReportService } from "./report-service";

/** Sends the summary after the kitchen closes, with this delay. */
const DELAY_AFTER_CLOSE_MIN = 15;
/** Automatic retries for a failed day (a manual "send now" is always allowed). */
const MAX_AUTO_ATTEMPTS = 3;

export type EmailSender = (to: string, subject: string, text: string) => Promise<void>;

/** SMTP sender built from the server configuration (null when SMTP is not configured). */
export function createEmailSender(smtp: AppConfig["smtp"]): EmailSender | null {
  if (!smtp.host || !smtp.from) return null;
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    connectionTimeout: 15_000,
  });
  return async (to, subject, text) => {
    await transport.sendMail({ from: smtp.from, to, subject, text });
  };
}

/**
 * Daily summary for the manager: built from the same report as the dashboard
 * and sent by the channels the server has configured (email via SMTP and/or
 * the WhatsApp Business Cloud API with an approved template). Every attempt
 * is logged; nothing is reported as sent unless a channel accepted it.
 */
export class DailySummaryService {
  constructor(
    private readonly reports: ReportService,
    private readonly settings: SettingsRepo,
    private readonly log: DailySummaryRepo,
    private readonly email: EmailSender | null,
    private readonly whatsapp: { sender: CloudApiSender; templateName: string } | null,
    private readonly now: () => Date = () => new Date(),
    private readonly logError: (message: string, error?: unknown) => void = console.error,
  ) {}

  status(): DailySummaryStatusDto {
    const s = this.settings.get();
    return {
      enabled: s.dailySummaryEnabled,
      channels: { email: this.email !== null, whatsapp: this.whatsapp !== null },
      sendsAt: sendTime(s.kitchenClose),
      recent: this.log.recent(7),
    };
  }

  /** Called periodically by the server; sends today's summary once it is due. */
  async tick(): Promise<void> {
    const s = this.settings.get();
    if (!s.dailySummaryEnabled) return;
    const { day, minutes } = hotelClock(this.now());
    if (minutes < dueMinutes(s.kitchenClose)) return;
    const previous = this.log.get(day);
    if (previous && (previous.status !== "failed" || previous.attempts >= MAX_AUTO_ATTEMPTS)) return;
    await this.send(day);
  }

  /** Builds and sends the summary for one hotel-local day. */
  async send(day: string): Promise<DailySummaryStatusDto["recent"][number]["status"]> {
    const s = this.settings.get();
    const report = this.reports.build(day, day);
    const text = buildDailySummary(report, { hotelName: s.hotelName, currencySymbol: s.currencySymbol });
    const subject = `${s.hotelName} — resumo do dia ${periodLabel(report)}`;

    const attempts: { channel: string; run: () => Promise<void> }[] = [];
    if (this.email && s.managerEmail) attempts.push({ channel: "email", run: () => this.email!(s.managerEmail, subject, text) });
    if (this.whatsapp && s.managerWhatsapp) {
      const { sender, templateName } = this.whatsapp;
      attempts.push({
        channel: "whatsapp",
        run: async () => {
          const result = await sender.send(s.managerWhatsapp, [periodLabel(report), sanitiseTemplateParam(text, 1000)], templateName);
          if (!result.ok) throw new Error(result.error ?? "WhatsApp API error");
        },
      });
    }
    if (attempts.length === 0) {
      this.log.record(day, "skipped", null, "Nenhum canal automático configurado (email SMTP ou WhatsApp Business) ou destinatário em falta.");
      return "skipped";
    }

    const sent: string[] = [];
    const errors: string[] = [];
    for (const a of attempts) {
      try {
        await a.run();
        sent.push(a.channel);
      } catch (err) {
        // Keep secrets out of the stored message: only the error text is kept.
        const message = err instanceof Error ? err.message.slice(0, 300) : "erro desconhecido";
        errors.push(`${a.channel}: ${message}`);
        this.logError(`Daily summary via ${a.channel} failed`, err);
      }
    }
    const status = sent.length > 0 ? "sent" : "failed";
    this.log.record(day, status, sent.join(",") || null, errors.join(" | ") || null);
    return status;
  }
}

/** Minutes after local midnight when the summary is due (capped at 23:59, same day). */
const dueMinutes = (kitchenClose: string) => Math.min(parseHm(kitchenClose) + DELAY_AFTER_CLOSE_MIN, 23 * 60 + 59);

export const sendTime = (kitchenClose: string) => {
  const m = dueMinutes(kitchenClose);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
