import { useCallback, useEffect, useRef, useState } from "react";
import { ORDER_LIMITS } from "../../shared/constants";
import type { ChatThreadDto } from "../../shared/types";
import { ApiError, api } from "../lib/api";
import { cx, formatTime } from "../lib/util";
import { useGuest } from "./context";

const POLL_MS = 8_000;

/** Chat with the hotel about one order. The private order token identifies the guest. */
export function OrderChat({ token }: { token: string }) {
  const { t, language } = useGuest();
  const [thread, setThread] = useState<ChatThreadDto | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFromHotel, setNewFromHotel] = useState(false);
  const lastStaffId = useRef<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const url = `/api/orders/track/${encodeURIComponent(token)}/messages`;
  const locale = language === "pt" ? "pt-PT" : "en-GB";

  const apply = useCallback((next: ChatThreadDto) => {
    const staff = next.messages.filter((m) => m.sender === "staff");
    const latest = staff.at(-1)?.id ?? null;
    if (lastStaffId.current !== null && latest !== null && latest > lastStaffId.current) {
      setNewFromHotel(true);
      if (typeof navigator.vibrate === "function") navigator.vibrate([150, 80, 150]);
    }
    lastStaffId.current = latest ?? lastStaffId.current ?? 0;
    setThread(next);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      clearTimeout(timer);
      try {
        apply(await api<ChatThreadDto>(url));
      } catch {
        /* keep the previous thread; retry on the next tick */
      }
      if (!stopped) timer = setTimeout(load, POLL_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, apply]);

  // Keep the latest message in view.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [thread?.messages.length]);

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      apply(await api<ChatThreadDto>(url, { method: "POST", body: { body } }));
      setDraft("");
    } catch (err) {
      setError(err instanceof ApiError && !err.isNetwork && err.status !== 500 ? err.message : t("chatError"));
    } finally {
      setSending(false);
    }
  };

  if (!thread) return null;
  const messages = thread.messages;

  return (
    <section className="chat" aria-labelledby="chat-title">
      <div className="row-between">
        <h2 id="chat-title" className="label">
          💬 {t("chatTitle")}
        </h2>
        {newFromHotel && (
          <span className="badge badge-success" role="status">
            {t("chatNew")}
          </span>
        )}
      </div>
      <p className="small muted">{t("chatIntro")}</p>

      <ol ref={listRef} className="chat-list" aria-live="polite" onPointerDown={() => setNewFromHotel(false)}>
        {messages.length === 0 && <li className="chat-empty muted small">{t("chatEmpty")}</li>}
        {messages.map((m) => (
          <li key={m.id} className={cx("chat-msg", m.sender === "guest" ? "is-mine" : "is-theirs")}>
            <span className="chat-author">{m.sender === "guest" ? t("chatYou") : t("chatTeam")}</span>
            <p className="chat-body">{m.body}</p>
            <span className="chat-meta">
              {formatTime(m.createdAt, locale)}
              {m.sender === "guest" && m.read && ` · ${t("chatRead")}`}
            </span>
          </li>
        ))}
      </ol>

      {thread.open ? (
        <form
          className="chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          {messages.length === 0 && (
            <div className="chat-quick">
              {(["chatQuick1", "chatQuick2"] as const).map((k) => (
                <button key={k} type="button" className="chip" onClick={() => void send(t(k))} disabled={sending}>
                  {t(k)}
                </button>
              ))}
            </div>
          )}
          <label htmlFor="chat-input" className="visually-hidden">
            {t("chatPlaceholder")}
          </label>
          <div className="chat-compose">
            <textarea
              id="chat-input"
              className="textarea"
              rows={2}
              maxLength={ORDER_LIMITS.maxChatMessageLength}
              placeholder={t("chatPlaceholder")}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={() => setNewFromHotel(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
            />
            <button type="submit" className="btn btn-primary" disabled={sending || !draft.trim()}>
              {t("chatSend")}
            </button>
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </form>
      ) : (
        <p className="alert alert-info small">{t("chatClosed")}</p>
      )}
    </section>
  );
}
