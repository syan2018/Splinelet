import { createSourceOrganizationCommand } from '../editing/commands/source-organization.mjs';
import { createPathMetadataCommand } from '../editing/commands/path-metadata.mjs';
import { projectPathGroups } from './path-groups.mjs';

/** Compatibility of original group actions is compiled from a captured source
 * view, never by mutating and reimporting a legacy display project.
 */
export function createGroupIntent(request, displayed) {
  const action = structuredClone(request),
    view = structuredClone(displayed);
  if (
    !view?.source ||
    typeof view.epoch !== 'string' ||
    !Number.isInteger(view.revision) ||
    view.previewId != null
  )
    throw Error('分组操作需要已提交的源视图');
  const { groups, memberships } = projectPathGroups(view.source);
  const group = (id) => {
    const found = groups.find((item) => item.id === id);
    if (!found) throw Error('路径分组不存在或包含非路径成员');
    return found;
  };
  const resolve = (id) => {
    const ref = view.source.identities.byId[id];
    if (ref?.kind !== 'path') throw Error('请选择存在的路径');
    return ref;
  };
  const ids = action.pathIds === undefined ? [] : action.pathIds;
  if (!Array.isArray(ids)) throw Error('pathIds 必须是数组');
  const selected = [...new Set(ids)];
  selected.forEach(resolve);
  const commands = [];
  let create = false;
  if (action.kind === 'create-group') {
    create = true;
    commands.push({
      kind: 'create-path-collection',
      name: action.name,
      pathRefs: [],
    });
  } else if (action.kind === 'rename-group' || action.kind === 'delete-group') {
    group(action.groupId);
    commands.push({
      kind:
        action.kind === 'rename-group'
          ? 'rename-collection'
          : 'delete-collection',
      collectionId: action.groupId,
      ...(action.kind === 'rename-group' ? { name: action.name } : {}),
    });
  } else if (action.kind === 'group-visibility') {
    if (typeof action.visible !== 'boolean')
      throw Error('visible 必须为布尔值');
    const pathRefs = group(action.groupId).pathIds.map(resolve);
    commands.push({
      kind: 'set-paths',
      pathRefs,
      value: { visible: action.visible },
    });
  } else if (
    action.kind === 'assign-group' ||
    action.kind === 'move-group-paths'
  ) {
    if (!selected.length) throw Error('请选择存在的路径');
    let targetGroup = action.groupId || null;
    if (targetGroup) group(targetGroup);
    if (action.kind === 'move-group-paths' && action.targetId) {
      resolve(action.targetId);
      if (selected.includes(action.targetId))
        return (document, context) => {
          if (
            context.epoch !== view.epoch ||
            context.revision !== view.revision
          )
            throw Error('分组视图已过期');
          return { document, changedRefs: [] };
        };
      const memberOf = memberships[action.targetId] || [];
      if (memberOf.length > 1)
        throw Error('目标路径属于多个分组，请先明确编组归属');
      targetGroup = memberOf[0] || null;
    }
    commands.push({
      kind: 'assign-path-collection',
      collectionId: targetGroup,
      pathRefs: selected.map(resolve),
    });
    if (action.kind === 'move-group-paths') {
      const order = view.source.orderedPathIds;
      // Match the old visible grouped ordering, without duplicating overlapping members.
      const grouped = [
        ...new Set([
          ...groups.flatMap((item) =>
            order.filter((id) => item.pathIds.includes(id)),
          ),
          ...order,
        ]),
      ];
      const moving = grouped.filter((id) => selected.includes(id));
      const rest = order.filter((id) => !selected.includes(id));
      let at = action.targetId
        ? rest.indexOf(action.targetId) + (action.after ? 1 : 0)
        : rest.findLastIndex((id) =>
            targetGroup
              ? memberships[id]?.includes(targetGroup)
              : !memberships[id]?.length,
          ) + 1;
      if (!action.targetId && at === 0) at = rest.length;
      rest.splice(at, 0, ...moving);
      commands.push({
        kind: 'reorder-source-paths',
        pathRefs: rest.map(resolve),
      });
    }
  } else throw Error('不支持的路径分组操作');
  return (document, context) => {
    if (context.epoch !== view.epoch || context.revision !== view.revision)
      throw Error('分组视图已过期');
    let current = document;
    const changedRefs = [];
    for (const request of commands) {
      const result = (
        request.kind === 'set-paths'
          ? createPathMetadataCommand(request)
          : createSourceOrganizationCommand(request)
      )(current, context);
      current = result.document;
      changedRefs.push(...result.changedRefs);
      if (create && request.kind === 'create-path-collection') {
        const collectionId = result.changedRefs.find(
          (ref) => ref.kind === 'collection',
        ).id;
        const assigned = createSourceOrganizationCommand({
          kind: 'assign-path-collection',
          collectionId,
          pathRefs: selected.map(resolve),
        })(current, context);
        current = assigned.document;
        changedRefs.push(...assigned.changedRefs);
      }
    }
    return { document: current, changedRefs };
  };
}
