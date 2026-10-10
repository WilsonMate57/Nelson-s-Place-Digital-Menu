import { createHash, randomBytes } from "node:crypto";
import type { StaffDto } from "../../shared/types";
import { getDummyHash, hashPassword, verifyPassword } from "../auth/passwords";
import { badRequest, unauthorized } from "../http/errors";
import type { AuditRepo } from "../repositories/audit-repo";
import { withoutHash, type StaffRepo } from "../repositories/staff-repo";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export interface LoginResult {
  staff: StaffDto;
  token: string;
  expiresAt: Date;
}

/** Staff authentication with opaque, server-side sessions (only the token hash is stored). */
export class AuthService {
  constructor(
    private readonly staff: StaffRepo,
    private readonly audit: AuditRepo,
    private readonly sessionTtlHours: number,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const member = this.staff.findByEmail(email);
    // Always run one hash comparison so response time does not reveal whether the email exists.
    const valid = await verifyPassword(password, member?.passwordHash ?? (await getDummyHash()));
    if (!member || !valid || !member.isActive) {
      throw unauthorized("Email ou palavra-passe incorrectos");
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.sessionTtlHours * 3600_000);
    this.staff.createSession(hashToken(token), member.id, expiresAt.toISOString());
    this.staff.touchLogin(member.id);
    this.staff.purgeExpiredSessions();
    this.audit.record(member.id, "login", "staff", member.id);
    return { staff: withoutHash(member), token, expiresAt };
  }

  logout(token: string): void {
    this.staff.deleteSession(hashToken(token));
  }

  authenticate(token: string): StaffDto | null {
    const member = this.staff.findSessionStaff(hashToken(token));
    return member ? withoutHash(member) : null;
  }

  async changePassword(staffId: number, currentToken: string, currentPassword: string, newPassword: string): Promise<void> {
    const member = this.staff.findById(staffId);
    if (!member || !(await verifyPassword(currentPassword, member.passwordHash))) {
      throw badRequest("INVALID_PASSWORD", "A palavra-passe actual está incorrecta");
    }
    this.staff.setPasswordHash(staffId, await hashPassword(newPassword));
    // Sign out other devices; keep the current session.
    this.staff.deleteSessionsForStaff(staffId, hashToken(currentToken));
    this.audit.record(staffId, "password_changed", "staff", staffId);
  }
}
