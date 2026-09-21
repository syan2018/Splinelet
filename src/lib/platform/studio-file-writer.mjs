import { FileWriter } from '../persistence/file-writer.mjs';
import { desktopWriteProject } from './desktop.mjs';

const permissionOptions = { mode: 'readwrite' };

const isObject = (value) => typeof value === 'object' && value !== null;

const requireFunction = (value, name) => {
  if (typeof value !== 'function')
    throw new TypeError(`${name} must be a function`);
};

const requireBytes = (bytes) => {
  if (!(bytes instanceof Uint8Array))
    throw new TypeError('Project bytes must be a Uint8Array');
};

const requireWebTarget = (target) => {
  if (!isObject(target.handle))
    throw new TypeError('Web project target must include a file handle');
  requireFunction(target.handle.queryPermission, 'File handle queryPermission');
  requireFunction(
    target.handle.requestPermission,
    'File handle requestPermission',
  );
};

const requireDesktopTarget = (target) => {
  if (typeof target.path !== 'string' || !target.path)
    throw new TypeError('Desktop project target must include a path');
};

/**
 * Write bytes back to an already chosen Studio project target.
 *
 * This intentionally does not select a destination, download a file, or create
 * an OS file association. Callers own those user-facing flows before binding a
 * target.
 *
 * @param {{fileWriter?: {write: (handle: unknown, bytes: Uint8Array) => Promise<void>}, writeDesktop?: (path: string, bytes: Uint8Array) => Promise<void>}} [options]
 */
export function createStudioFileWriter({
  fileWriter = new FileWriter(),
  writeDesktop = desktopWriteProject,
} = {}) {
  if (!isObject(fileWriter))
    throw new TypeError('fileWriter must provide a write function');
  requireFunction(fileWriter.write, 'fileWriter.write');
  requireFunction(writeDesktop, 'writeDesktop');

  /**
   * @param {{kind: 'web', handle: unknown} | {kind: 'desktop', path: string}} target
   * @param {Uint8Array} bytes
   */
  return async function write(target, bytes) {
    requireBytes(bytes);
    if (!isObject(target)) throw new TypeError('Project target is required');

    if (target.kind === 'desktop') {
      requireDesktopTarget(target);
      await writeDesktop(target.path, bytes);
      return;
    }

    if (target.kind !== 'web')
      throw new TypeError('Project target kind must be web or desktop');
    requireWebTarget(target);

    let permission = await target.handle.queryPermission(permissionOptions);
    if (permission !== 'granted')
      permission = await target.handle.requestPermission(permissionOptions);
    if (permission !== 'granted')
      throw new Error('File write permission was not granted');

    await fileWriter.write(target.handle, bytes);
  };
}
