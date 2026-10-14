import { useCallback, useEffect, useRef, useState } from "react";
import { ORDER_LIMITS } from "../../shared/constants";
import type { ChatThreadDto } from "../../shared/types";
import { useToast } from "../components/Toasts";
import { api } from "../lib/api";
import { cx, formatDateTime } from "../lib/util";
import { useErrorMessage } from "./errors";

const POLL_MS = 8_000;

const QUICK_REPLIES = [
  "Recebemos o seu pedido e já está a ser tratado.",
  "O seu pedido estará pronto em cerca de 15 minutos.",
  "O seu pedido estará pronto em cerca de 30 minutos.",
  "Alteração registada. Obrigado!",
  "Pode confirmar o número da mesa ou do apartamento?",
  "Pedimos desculpa, esse artigo está esgotado. Deseja substituir por outro?",
];

/** Conversation with the guest about this order (dashboard side). */
export function StaffChat({ orderId, canReply }: { orderId: number; canReply: boolean }) {
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [thread, setThread] = useState<ChatThreadDto | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const url = `/api/admin/orders/${orderId}/messages`;

  const load = useCallback(async () => {
    try {
      setThread(await api<ChatThreadDto>(url));
    } catch {
      /* the order view shows connection errors */
    }
  }, [url]);

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [thread?.messages.length]);

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      setThread(await api<ChatThreadDto>(url, { method: "POST", body: { body } }));
      setDraft("");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSending(false);
    }
  };

  if (!thread) return null;

  return (
    <section className="detail-section staff-chat no-print" aria-labelledby={`chat-${orderId}`}>
      <h3 id={`chat-${orderId}`} className="detail-heading">
        Mensagens com o cliente
      </h3>
      <ol ref={listRef} className="staff-chat-list" aria-live="polite">
        {thread.messages.length === 0 && <li className="small muted">Sem mensagens. O cliente pode escrever a partir da página do pedido.</li>}
        {thread.messages.map((m) => (
          <li key={m.id} className={cx("staff-chat-msg", m.sender === "staff" ? "is-mine" : "is-theirs")}>
            <span className="staff-chat-author">{m.sender === "guest" ? "Cliente" : (m.authorName ?? "Equipa")}</span>
            <p>{m.body}</p>
            <span className="staff-chat-meta">
              {formatDateTime(m.createdAt)}
              {m.sender === "staff" && (m.read ? " · lida pelo cliente" : " · não lida")}
            </span>
          </li>
        ))}
      </ol>
      {!canReply ? (
        <p className="small muted">O seu perfil não permite responder no chat.</p>
      ) : thread.open ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <div className="quick-replies" aria-label="Respostas rápidas">
            {QUICK_REPLIES.map((q) => (
              <button key={q} type="button" className="btn btn-secondary btn-sm" disabled={sending} onClick={() => setDraft(q)}>
                {q}
              </button>
            ))}
          </div>
          <div className="row">
            <label htmlFor={`reply-${orderId}`} className="visually-hidden">
              Resposta ao cliente
            </label>
            <textarea
              id={`reply-${orderId}`}
              className="textarea"
              rows={2}
              maxLength={ORDER_LIMITS.maxChatMessageLength}
              placeholder="Escreva uma resposta…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={sending || !draft.trim()}>
              Enviar
            </button>
          </div>
        </form>
      ) : (
        <p className="small muted">Conversa encerrada (pedido terminado há mais de 24 h).</p>
      )}
    </section>
  );
}
