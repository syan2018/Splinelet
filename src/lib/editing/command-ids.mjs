const collectIds = (value, ids = new Set(), seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return ids;
  seen.add(value);
  if (typeof value.id === 'string') ids.add(value.id);
  for (const child of Object.values(value)) collectIds(child, ids, seen);
  return ids;
};

/** Reserve command IDs before table writes, including within this transaction. */
export const createCommandIdAllocator = (document, idFactory) => {
  if (typeof idFactory !== 'function') throw Error('idFactory 必须是函数');
  const ids = collectIds(document);
  return () => {
    const id = idFactory();
    if (typeof id !== 'string' || !id || ids.has(id))
      throw Error('idFactory 返回了无效或重复 ID');
    ids.add(id);
    return id;
  };
};
