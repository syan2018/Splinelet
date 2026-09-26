import { outputIdentity } from '../construction/output-identity.mjs';

const walk = (value, visit) => {
  if (!value || typeof value !== 'object') return;
  if (value.kind === 'output') {
    visit(value);
    return;
  }
  for (const child of Object.values(value)) walk(child, visit);
};

/** Evaluation may temporarily carry candidate handles. Persistence and author
 * transactions may only carry explicit, self-consistent definition references. */
export function validateDurableRegionReferences(document) {
  if (document.version !== 5) return document;
  const definitions = document.regionDefinitions;
  walk(document, (ref) => {
    const definition = definitions[ref.key];
    if (
      !definition ||
      ref.lineage.length ||
      ref.key.startsWith('cell:') ||
      outputIdentity(ref) !==
        outputIdentity({
          kind: 'output',
          ...definition.context,
          key: definition.id,
          lineage: [],
        })
    )
      throw Error(`作者文档包含未声明或不一致的区域引用：${ref.operatorId}`);
  });
  const done = new Set(),
    visiting = new Set();
  const visit = (id) => {
    if (done.has(id)) return;
    if (visiting.has(id)) throw Error('区域定义之间存在循环依赖');
    visiting.add(id);
    walk(definitions[id].selector, (ref) => visit(ref.key));
    visiting.delete(id);
    done.add(id);
  };
  for (const id of Object.keys(definitions)) visit(id);
  return document;
}
