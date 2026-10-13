import { useEffect, useRef, useState } from "react";
import type { OrderStatus } from "../../shared/constants";
import { isFinalStatus } from "../../shared/order-status";
import type { GuestOrderDto } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { formatDateTime, formatTime } from "../lib/util";
import { useGuest } from "./context";
import { locationTypeKey, noticeTextKey, noticeTitleKey, statusKey } from "./i18n";

const STEPS: OrderStatus[] = ["PENDING", "CONFIRMED", "PREPARING", "READY", "COMPLETED"];
const POLL_MS = 15_000;

interface Props {
  token: string;
  initial: GuestOrderDto | null;
  onBackToMenu: () => void;
  onForget: () => void;
}

/** Order confirmation and live status, reachable later through ?order=<private token>. */
export function OrderStatusView({ token, initial, onBackToMenu, onForget }: Props) {
  const { t, money, language } = useGuest();
  const [order, setOrder] = useState<GuestOrderDto | null>(initial);
  const [error, setError] = useState<"notFound" | "network" | null>(null);
  /** Status change to announce; only set when the status changes while this page is open. */
  const [notice, setNotice] = useState<OrderStatus | null>(null);
  const lastStatus = useRef<OrderStatus | null>(initial?.status ?? null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const load = async () => {
      clearTimeout(timer);
      try {
        const next = await api<GuestOrderDto>(`/api/orders/track/${encodeURIComponent(token)}`);
        if (cancelled) return;
        if (lastStatus.current && lastStatus.current !== next.status) {
          setNotice(next.status);
          // Vibration works on most Android browsers; silently ignored elsewhere (e.g. iPhone).
          if (typeof navigator.vibrate === "function") navigator.vibrate(next.status === "READY" ? [250, 120, 250, 120, 250] : [200, 100, 200]);
        }
        lastStatus.current = next.status;
        setOrder(next);
        setError(null);
        if (isFinalStatus(next.status)) stopped = true;
        else timer = setTimeout(load, POLL_MS);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setError("notFound");
          stopped = true;
          return;
        }
        setError("network");
        timer = setTimeout(load, POLL_MS);
      }
    };
    // Phones pause timers in background tabs: refresh as soon as the guest returns.
    const onVisible = () => {
      if (document.visibilityState === "visible" && !stopped) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    // When we already have a fresh copy from submission, wait before polling.
    timer = setTimeout(load, initial ? POLL_MS : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token, initial]);

  // The tab title shows the current status, so it is visible even in another tab.
  const reference = order?.reference;
  const status = order?.status;
  useEffect(() => {
    if (!reference || !status) return;
    const previous = document.title;
    document.title = `${status === "READY" ? "✅ " : ""}${t(statusKey(status))} · ${reference}`;
    return () => {
      document.title = previous;
    };
  }, [reference, status, t]);

  if (error === "notFound") {
    return (
      <div className="container state-block">
        <h2>{t("orderNotFound")}</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            onForget();
            onBackToMenu();
          }}
        >
          {t("backToMenu")}
        </button>
      </div>
    );
  }
  if (!order) {
    return (
      <div className="container state-block" aria-busy="true">
        <span className="spinner" aria-hidden="true" />
        {error === "network" && <p>{t("loadError")}</p>}
      </div>
    );
  }

  const stepIndex = STEPS.indexOf(order.status);
  const cancelled = order.status === "CANCELLED";
  const locale = language === "pt" ? "pt-PT" : "en-GB";

  return (
    <main id="main" className="container order-view">
      {notice && (
        <div className={`status-notice status-notice-${notice}`} role="alert">
          <div className="status-notice-body">
            <strong>{t(noticeTitleKey(notice))}</strong>
            <span>{t(noticeTextKey(notice))}</span>
          </div>
          <button type="button" className="icon-btn" onClick={() => setNotice(null)} aria-label={t("close")}>
            ×
          </button>
        </div>
      )}
      <div className="order-card">
        <div className="order-check" aria-hidden="true">
          {cancelled ? "!" : "✓"}
        </div>
        <h1 className="order-title">{cancelled ? t("status_CANCELLED") : t("orderReceived")}</h1>
        <p className="muted">{cancelled ? t("cancelledText") : t("orderReceivedText")}</p>

        <dl className="order-meta">
          <div>
            <dt>{t("reference")}</dt>
            <dd className="order-ref">{order.reference}</dd>
          </div>
          <div>
            <dt>{order.locationType === "takeaway" ? t("receive") : t(locationTypeKey(order.locationType))}</dt>
            <dd>{order.locationType === "takeaway" ? t("takeawayLong") : order.locationLabel}</dd>
          </div>
          <div>
            <dt>{order.scheduledFor ? t("scheduledFor") : t("placedAt")}</dt>
            <dd>{order.scheduledFor ? formatDateTime(order.scheduledFor, locale) : formatTime(order.createdAt, locale)}</dd>
          </div>
        </dl>

        {order.depositCents > 0 && !cancelled && (
          <p className={order.depositStatus === "confirmed" ? "alert alert-success small" : "alert alert-warning small"}>
            {t("deposit")} {money(order.depositCents)}: {order.depositStatus === "confirmed" ? t("depositConfirmed") : t("depositPending")}
          </p>
        )}

        {!cancelled && (
          <section aria-labelledby="status-title" className="order-progress">
            <h2 id="status-title" className="label">
              {t("status")}: <span className={`badge status-${order.status}`}>{t(statusKey(order.status))}</span>
            </h2>
            <ol className="progress-steps">
              {STEPS.map((s, i) => (
                <li key={s} className={i <= stepIndex ? "done" : undefined} aria-current={i === stepIndex ? "step" : undefined}>
                  <span className="progress-dot" aria-hidden="true" />
                  <span className="progress-label">{t(statusKey(s))}</span>
                </li>
              ))}
            </ol>
            {!isFinalStatus(order.status) && (
              <p className="hint" aria-live="polite">
                {error === "network" ? t("loadError") : t("statusAutoRefresh")}
              </p>
            )}
          </section>
        )}

        <ul className="review-lines">
          {order.items.map((item, i) => (
            <li key={i} className="row-between">
              <span>
                {item.quantity} × {item.productName}
                {item.options.length > 0 && <span className="muted small"> ({item.options.map((o) => o.name).join(", ")})</span>}
              </span>
              <span>{money(item.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="totals">
          {order.charges.map((c) => (
            <div className="row-between" key={c.id}>
              <dt>{c.label}</dt>
              <dd>{money(c.amountCents)}</dd>
            </div>
          ))}
          <div className="row-between totals-total">
            <dt>{t("total")}</dt>
            <dd className="price">{money(order.totalCents)}</dd>
          </div>
        </dl>

        {order.whatsapp.mode === "link" && order.whatsapp.url && !cancelled && (
          <section className="whatsapp-box" aria-labelledby="wa-title">
            <h2 id="wa-title" className="label">
              {t("whatsappTitle")}
            </h2>
            <p className="small">{t("whatsappText")}</p>
            <a
              className="btn btn-whatsapp btn-block"
              href={order.whatsapp.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                void api(`/api/orders/track/${encodeURIComponent(token)}/whatsapp-opened`, { method: "POST" }).catch(() => undefined);
              }}
            >
              {t("whatsappButton")}
            </a>
          </section>
        )}
        {order.whatsapp.mode === "cloud_api" && order.whatsapp.status === "sent" && (
          <p className="alert alert-success small">{t("whatsappAutoSent")}</p>
        )}

        <div className="order-actions">
          <button type="button" className="btn btn-secondary btn-block" onClick={onBackToMenu}>
            {isFinalStatus(order.status) ? t("newOrder") : t("backToMenu")}
          </button>
        </div>
      </div>
    </main>
  );
}
