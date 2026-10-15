import { useState } from "react";
import { describeLocation } from "../../shared/whatsapp-message";
import { useToast } from "../components/Toasts";
import { timeAgo } from "../lib/util";
import { useErrorMessage } from "./errors";
import { useNow } from "./hooks";
import { describeServiceRequest } from "./labels";
import { useOrderAlerts } from "./order-alerts";
import { useSession } from "./session";

/** Open guest calls (waiter / bill), shown above the orders list. */
export function ServiceCalls() {
  const alerts = useOrderAlerts();
  const { can } = useSession();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const now = useNow();
  const [busyId, setBusyId] = useState<number | null>(null);
  const calls = alerts?.serviceRequests ?? [];
  if (calls.length === 0) return null;

  const resolve = async (id: number) => {
    setBusyId(id);
    try {
      await alerts!.resolveServiceRequest(id);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="service-calls" aria-label="Chamadas de clientes">
      <h2 className="service-calls-title">Chamadas ({calls.length})</h2>
      <ul>
        {calls.map((c) => (
          <li key={c.id} className="service-call">
            <span aria-hidden="true">{c.kind === "bill" ? "🧾" : "🛎️"}</span>
            <span className="service-call-text">
              <strong>{describeLocation(c.locationType, c.locationLabel)}</strong> {describeServiceRequest(c)}
              <span className="small muted"> · {timeAgo(c.createdAt, now)}</span>
            </span>
            {can("orders.status") && (
              <button type="button" className="btn btn-primary btn-sm" disabled={busyId === c.id} onClick={() => void resolve(c.id)}>
                Atendido
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
