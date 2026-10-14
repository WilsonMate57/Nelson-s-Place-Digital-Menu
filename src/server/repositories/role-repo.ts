import { resolvePermissions, type Permission } from "../../shared/permissions";
import type { RoleDto } from "../../shared/types";
import { nowIso, type Db } from "../db/connection";
import { conflict, notFound } from "../http/errors";

interface RoleRow {
  id: number;
  name: string;
  description: string | null;
  permissions: string;
  is_system: number;
  staff_count: number;
}

const toDto = (r: RoleRow): RoleDto => ({
  id: r.id,
  name: r.name,
  description: r.description,
  permissions: resolvePermissions(JSON.parse(r.permissions) as string[]),
  isSystem: r.is_system === 1,
  staffCount: r.staff_count,
});

/** Access profiles (perfis). The system role (Administrador) is read-only. */
export class RoleRepo {
  constructor(private readonly db: Db) {}

  list(): RoleDto[] {
    return (
      this.db
        .prepare(
          `SELECT r.*, (SELECT COUNT(*) FROM staff s WHERE s.role_id = r.id) AS staff_count
           FROM roles r ORDER BY r.is_system DESC, r.id`,
        )
        .all() as RoleRow[]
    ).map(toDto);
  }

  get(id: number): RoleDto {
    const role = this.list().find((r) => r.id === id);
    if (!role) throw notFound("Perfil não encontrado");
    return role;
  }

  findByName(name: string): RoleDto | null {
    return this.list().find((r) => r.name.toLocaleLowerCase("pt") === name.toLocaleLowerCase("pt")) ?? null;
  }

  create(input: { name: string; description: string | null; permissions: Permission[] }): number {
    this.assertNameFree(input.name, null);
    const now = nowIso();
    return Number(
      this.db
        .prepare("INSERT INTO roles (name, description, permissions, is_system, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)")
        .run(input.name, input.description, JSON.stringify(input.permissions), now, now).lastInsertRowid,
    );
  }

  update(id: number, input: { name: string; description: string | null; permissions: Permission[] }): void {
    const role = this.get(id);
    if (role.isSystem) throw conflict("SYSTEM_ROLE", "O perfil Administrador tem sempre todas as permissões e não pode ser alterado.");
    this.assertNameFree(input.name, id);
    this.db
      .prepare("UPDATE roles SET name = ?, description = ?, permissions = ?, updated_at = ? WHERE id = ?")
      .run(input.name, input.description, JSON.stringify(input.permissions), nowIso(), id);
  }

  delete(id: number): void {
    const role = this.get(id);
    if (role.isSystem) throw conflict("SYSTEM_ROLE", "O perfil Administrador não pode ser eliminado.");
    if (role.staffCount > 0) throw conflict("ROLE_IN_USE", "Há utilizadores com este perfil. Mude-os de perfil antes de o eliminar.");
    this.db.prepare("DELETE FROM roles WHERE id = ?").run(id);
  }

  private assertNameFree(name: string, exceptId: number | null): void {
    const existing = this.findByName(name);
    if (existing && existing.id !== exceptId) throw conflict("ROLE_NAME_TAKEN", "Já existe um perfil com este nome.");
  }
}
