import type { ContentfulStatusCode } from "hono/utils/http-status";

/** An error whose message is safe to show to the client. */
export class AppError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);
export const notFound = (message = "Recurso não encontrado") => new AppError(404, "NOT_FOUND", message);
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);
export const forbidden = (message = "Sem permissão para esta operação") => new AppError(403, "FORBIDDEN", message);
export const unauthorized = (message = "Sessão inválida ou expirada") => new AppError(401, "UNAUTHORIZED", message);
