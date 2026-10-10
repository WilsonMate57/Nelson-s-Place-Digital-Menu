import { useState } from "react";
import type { StaffDto } from "../../shared/types";
import { ApiError, api } from "../lib/api";

export function LoginPage({ onSignedIn }: { onSignedIn: (staff: StaffDto) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { staff } = await api<{ staff: StaffDto }>("/api/auth/login", { method: "POST", body: { email, password } });
      onSignedIn(staff);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.isNetwork
            ? "Sem ligação ao servidor."
            : err.message
          : "Não foi possível entrar.",
      );
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <span className="brand-mark" aria-hidden="true">
          N
        </span>
        <div>
          <p className="eyebrow">Área reservada</p>
          <h1>Painel Nelson's Place</h1>
        </div>
        <div className="field">
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="password">
            Palavra-passe
          </label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy && <span className="spinner spinner-sm" aria-hidden="true" />}
          Entrar
        </button>
        <p className="hint">Esqueceu a palavra-passe? Peça a um administrador para a redefinir.</p>
      </form>
    </main>
  );
}
