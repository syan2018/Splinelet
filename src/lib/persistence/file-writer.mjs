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
