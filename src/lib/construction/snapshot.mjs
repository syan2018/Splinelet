const clone = (value) => structuredClone(value);
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
};

export function createEvaluationSnapshot({
  epoch,
  revision,
  previewId = null,
  components,
  published,
  diagnostics = [],
}) {
  if (typeof epoch !== 'string' || !epoch)
    throw Error('snapshot epoch 必须是非空字符串');
  if (!Number.isInteger(revision) || revision < 0)
    throw Error('snapshot revision 必须是非负整数');
  if (previewId !== null && (typeof previewId !== 'string' || !previewId))
    throw Error('snapshot previewId 必须是 null 或非空字符串');
  return freeze(
    clone({ epoch, revision, previewId, components, published, diagnostics }),
  );
}
