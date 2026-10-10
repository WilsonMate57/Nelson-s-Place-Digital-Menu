import { useState } from "react";
import { PASSWORD_MIN_LENGTH } from "../../shared/constants";
import { useToast } from "../components/Toasts";
import { api } from "../lib/api";
import { useErrorMessage } from "./errors";
import { ROLE_LABEL } from "./labels";
import { useSession } from "./session";

export function AccountPage() {
  const { staff } = useSession();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < PASSWORD_MIN_LENGTH) return setError(`A nova palavra-passe deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`);
    if (next !== confirmation) return setError("As palavras-passe não coincidem.");
    setBusy(true);
    try {
      await api("/api/auth/password", { method: "POST", body: { currentPassword: current, newPassword: next } });
      setCurrent("");
      setNext("");
      setConfirmation("");
      toast("Palavra-passe alterada. As outras sessões foram terminadas.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-page narrow">
      <h1 className="admin-title">A minha conta</h1>
      <dl className="kv card">
        <dt>Nome</dt>
        <dd>{staff.displayName}</dd>
        <dt>Email</dt>
        <dd>{staff.email}</dd>
        <dt>Função</dt>
        <dd>{ROLE_LABEL[staff.role]}</dd>
      </dl>
      <form className="card stack" onSubmit={submit}>
        <h2 className="card-title">Alterar palavra-passe</h2>
        <div className="field">
          <label className="label" htmlFor="pw-current">Palavra-passe actual</label>
          <input id="pw-current" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="pw-new">Nova palavra-passe</label>
          <input id="pw-new" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={PASSWORD_MIN_LENGTH} />
          <span className="hint">Mínimo {PASSWORD_MIN_LENGTH} caracteres. Use uma frase fácil de lembrar.</span>
        </div>
        <div className="field">
          <label className="label" htmlFor="pw-confirm">Repetir nova palavra-passe</label>
          <input id="pw-confirm" className="input" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required />
        </div>
        {error && <p className="alert alert-error" role="alert">{error}</p>}
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Guardar
          </button>
        </div>
      </form>
    </div>
  );
}
