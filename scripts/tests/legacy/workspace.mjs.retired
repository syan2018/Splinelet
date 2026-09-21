// Resolve only after transaction commit, not after an individual IDB request.
export function workspaceDB(action, value) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('bezier-studio', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('workspace');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction(
        'workspace',
        action === 'put' ? 'readwrite' : 'readonly',
      );
      const store = tx.objectStore('workspace');
      let result;
      if (action === 'put') {
        store.put(value, 'session-v2');
        store.put(value.project, 'current'); // retain compatibility with older versions
      } else {
        const current = store.get('session-v2');
        current.onsuccess = () => {
          if (current.result) result = current.result;
          else {
            const legacy = store.get('current');
            legacy.onsuccess = () => {
              result = legacy.result
                ? { project: legacy.result, handle: null }
                : null;
            };
          }
        };
      }
      tx.oncomplete = () => {
        database.close();
        resolve(result);
      };
      tx.onabort = () => {
        database.close();
        reject(tx.error || Error('浏览器备份事务已中止'));
      };
      tx.onerror = () => {};
    };
  });
}

// Serial writes prevent a slow older save from overwriting newer edits.
export class FileWriter {
  queue = Promise.resolve();
  write(handle, content) {
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        const writable = await handle.createWritable();
        try {
          await writable.write(content);
          await writable.close();
        } catch (error) {
          try {
            await writable.abort();
          } catch {}
          throw error;
        }
      });
    this.queue = task;
    return task;
  }
}
