import { resolvePermissions, type Permission } from "../../shared/permissions";
import type { StaffDto } from "../../shared/types";
import { nowIso, type Db } from "../db/connection";

interface StaffRow {
  id: number;
  email: string;
  display_name: string;
  role_id: number;
  role_name: string;
  role_permissions: string;
  password_hash: string;
  is_active: number;
  last_login_at: string | null;
  created_at: string;
}

export interface StaffWithHash extends StaffDto {
  passwordHash: string;
}

const toDto = (r: StaffRow): StaffWithHash => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  roleId: r.role_id,
  roleName: r.role_name,
  permissions: resolvePermissions(JSON.parse(r.role_permissions) as string[]),
  isActive: r.is_active === 1,
  lastLoginAt: r.last_login_at,
  createdAt: r.created_at,
  passwordHash: r.password_hash,
});

export const withoutHash = ({ passwordHash: _hash, ...staff }: StaffWithHash): StaffDto => staff;

/** Staff columns plus the role's name and permissions. */
const SELECT_STAFF = `SELECT s.*, r.name AS role_name, r.permissions AS role_permissions FROM staff s JOIN roles r ON r.id = s.role_id`;

export class StaffRepo {
  constructor(private readonly db: Db) {}

  findByEmail(email: string): StaffWithHash | null {
    const row = this.db.prepare(`${SELECT_STAFF} WHERE s.email = ?`).get(email) as StaffRow | undefined;
    return row ? toDto(row) : null;
  }

  findById(id: number): StaffWithHash | null {
    const row = this.db.prepare(`${SELECT_STAFF} WHERE s.id = ?`).get(id) as StaffRow | undefined;
    return row ? toDto(row) : null;
  }

  list(): StaffDto[] {
    return (this.db.prepare(`${SELECT_STAFF} ORDER BY s.is_active DESC, s.display_name`).all() as StaffRow[]).map((r) => withoutHash(toDto(r)));
  }

  create(input: { email: string; displayName: string; roleId: number; passwordHash: string; createdBy: number | null }): number {
    const now = nowIso();
    return Number(
      this.db
        .prepare(
          `INSERT INTO staff (email, display_name, role_id, password_hash, is_active, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .run(input.email, input.displayName, input.roleId, input.passwordHash, input.createdBy, now, now).lastInsertRowid,
    );
  }

  update(id: number, input: { displayName: string; roleId: number; isActive: boolean }): void {
    this.db
      .prepare("UPDATE staff SET display_name = ?, role_id = ?, is_active = ?, updated_at = ? WHERE id = ?")
      .run(input.displayName, input.roleId, input.isActive ? 1 : 0, nowIso(), id);
  }

  setPasswordHash(id: number, passwordHash: string): void {
    this.db.prepare("UPDATE staff SET password_hash = ?, updated_at = ? WHERE id = ?").run(passwordHash, nowIso(), id);
  }

  touchLogin(id: number): void {
    this.db.prepare("UPDATE staff SET last_login_at = ? WHERE id = ?").run(nowIso(), id);
  }

  /** Active staff members holding a permission (used to prevent lock-outs). */
  countActiveWith(permission: Permission): number {
    return this.list().filter((s) => s.isActive && s.permissions.includes(permission)).length;
  }

  // Sessions ---------------------------------------------------------------

  createSession(tokenHash: string, staffId: number, expiresAt: string): void {
    const now = nowIso();
    this.db
      .prepare("INSERT INTO sessions (token_hash, staff_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)")
      .run(tokenHash, staffId, now, expiresAt, now);
  }

  /** Returns the active staff member for a valid, unexpired session. */
  findSessionStaff(tokenHash: string): StaffWithHash | null {
    const row = this.db
      .prepare(
        `SELECT s.*, r.name AS role_name, r.permissions AS role_permissions
         FROM sessions se JOIN staff s ON s.id = se.staff_id JOIN roles r ON r.id = s.role_id
         WHERE se.token_hash = ? AND se.expires_at > ? AND s.is_active = 1`,
      )
      .get(tokenHash, nowIso()) as StaffRow | undefined;
    return row ? toDto(row) : null;
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  deleteSessionsForStaff(staffId: number, exceptTokenHash?: string): void {
    this.db
      .prepare("DELETE FROM sessions WHERE staff_id = ? AND token_hash != ?")
      .run(staffId, exceptTokenHash ?? "");
  }

  purgeExpiredSessions(): void {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(nowIso());
  }
}
