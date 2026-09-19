/**
 * @param {Uint8Array} bytes
 * @param {string} filename
 * @param {string} mimeType
 */
export function browserDownloadFile(bytes, filename, mimeType) {
  const url = URL.createObjectURL(
    new Blob([bytes.slice().buffer], { type: mimeType }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
