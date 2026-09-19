export const isDesktopRuntime = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const currentDesktopWindow = async () => {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
};

export const desktopMinimizeWindow = async () =>
  (await currentDesktopWindow()).minimize();

export const desktopToggleMaximizeWindow = async () =>
  (await currentDesktopWindow()).toggleMaximize();

export const desktopCloseWindow = async () =>
  (await currentDesktopWindow()).close();

/**
 * @template T
 * @param {string} command
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<T>}
 */
const invokeDesktop = async (command, args) => {
  const { invoke } = await import('@tauri-apps/api/core');
  return /** @type {Promise<T>} */ (invoke(command, args));
};

export const desktopProjectOpenPath = () =>
  invokeDesktop('select_project_to_open');

/** @param {string} suggestedName */
export const desktopProjectSavePath = (suggestedName) =>
  invokeDesktop('select_project_to_save', { suggestedName });

/** @param {string} path */
export const desktopReadFile = async (path) =>
  new Uint8Array(
    await /** @type {Promise<number[]>} */ (
      invokeDesktop('read_project_file', { path })
    ),
  );

/** @param {string} path @param {Uint8Array} bytes */
export const desktopWriteProject = (path, bytes) =>
  invokeDesktop('write_project_file_atomic', {
    path,
    data: Array.from(bytes),
  });

/**
 * @param {Uint8Array} bytes
 * @param {string} filename
 * @param {string} mimeType
 */
export const desktopExportFile = (bytes, filename, _mimeType) =>
  invokeDesktop('export_file', {
    data: Array.from(bytes),
    suggestedName: filename,
    extension: filename.split('.').at(-1)?.toLowerCase() || 'json',
  });

export const desktopPendingOpenPaths = () =>
  /** @type {Promise<string[]>} */ (invokeDesktop('take_pending_open_paths'));

/**
 * @param {(paths: string[]) => void} listener
 */
export async function listenDesktopOpenFiles(listener) {
  const { listen } = await import('@tauri-apps/api/event');
  return listen('desktop://open-files', ({ payload }) =>
    listener(/** @type {string[]} */ (payload)),
  );
}

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
  const url = URL.createObjectURL(
    new Blob([bytes.slice().buffer], { type: mimeType }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
