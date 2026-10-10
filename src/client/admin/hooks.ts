import { useCallback, useEffect, useRef, useState } from "react";

/** Minimal hash router: "#/orders/12" → ["orders", "12"]. */
export function useHashRoute(): [string[], (path: string) => void] {
  const read = () =>
    location.hash
      .replace(/^#\/?/, "")
      .split("/")
      .filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const onChange = () => setParts(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = useCallback((path: string) => {
    location.hash = `#/${path.replace(/^\//, "")}`;
  }, []);
  return [parts, navigate];
}

/**
 * Calls `fn` now and every `intervalMs` while the tab is visible; refreshes
 * immediately when the tab becomes visible again.
 */
export function usePolling(fn: () => Promise<void> | void, intervalMs: number, deps: unknown[]) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState === "visible") await saved.current();
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void tick();
      }
    };
    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);
}

/** Current time, refreshed every 30 s, for "há 5 min" labels. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
