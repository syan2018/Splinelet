export function deliver3MF<
  T extends { bytes: ArrayBuffer; mimeType: string; filename: string },
>(result: T, save: boolean) {
  const { bytes, ...info } = result;
  if (save) {
    const url = URL.createObjectURL(
      new Blob([bytes], { type: result.mimeType }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return info;
  }
  const array = new Uint8Array(bytes),
    chunks: string[] = [];
  for (let i = 0; i < array.length; i += 16384)
    chunks.push(String.fromCharCode(...array.subarray(i, i + 16384)));
  return { ...info, base64: btoa(chunks.join('')) };
}
