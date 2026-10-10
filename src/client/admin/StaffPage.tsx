import { useCallback, useEffect, useState } from "react";
import { PASSWORD_MIN_LENGTH, STAFF_ROLES, type StaffRole } from "../../shared/constants";
import type { StaffDto } from "../../shared/types";
import { Dialog } from "../components/Dialog";
import { useToast } from "../components/Toasts";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/util";
import { useErrorMessage } from "./errors";
import { ROLE_LABEL } from "./labels";
import { useSession } from "./session";

const ROLE_HELP: Record<StaffRole, string> = {
  admin: "Acesso total: menu, preços, equipa e definições.",
  reception: "Pedidos, disponibilidade de artigos e pausa de pedidos.",
  restaurant: "Pedidos, disponibilidade de artigos e pausa de pedidos.",
};

export function StaffPage() {
  const { staff: me } = useSession();
  const errorMessage = useErrorMessage();
  const [list, setList] = useState<StaffDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffDto | "new" | null>(null);
  const [resetting, setResetting] = useState<StaffDto | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await api<StaffDto[]>("/api/admin/staff"));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [errorMessage]);
  useEffect(() => void load(), [load]);

  return (
    <div className="admin-page">
      <div className="row-between wrap page-head">
        <div>
          <h1 className="admin-title">Equipa</h1>
          <p className="muted small">Cada pessoa deve ter a sua própria conta. Não partilhe palavras-passe.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
          Novo utilizador
        </button>
      </div>
      {error && <p className="alert alert-error">{error}</p>}
      {!list && !error && <div className="state-block"><span className="spinner" aria-hidden="true" /></div>}
      {list && (
        <div className="table-wrap card">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Função</th>
                <th scope="col">Estado</th>
                <th scope="col">Último acesso</th>
                <th scope="col"><span className="visually-hidden">Acções</span></th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.displayName}</strong>
                    {s.id === me.id && <span className="badge badge-muted"> você</span>}
                    <div className="small muted">{s.email}</div>
                  </td>
                  <td>{ROLE_LABEL[s.role]}</td>
                  <td>{s.isActive ? <span className="badge badge-success">Activo</span> : <span className="badge badge-muted">Desactivado</span>}</td>
                  <td className="small">{s.lastLoginAt ? formatDateTime(s.lastLoginAt) : "—"}</td>
                  <td className="nowrap">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(s)}>
                      Editar
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setResetting(s)}>
                      Redefinir palavra-passe
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <StaffEditor
        open={editing !== null}
        member={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />
      <PasswordReset member={resetting} onClose={() => setResetting(null)} />
    </div>
  );
}

function StaffEditor({ open, member, onClose, onSaved }: { open: boolean; member: StaffDto | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<StaffRole>("reception");
  const [isActive, setIsActive] = useState(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmail(member?.email ?? "");
    setDisplayName(member?.displayName ?? "");
    setRole(member?.role ?? "reception");
    setIsActive(member?.isActive ?? true);
    setPassword("");
    setError(null);
  }, [open, member]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (member) {
        await api(`/api/admin/staff/${member.id}`, { method: "PUT", body: { displayName, role, isActive } });
      } else {
        await api("/api/admin/staff", { method: "POST", body: { email, displayName, role, password } });
      }
      toast("Utilizador guardado.");
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={member ? "Editar utilizador" : "Novo utilizador"}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" form="staff-form" className="btn btn-primary" disabled={busy}>Guardar</button>
        </>
      }
    >
      <form id="staff-form" className="stack" onSubmit={save}>
        <div className="field">
          <label className="label" htmlFor="s-email">Email</label>
          <input id="s-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={!!member} />
        </div>
        <div className="field">
          <label className="label" htmlFor="s-name">Nome</label>
          <input id="s-name" className="input" maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </div>
        <fieldset className="field plain-fieldset">
          <legend className="label">Função</legend>
          {STAFF_ROLES.map((r) => (
            <label key={r} className="check">
              <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} />
              <span>
                <strong>{ROLE_LABEL[r]}</strong> <span className="small muted">— {ROLE_HELP[r]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {member ? (
          <label className="check">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Conta activa (desactivar termina todas as sessões)
          </label>
        ) : (
          <div className="field">
            <label className="label" htmlFor="s-password">Palavra-passe inicial</label>
            <input id="s-password" className="input" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={password} onChange={(e) => setPassword(e.target.value)} required />
            <span className="hint">Mínimo {PASSWORD_MIN_LENGTH} caracteres. Entregue-a pessoalmente e peça para a alterar em «Conta».</span>
          </div>
        )}
        {error && <p className="alert alert-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}

function PasswordReset({ member, onClose }: { member: StaffDto | null; onClose: () => void }) {
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPassword("");
    setError(null);
  }, [member]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!member) return;
    setBusy(true);
    try {
      await api(`/api/admin/staff/${member.id}/password`, { method: "POST", body: { password } });
      toast(`Palavra-passe de ${member.displayName} redefinida. As sessões dessa pessoa foram terminadas.`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={member !== null}
      onClose={onClose}
      title="Redefinir palavra-passe"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" form="reset-form" className="btn btn-primary" disabled={busy}>Redefinir</button>
        </>
      }
    >
      <form id="reset-form" className="stack" onSubmit={save}>
        <p className="small">{member?.displayName} ({member?.email})</p>
        <div className="field">
          <label className="label" htmlFor="r-password">Nova palavra-passe</label>
          <input id="r-password" className="input" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="alert alert-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}
