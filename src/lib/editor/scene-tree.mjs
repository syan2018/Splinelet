/** Flat row projection for the existing outliner. Groups retain node identity;
 * descendant paths are a selection/gesture projection, never owned geometry. */
export function sceneTreeRows(tree, objects) {
  if (!tree?.length)
    return objects.map((object) => ({
      ...object,
      kind: 'shape',
      depth: 0,
      ancestors: [],
      ownVisible: object.visible,
      ownLocked: object.locked,
    }));
  const paths = (node) =>
    node.kind === 'shape'
      ? objects.find((object) => object.id === node.id)?.pathIds || []
      : node.children.flatMap(paths);
  const visit = (nodes, ancestors) =>
    nodes.flatMap((node) => [
      {
        ...objects.find((object) => object.id === node.id),
        ...node,
        pathIds: paths(node),
        depth: ancestors.length,
        ancestors,
      },
      ...visit(node.children || [], [...ancestors, node.id]),
    ]);
  return visit(tree, []);
}
