/**
 * Downscales a photo in the browser before upload (max 1200 px, WebP or
 * JPEG). Keeps uploads small for slow connections; the server still
 * validates size and file type.
 */
export async function resizeImage(file: File, maxSize = 1200, quality = 0.82): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Formato não suportado. Use JPEG, PNG ou WebP.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Não foi possível ler a imagem."));
      el.src = url;
    });
    const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("O navegador não suporta o redimensionamento de imagens.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const toBlob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    const webp = await toBlob("image/webp");
    if (webp && webp.type === "image/webp") return webp;
    const jpeg = await toBlob("image/jpeg");
    if (!jpeg) throw new Error("Não foi possível processar a imagem.");
    return jpeg;
  } finally {
    URL.revokeObjectURL(url);
  }
}
