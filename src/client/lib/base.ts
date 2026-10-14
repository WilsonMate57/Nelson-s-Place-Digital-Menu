/**
 * Path prefix the site is served under: "/" or e.g. "/menu/".
 * Detected at runtime from where the bundle was loaded (bundles live in
 * `<base>assets/`), so the same build works at the domain root or in a sub-folder.
 */
export const BASE_PATH = import.meta.env.DEV ? "/" : new URL("../", import.meta.url).pathname;

/** Prefixes an absolute app path ("/api/…", "/uploads/…") with the base path. */
export const withBase = (path: string) => (path.startsWith("/") ? BASE_PATH + path.slice(1) : path);
