/**
 * Creates a staff account (an administrator by default).
 *
 *   npm run admin:create -- --email gerente@example.com --name "Nome" [--role admin]
 *
 * The password is read from a hidden prompt, or from the ADMIN_PASSWORD
 * environment variable when no terminal is attached (e.g. automation).
 */
import { parseArgs } from "node:util";
import { STAFF_ROLES, type StaffRole } from "../../shared/constants";
import { passwordSchema, staffCreateSchema } from "../../shared/schemas";
import { hashPassword } from "../auth/passwords";
import { loadConfig } from "../config";
import { openDatabase } from "../db/connection";
import { AuditRepo } from "../repositories/audit-repo";
import { StaffRepo } from "../repositories/staff-repo";

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          return reject(new Error("Cancelled"));
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string", default: "admin" },
    },
  });
  if (!values.email || !values.name) {
    console.error('Usage: npm run admin:create -- --email EMAIL --name "NAME" [--role admin|reception|restaurant]');
    process.exit(1);
  }
  if (!STAFF_ROLES.includes(values.role as StaffRole)) {
    console.error(`Invalid role. Use one of: ${STAFF_ROLES.join(", ")}`);
    process.exit(1);
  }

  let password = process.env.ADMIN_PASSWORD ?? "";
  if (!password) {
    if (!process.stdin.isTTY) {
      console.error("No terminal available: set ADMIN_PASSWORD for this command.");
      process.exit(1);
    }
    password = await promptHidden("Password (min. 10 characters): ");
    const confirm = await promptHidden("Repeat password: ");
    if (password !== confirm) {
      console.error("Passwords do not match.");
      process.exit(1);
    }
  }
  const pw = passwordSchema.safeParse(password);
  if (!pw.success) {
    console.error(pw.error.issues[0]?.message);
    process.exit(1);
  }

  const input = staffCreateSchema.parse({ email: values.email, displayName: values.name, role: values.role, password });
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  const staff = new StaffRepo(db);
  if (staff.findByEmail(input.email)) {
    console.error(`A user with email ${input.email} already exists.`);
    process.exit(1);
  }
  const id = staff.create({
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    passwordHash: await hashPassword(input.password),
    createdBy: null,
  });
  new AuditRepo(db).record(null, "staff_created_cli", "staff", id, { email: input.email, role: input.role });
  db.close();
  console.log(`Created ${input.role} account #${id} for ${input.email} in ${config.databasePath}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
