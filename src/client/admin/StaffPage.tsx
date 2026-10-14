import { useCallback, useEffect, useState } from "react";
import { PASSWORD_MIN_LENGTH } from "../../shared/constants";
import { PERMISSION_GROUPS, PERMISSIONS, type Permission } from "../../shared/permissions";
import type { RoleDto, StaffDto } from "../../shared/types";
import { Dialog } from "../components/Dialog";
import { useToast } from "../components/Toasts";
import { api } from "../lib/api";
import { cx, formatDateTime } from "../lib/util";
import { useErrorMessage } from "./errors";
import { useSession } from "./session";

/** Team members and access profiles (perfis). Requires "staff.manage". */
export function StaffPage() {
  const { staff: me } = useSession();
  const errorMessage = useErrorMessage();
  const [tab, setTab] = useState<"people" | "roles">("people");
  const [list, setList] = useState<StaffDto[] | null>(null);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffDto | "new" | null>(null);
  const [resetting, setResetting] = useState<StaffDto | null>(null);
  const [editingRole, setEditingRole] = useState<RoleDto | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      const [people, profiles] = await Promise.all([api<StaffDto[]>("/api/admin/staff"), api<RoleDto[]>("/api/admin/roles")]);
      setList(people);
      setRoles(profiles);
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
          <p className="muted small">Cada pessoa deve ter a sua própria conta. O perfil define o que pode fazer no painel.</p>
        </div>
        {tab === "people" ? (
          <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
            Novo utilizador
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setEditingRole("new")}>
            Novo perfil
          </button>
        )}
      </div>

      <div className="filter-tabs" role="tablist" aria-label="Secções da equipa">
        {(
          [
            ["people", "Pessoas"],
            ["roles", "Perfis de acesso"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={cx("filter-tab", tab === key && "active")} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {error && <p className="alert alert-error">{error}</p>}
      {!list && !error && (
        <div className="state-block">
          <span className="spinner" aria-hidden="true" />
        </div>
      )}

      {list && tab === "people" && (
        <div className="table-wrap card">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Perfil</th>
                <th scope="col">Estado</th>
                <th scope="col">Último acesso</th>
                <th scope="col">
                  <span className="visually-hidden">Acções</span>
                </th>
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
                  <td>{s.roleName}</td>
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

      {list && tab === "roles" && <RolesMatrix roles={roles} onEdit={setEditingRole} />}

      <StaffEditor
        open={editing !== null}
        member={editing === "new" ? null : editing}
        roles={roles}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />
      <PasswordReset member={resetting} onClose={() => setResetting(null)} />
      <RoleEditor
        open={editingRole !== null}
        role={editingRole === "new" ? null : editingRole}
        onClose={() => setEditingRole(null)}
        onSaved={() => {
          setEditingRole(null);
          void load();
        }}
      />
    </div>
  );
}

/** Overview: one column per profile, ✓ where the permission is granted. */
function RolesMatrix({ roles, onEdit }: { roles: RoleDto[]; onEdit: (r: RoleDto) => void }) {
  return (
    <div className="table-wrap card">
      <table className="table roles-matrix">
        <thead>
          <tr>
            <th scope="col">Permissão</th>
            {roles.map((r) => (
              <th key={r.id} scope="col" className="roles-col">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(r)} title={r.isSystem ? "Perfil do sistema" : "Editar perfil"}>
                  {r.name}
                  {r.isSystem && " 🔒"}
                </button>
                <div className="small muted">{r.staffCount} pessoa(s)</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSION_GROUPS.map((group) => (
            <GroupRows key={group.title} title={group.title} items={group.items} roles={roles} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({ title, items, roles }: { title: string; items: { key: Permission; label: string }[]; roles: RoleDto[] }) {
  return (
    <>
      <tr className="roles-group">
        <th scope="rowgroup" colSpan={roles.length + 1}>
          {title}
        </th>
      </tr>
      {items.map((item) => (
        <tr key={item.key}>
          <th scope="row" className="roles-perm">
            {item.label}
          </th>
          {roles.map((r) => (
            <td key={r.id} className="roles-cell">
              {r.permissions.includes(item.key) ? <span aria-label="Sim">✓</span> : <span className="muted" aria-label="Não">—</span>}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function RoleEditor({ open, role, onClose, onSaved }: { open: boolean; role: RoleDto | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [permissions, setPermissions] = useState<Set<Permission>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = role?.isSystem ?? false;

  useEffect(() => {
    if (!open) return;
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
    setPermissions(new Set(role?.permissions ?? ["orders.view"]));
    setError(null);
  }, [open, role]);

  const toggle = (p: Permission, on: boolean) =>
    setPermissions((current) => {
      const next = new Set(current);
      if (on) next.add(p);
      else next.delete(p);
      return next;
    });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { name, description: description || null, permissions: PERMISSIONS.filter((p) => permissions.has(p)) };
    try {
      await api(role ? `/api/admin/roles/${role.id}` : "/api/admin/roles", { method: role ? "PUT" : "POST", body });
      toast("Perfil guardado. As permissões aplicam-se de imediato.");
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!role || !confirm(`Eliminar o perfil «${role.name}»?`)) return;
    setBusy(true);
    try {
      await api(`/api/admin/roles/${role.id}`, { method: "DELETE" });
      toast("Perfil eliminado.");
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
      variant="wide"
      title={role ? `Perfil: ${role.name}` : "Novo perfil"}
      footer={
        <>
          {role && !locked && (
            <button type="button" className="btn btn-danger" onClick={() => void remove()} disabled={busy} style={{ marginRight: "auto" }}>
              Eliminar
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {locked ? "Fechar" : "Cancelar"}
          </button>
          {!locked && (
            <button type="submit" form="role-form" className="btn btn-primary" disabled={busy}>
              Guardar
            </button>
          )}
        </>
      }
    >
      <form id="role-form" className="stack" onSubmit={save}>
        {locked && <p className="alert alert-info small">O perfil Administrador tem sempre todas as permissões e não pode ser alterado nem eliminado.</p>}
        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="role-name">
              Nome do perfil
            </label>
            <input id="role-name" className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} required disabled={locked} />
          </div>
          <div className="field">
            <label className="label" htmlFor="role-desc">
              Descrição
            </label>
            <input id="role-desc" className="input" maxLength={120} value={description} onChange={(e) => setDescription(e.target.value)} disabled={locked} />
          </div>
        </div>
        {PERMISSION_GROUPS.map((group) => (
          <fieldset key={group.title} className="plain-fieldset perm-group">
            <legend className="label">{group.title}</legend>
            {group.items.map((item) => (
              <label key={item.key} className="check">
                <input type="checkbox" checked={permissions.has(item.key)} disabled={locked} onChange={(e) => toggle(item.key, e.target.checked)} />
                {item.label}
              </label>
            ))}
          </fieldset>
        ))}
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function StaffEditor({ open, member, roles, onClose, onSaved }: { open: boolean; member: StaffDto | null; roles: RoleDto[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roleId, setRoleId] = useState<number>(0);
  const [isActive, setIsActive] = useState(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmail(member?.email ?? "");
    setDisplayName(member?.displayName ?? "");
    setRoleId(member?.roleId ?? roles.find((r) => r.name === "Recepção")?.id ?? roles[0]?.id ?? 0);
    setIsActive(member?.isActive ?? true);
    setPassword("");
    setError(null);
  }, [open, member, roles]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (member) {
        await api(`/api/admin/staff/${member.id}`, { method: "PUT", body: { displayName, roleId, isActive } });
      } else {
        await api("/api/admin/staff", { method: "POST", body: { email, displayName, roleId, password } });
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
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="staff-form" className="btn btn-primary" disabled={busy}>
            Guardar
          </button>
        </>
      }
    >
      <form id="staff-form" className="stack" onSubmit={save}>
        <div className="field">
          <label className="label" htmlFor="s-email">
            Email
          </label>
          <input id="s-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={!!member} />
        </div>
        <div className="field">
          <label className="label" htmlFor="s-name">
            Nome
          </label>
          <input id="s-name" className="input" maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </div>
        <fieldset className="field plain-fieldset">
          <legend className="label">Perfil de acesso</legend>
          {roles.map((r) => (
            <label key={r.id} className="check">
              <input type="radio" name="role" checked={roleId === r.id} onChange={() => setRoleId(r.id)} />
              <span>
                <strong>{r.name}</strong>
                {r.description && <span className="small muted"> — {r.description}</span>}
              </span>
            </label>
          ))}
          <span className="hint">As permissões de cada perfil vêem-se e alteram-se em «Perfis de acesso».</span>
        </fieldset>
        {member ? (
          <label className="check">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Conta activa (desactivar termina todas as sessões)
          </label>
        ) : (
          <div className="field">
            <label className="label" htmlFor="s-password">
              Palavra-passe inicial
            </label>
            <input
              id="s-password"
              className="input"
              type="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <span className="hint">Mínimo {PASSWORD_MIN_LENGTH} caracteres. Entregue-a pessoalmente e peça para a alterar em «Conta».</span>
          </div>
        )}
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
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
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="reset-form" className="btn btn-primary" disabled={busy}>
            Redefinir
          </button>
        </>
      }
    >
      <form id="reset-form" className="stack" onSubmit={save}>
        <p className="small">
          {member?.displayName} ({member?.email})
        </p>
        <div className="field">
          <label className="label" htmlFor="r-password">
            Nova palavra-passe
          </label>
          <input
            id="r-password"
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
