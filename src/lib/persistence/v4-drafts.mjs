/** Recovery has its own database; it cannot overwrite legacy drafts or files. */
export function createV4DraftStore(factory = globalThis.indexedDB) {
  let database;
  const open = () =>
    (database ||= new Promise((resolve, reject) => {
      if (!factory) {
        reject(Error('当前环境不支持恢复草稿存储'));
        return;
      }
      const request = factory.open('splinelet-v4-recovery', 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('drafts');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        database = null;
        reject(request.error);
      };
    }));
  const transaction = async (mode, key, value) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', mode),
        store = tx.objectStore('drafts');
      const request =
        mode === 'readonly' ? store.get(key) : store.put(value, key);
      tx.oncomplete = () => resolve(request.result ?? null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || Error('草稿写入已取消'));
    });
  };
  return {
    read: (key) => transaction('readonly', key),
    write: (key, value) =>
      transaction('readwrite', key, structuredClone(value)),
  };
}
