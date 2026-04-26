/**
 * Reads a File and returns a square JPEG data URL no larger than `size` px.
 * Centre-crops the source so non-square images don't get squashed. Quality
 * starts at 0.82 and steps down until the encoded length fits `maxBytes`.
 */
export async function resizeImageToDataUrl(
  file: File,
  size = 512,
  maxBytes = 220 * 1024,
): Promise<string> {
  const bitmap = await loadBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D недоступен');

    const srcW = bitmap.width;
    const srcH = bitmap.height;
    const cropSide = Math.min(srcW, srcH);
    const sx = (srcW - cropSide) / 2;
    const sy = (srcH - cropSide) / 2;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(bitmap, sx, sy, cropSide, cropSide, 0, 0, size, size);

    let q = 0.82;
    let dataUrl = canvas.toDataURL('image/jpeg', q);
    while (dataUrl.length > maxBytes && q > 0.4) {
      q -= 0.1;
      dataUrl = canvas.toDataURL('image/jpeg', q);
    }
    if (dataUrl.length > maxBytes) {
      throw new Error('Не удалось сжать изображение до допустимого размера.');
    }
    return dataUrl;
  } finally {
    if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to <img> path
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не удалось прочитать изображение'));
    };
    img.src = url;
  });
}
