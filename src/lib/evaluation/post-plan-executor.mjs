/** Executes a compiled, read-only post-evaluation graph. External entries are
 * planar publication inputs; only declared plan nodes may perform work. */
export async function executePostPlanDag({ nodes, roots, external = {} }) {
  const definitions = new Map(nodes.map((node) => [node.id, node]));
  if (definitions.size !== nodes.length) throw Error('post plan 节点 ID 重复');
  const values = new Map(Object.entries(external));
  const pending = new Map();
  const visit = (id, ancestry = new Set()) => {
    if (values.has(id)) return values.get(id);
    const node = definitions.get(id);
    if (!node) throw Error(`post plan 缺少输入：${id}`);
    if (ancestry.has(id)) throw Error(`post plan 存在依赖环：${id}`);
    if (pending.has(id)) return pending.get(id);
    const nextAncestry = new Set(ancestry).add(id);
    const promise = Promise.all(
      node.dependsOn.map(async (dependency) => [
        dependency,
        await visit(dependency, nextAncestry),
      ]),
    ).then(async (entries) => {
      const result = await node.run(Object.fromEntries(entries));
      values.set(id, result);
      return result;
    });
    pending.set(id, promise);
    return promise;
  };
  await Promise.all(roots.map((root) => visit(root)));
  return values;
}
