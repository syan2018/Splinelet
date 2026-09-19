import { saveThroughRuntime } from './platform/index.mjs';

export function deliver3MF<
  T extends { bytes: ArrayBuffer; mimeType: string; filename: string },
>(result: T, save: boolean) {
  const { bytes, ...info } = result;
  if (save) {
    void saveThroughRuntime(bytes, result.filename, result.mimeType).catch(
      (error: unknown) => {
        window.alert(
          '保存 3MF 失败：' +
            (error instanceof Error ? error.message : String(error)),
        );
      },
    );
    return info;
  }
  const array = new Uint8Array(bytes),
    chunks: string[] = [];
  for (let i = 0; i < array.length; i += 16384)
    chunks.push(String.fromCharCode(...array.subarray(i, i + 16384)));
  return { ...info, base64: btoa(chunks.join('')) };
}
