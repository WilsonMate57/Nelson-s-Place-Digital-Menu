import type { ApiErrorBody } from "../../shared/types";
import { withBase } from "./base";

/** Error returned by the API (or a network/timeout failure, with status 0). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** JSON fetch wrapper with timeout and typed errors. Sends the anti-CSRF header on every call. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  options.signal?.addEventListener("abort", () => controller.abort());
  const isForm = options.body instanceof FormData;

  let response: Response;
  try {
    response = await fetch(withBase(path), {
      method: options.method ?? "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "X-NP-Request": "1",
        ...(options.body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body === undefined ? undefined : isForm ? (options.body as FormData) : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Network error");
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!response.ok) {
    const err = (payload as ApiErrorBody | null)?.error;
    throw new ApiError(response.status, err?.code ?? `HTTP_${response.status}`, err?.message ?? response.statusText, err?.details);
  }
  return payload as T;
}
