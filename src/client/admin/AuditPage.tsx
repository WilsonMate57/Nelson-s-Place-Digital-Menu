import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/util";
import { useErrorMessage } from "./errors";

interface AuditEntry {
  id: number;
  staffName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  details: unknown;
  createdAt: string;
}

const ACTION_LABEL: Record<string, string> = {
  login: "Entrou no painel",
  password_changed: "Alterou a palavra-passe",
  product_created: "Criou produto",
  product_updated: "Editou produto",
  product_archived: "Arquivou produto",
  product_restored: "Restaurou produto",
  product_availability: "Alterou disponibilidade",
  product_image_updated: "Alterou imagem",
  product_image_removed: "Removeu imagem",
  category_created: "Criou categoria",
  category_updated: "Editou categoria",
  category_deleted: "Eliminou categoria",
  staff_created: "Criou utilizador",
  staff_created_cli: "Criou utilizador (linha de comandos)",
  staff_updated: "Editou utilizador",
  staff_password_reset: "Redefiniu palavra-passe",
  settings_updated: "Alterou definições",
  orders_paused: "Pausou pedidos",
  orders_resumed: "Retomou pedidos",
  whatsapp_retry: "Reenviou WhatsApp",
  deposit_confirmed: "Confirmou sinal recebido",
  role_created: "Criou perfil de acesso",
  role_updated: "Editou perfil de acesso",
  role_deleted: "Eliminou perfil de acesso",
  report_exported: "Exportou pedidos (CSV)",
  daily_summary_sent_manually: "Enviou resumo do dia",
  orders_deleted: "Apagou pedidos",
};

export function AuditPage() {
  const errorMessage = useErrorMessage();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<AuditEntry[]>("/api/admin/audit").then(setEntries, (err) => setError(errorMessage(err)));
  }, [errorMessage]);

  return (
    <div className="admin-page">
      <h1 className="admin-title">Registo de alterações</h1>
      <p className="muted small">Últimas 200 acções administrativas (preços, menu, equipa, definições).</p>
      {error && <p className="alert alert-error">{error}</p>}
      {!entries && !error && <div className="state-block"><span className="spinner" aria-hidden="true" /></div>}
      {entries && entries.length === 0 && <div className="state-block">Sem registos.</div>}
      {entries && entries.length > 0 && (
        <div className="table-wrap card">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Utilizador</th>
                <th scope="col">Acção</th>
                <th scope="col">Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{formatDateTime(e.createdAt)}</td>
                  <td>{e.staffName ?? "—"}</td>
                  <td>
                    {ACTION_LABEL[e.action] ?? e.action}
                    {e.entityId && <span className="muted small"> · {e.entityType} #{e.entityId}</span>}
                  </td>
                  <td className="small muted audit-details">{e.details ? JSON.stringify(e.details) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
