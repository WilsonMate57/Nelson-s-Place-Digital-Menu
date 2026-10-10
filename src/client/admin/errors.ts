import { useCallback, useContext } from "react";
import { ApiError } from "../lib/api";
import { SessionContext } from "./session";

/** Converts any error to a message for staff; returns to the login screen on 401. */
export function useErrorMessage() {
  const session = useContext(SessionContext);
  return useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError) {
        if (err.status === 401) session?.onUnauthorized();
        if (err.isNetwork) return "Sem ligação ao servidor. Verifique a internet e tente novamente.";
        if (err.code === "VALIDATION_ERROR" && Array.isArray(err.details)) {
          const first = (err.details as { path: string; message: string }[])[0];
          return first ? `Dados inválidos (${first.path}): ${first.message}` : err.message;
        }
        return err.message;
      }
      return "Ocorreu um erro inesperado.";
    },
    [session],
  );
}
