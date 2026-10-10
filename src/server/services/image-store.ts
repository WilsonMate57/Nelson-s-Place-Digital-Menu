import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { badRequest } from "../http/errors";

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** Detects the image type from its first bytes; the client-declared type is never trusted. */
export function detectImageType(bytes: Uint8Array): "jpg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

const STORED_NAME = /^products\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

/** Stores product images on local disk under UPLOADS_DIR/products with random names. */
export class ImageStore {
  constructor(private readonly uploadsDir: string) {}

  async save(bytes: Uint8Array): Promise<string> {
    if (bytes.length === 0) throw badRequest("IMAGE_EMPTY", "Ficheiro vazio");
    if (bytes.length > MAX_IMAGE_BYTES) throw badRequest("IMAGE_TOO_LARGE", "Imagem demasiado grande (máx. 3 MB)");
    const type = detectImageType(bytes);
    if (!type) throw badRequest("IMAGE_TYPE", "Formato não suportado. Use JPEG, PNG ou WebP.");
    const relative = `products/${randomUUID()}.${type}`;
    await mkdir(join(this.uploadsDir, "products"), { recursive: true });
    await writeFile(join(this.uploadsDir, relative), bytes, { flag: "wx" });
    return relative;
  }

  /** Deletes a previously stored image. Ignores paths this store did not create. */
  async remove(relative: string | null): Promise<void> {
    if (!relative || !STORED_NAME.test(relative)) return;
    const full = resolve(this.uploadsDir, relative);
    if (!full.startsWith(resolve(this.uploadsDir))) return;
    await unlink(full).catch(() => undefined);
  }
}
