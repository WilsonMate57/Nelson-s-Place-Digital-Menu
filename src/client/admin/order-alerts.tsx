import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { OrderListResponse } from "../../shared/types";
import { describeLocation } from "../../shared/whatsapp-message";
import { useToast } from "../components/Toasts";
import { api } from "../lib/api";
import { withBase } from "../lib/base";
import { formatTime, storage } from "../lib/util";
import { useSession } from "./session";

/**
 * Watches for new orders, guest chat messages and scheduled orders that are
 * due, for the WHOLE dashboard (any section) and also while the browser tab
 * is in the background. Signals: in-app toast, chime, system notification
 * (if allowed), a counter on the "Pedidos" menu, in the tab title and on the
 * tab icon.
 */

const POLL_MS = 10_000;
const ALERTS_KEY = "np.admin.sound";
const BASE_TITLE = "Painel | Nelson's Place";

export interface OrderAlerts {
  /** Pending orders + unread guest messages + scheduled orders due. */
  attention: number;
  pendingCount: number;
  unreadMessages: number;
  /** New pending orders not opened yet (highlighted in the list). */
  freshIds: ReadonlySet<number>;
  /** Scheduled orders whose preparation should start now. */
  dueIds: ReadonlySet<number>;
  markSeen: (orderId: number) => void;
  alertsOn: boolean;
  toggleAlerts: () => void;
}

const Ctx = createContext<OrderAlerts | null>(null);
export const useOrderAlerts = () => useContext(Ctx);

/** Short two-tone chime generated with Web Audio (no audio file needed). */
export function playChime() {
  try {
    const ctx = new AudioContext();
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.32);
    });
    setTimeout(() => void ctx.close(), 1000);
  } catch {
    /* audio unavailable */
  }
}

/** Tab icon with a red counter (the normal icon when the count is 0). */
function setFaviconBadge(count: number) {
  const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) return;
  const label = count > 99 ? "99+" : String(count);
  const badge =
    count > 0
      ? `<circle cx="46" cy="18" r="18" fill="#d93025"/><text x="46" y="25" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="${label.length > 2 ? 14 : 20}" fill="#fff">${label}</text>`
      : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="31" fill="#183b32"/><circle cx="32" cy="32" r="27" fill="none" stroke="#c6a66a" stroke-width="1.5"/><text x="32" y="43" text-anchor="middle" font-family="Georgia, serif" font-size="30" fill="#c6a66a">N</text>${badge}</svg>`;
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function systemNotify(title: string, body: string) {
  // Only when the dashboard is not in front: otherwise the in-app toast is enough.
  if (!document.hidden || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, tag: "nelsons-place-orders", icon: withBase("/favicon.svg") });
    n.onclick = () => {
      window.focus();
      location.hash = "#/orders";
      n.close();
    };
  } catch {
    /* some mobile browsers only allow notifications from a service worker */
  }
}

export function OrderAlertsProvider({ children }: { children: ReactNode }) {
  const { can, settings } = useSession();
  const toast = useToast();
  const enabled = can("orders.view");
  const [alertsOn, setAlertsOn] = useState<boolean>(() => storage.get<boolean>(ALERTS_KEY) ?? false);
  const [pendingCount, setPendingCount] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set());
  const [dueIds, setDueIds] = useState<Set<number>>(new Set());
  const knownPending = useRef<Set<number> | null>(null);
  const lastUnread = useRef<number | null>(null);
  const notifiedDue = useRef<Set<number>>(new Set());
  const leadMinutes = useRef(45);
  leadMinutes.current = settings?.minLeadMinutes ?? 45;

  const signal = useCallback(
    (title: string, body: string) => {
      toast(body ? `${title} — ${body}` : title);
      if (storage.get<boolean>(ALERTS_KEY)) {
        playChime();
        systemNotify(title, body);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    // Runs even when the tab is hidden (browsers may slow it down to about once a minute).
    const tick = async () => {
      try {
        const pending = await api<OrderListResponse>("/api/admin/orders?status=PENDING&limit=200");
        if (stopped) return;
        const ids = new Set(pending.orders.map((o) => o.id));
        const known = knownPending.current;
        if (known) {
          const arrived = pending.orders.filter((o) => !known.has(o.id));
          if (arrived.length) {
            setFreshIds((s) => new Set([...s, ...arrived.map((o) => o.id)]));
            const first = arrived[0]!;
            signal(
              arrived.length === 1 ? (first.scheduledFor ? "Nova encomenda" : "Novo pedido") : `${arrived.length} novos pedidos`,
              arrived.length === 1 ? `${first.reference} · ${describeLocation(first.locationType, first.locationLabel)}` : "",
            );
          }
        }
        knownPending.current = ids;
        setPendingCount(ids.size);

        if (lastUnread.current !== null && pending.unreadMessagesTotal > lastUnread.current) {
          signal("💬 Nova mensagem de um cliente", "");
        }
        lastUnread.current = pending.unreadMessagesTotal;
        setUnreadMessages(pending.unreadMessagesTotal);

        const scheduled = await api<OrderListResponse>("/api/admin/orders?status=SCHEDULED&limit=200");
        if (stopped) return;
        const leadMs = leadMinutes.current * 60_000;
        const due = scheduled.orders.filter(
          (o) => o.scheduledFor && (o.status === "PENDING" || o.status === "CONFIRMED") && new Date(o.scheduledFor).getTime() - leadMs <= Date.now(),
        );
        setDueIds(new Set(due.map((o) => o.id)));
        const newlyDue = due.filter((o) => !notifiedDue.current.has(o.id));
        for (const o of newlyDue) notifiedDue.current.add(o.id);
        if (newlyDue.length) {
          const o = newlyDue[0]!;
          signal(
            "Começar a preparar",
            newlyDue.length === 1 ? `${describeLocation(o.locationType, o.locationLabel)} — para as ${formatTime(o.scheduledFor!)}` : `${newlyDue.length} encomendas`,
          );
        }
      } catch {
        /* the orders screen shows connection errors */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    // Catch up immediately when the person comes back to the tab.
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, signal]);

  const attention = pendingCount + unreadMessages + dueIds.size;

  useEffect(() => {
    document.title = attention > 0 ? `(${attention}) Pedidos | Nelson's Place` : BASE_TITLE;
    setFaviconBadge(attention);
  }, [attention]);
  useEffect(
    () => () => {
      document.title = BASE_TITLE;
      setFaviconBadge(0);
    },
    [],
  );

  const toggleAlerts = useCallback(() => {
    const next = !storage.get<boolean>(ALERTS_KEY);
    storage.set(ALERTS_KEY, next);
    setAlertsOn(next);
    if (next) {
      playChime(); // also unlocks audio after a user gesture
      if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
    }
  }, []);

  const markSeen = useCallback((orderId: number) => {
    setFreshIds((s) => {
      if (!s.has(orderId)) return s;
      const n = new Set(s);
      n.delete(orderId);
      return n;
    });
  }, []);

  return (
    <Ctx.Provider value={{ attention, pendingCount, unreadMessages, freshIds, dueIds, markSeen, alertsOn, toggleAlerts }}>{children}</Ctx.Provider>
  );
}
