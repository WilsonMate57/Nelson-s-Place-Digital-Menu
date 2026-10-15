import { useEffect, useState } from "react";
import { addDays } from "../../shared/schedule";
import { useToast } from "../components/Toasts";
import { api } from "../lib/api";
import { cx, hotelToday } from "../lib/util";
import { useErrorMessage } from "./errors";

type Scope = "all" | "cancelled";
interface Preview {
  orders: number;
  active: number;
  messages: number;
}

/**
 * Deletes orders of a period (e.g. test orders before opening). The server
 * takes a safety copy of the database first and records who did it.
 */
export function DataCleanup() {
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const today = hotelToday();
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const [scope, setScope] = useState<Scope>("cancelled");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmWord, setConfirmWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!from || !to || to < from) return setPreview(null);
    let stale = false;
    api<Preview>(`/api/admin/maintenance/orders?from=${from}&to=${to}&scope=${scope}`).then(
      (p) => !stale && setPreview(p),
      (err) => !stale && setError(errorMessage(err)),
    );
    return () => {
      stale = true;
    };
  }, [from, to, scope, refresh, errorMessage]);

  const run = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await api<{ deleted: number; backupFile: string | null }>("/api/admin/maintenance/orders/delete", {
        method: "POST",
        body: { from, to, scope, confirm: confirmWord.trim() },
        timeoutMs: 60_000,
      });
      toast(`${result.deleted} pedido(s) apagado(s). Foi feita uma cópia de segurança antes.`);
      setConfirmWord("");
      setRefresh((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const ready = !!preview && preview.orders > 0 && confirmWord.trim() === "APAGAR";

  return (
    <section className="card stack danger-zone" aria-labelledby="cleanup-title">
      <h2 className="card-title" id="cleanup-title">
        Limpar pedidos
      </h2>
      <p className="small muted">
        Apaga definitivamente pedidos de um período — por exemplo, os pedidos de teste antes da abertura. Antes de apagar, o sistema faz automaticamente uma
        cópia de segurança de toda a base de dados. O menu, as fotografias, a equipa e as definições não são afectados.
      </p>
      <div className="row wrap">
        <label className="small report-date">
          De
          <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="small report-date">
          Até
          <input className="input" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <fieldset className="stack">
        <legend className="small">Que pedidos?</legend>
        <label className="check">
          <input type="radio" name="cleanup-scope" checked={scope === "cancelled"} onChange={() => setScope("cancelled")} />
          Só os cancelados
        </label>
        <label className="check">
          <input type="radio" name="cleanup-scope" checked={scope === "all"} onChange={() => setScope("all")} />
          Todos os pedidos do período (incluindo concluídos e em curso)
        </label>
      </fieldset>

      {preview && (
        <p className={cx("alert small", preview.orders > 0 ? "alert-warning" : "alert-info")} role="status">
          {preview.orders === 0
            ? "Não há pedidos para apagar com estes critérios."
            : `Serão apagados ${preview.orders} pedido(s)${preview.active ? `, dos quais ${preview.active} ainda em curso` : ""}${
                preview.messages ? `, e ${preview.messages} mensagem(ns) de chat` : ""
              }. Os relatórios desse período deixam de os incluir.`}
        </p>
      )}

      {preview && preview.orders > 0 && (
        <div className="row wrap">
          <label className="small">
            Para confirmar, escreva <strong>APAGAR</strong>
            <input className="input" value={confirmWord} onChange={(e) => setConfirmWord(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <button type="button" className="btn btn-danger" disabled={!ready || busy} onClick={() => void run()}>
            {busy && <span className="spinner spinner-sm" aria-hidden="true" />}
            Apagar {preview.orders} pedido(s)
          </button>
        </div>
      )}
      {error && (
        <p className="alert alert-error small" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
