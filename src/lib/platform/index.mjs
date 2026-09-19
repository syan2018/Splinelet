import { desktopExportFile, isDesktopRuntime } from './desktop.mjs';
import { browserDownloadFile } from './browser.mjs';

export * from './desktop.mjs';

/**
 * @param {string | Uint8Array | ArrayBuffer} content
 * @param {string} filename
 * @param {string} mimeType
 */
export async function saveThroughRuntime(content, filename, mimeType) {
  const bytes =
    typeof content === 'string'
      ? new TextEncoder().encode(content)
      : content instanceof Uint8Array
        ? content
        : new Uint8Array(content);
  if (isDesktopRuntime()) {
    await desktopExportFile(bytes, filename, mimeType);
    return;
  }
  browserDownloadFile(bytes, filename, mimeType);
}
