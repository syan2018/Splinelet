'use client';
import { FolderTree } from 'lucide-react';
import type { PropertyContext, PropertyContribution } from './property-context';

function HierarchyProperties({ context: c }: { context: PropertyContext }) {
  const group = c.groups.singleGroup;
  if (!group)
    return (
      <section className="creation-section">
        <h3>场景组选区</h3>
        <p>
          已选 {c.groups.groups.length} 个场景组
          {c.groups.shapes.length ? `、${c.groups.shapes.length} 个部件` : ''}。
        </p>
        {c.groups.rootGroups.length !== c.groups.groups.length && (
          <p className="creation-muted">
            已选内层组由外层组涵盖；解组按 {c.groups.rootGroups.length}{' '}
            个根场景组执行。
          </p>
        )}
        <p className="creation-muted">
          父级只能单选场景组后修改；部件属性请单选部件。
        </p>
        <button
          disabled={c.disabled}
          onClick={() => c.ungroup(c.groups.rootGroups.map((g) => g.id))}
        >
          解散选中的 {c.groups.rootGroups.length} 个根场景组
        </button>
      </section>
    );
  return (
    <section className="creation-section">
      <h3>{group.name} · 场景组</h3>
      <p>移动此组会带动全部子对象；源线坐标和修改器局部锚点保持不变。</p>
      <label>
        父对象
        <select
          aria-label="场景组父对象"
          value={group.parentId || ''}
          disabled={c.disabled}
          onChange={(e) =>
            c.command('scene_reparent', {
              nodeIds: [group.id],
              parentId: e.target.value || null,
            })
          }
        >
          <option value="">作品根</option>
          {c.rows
            .filter(
              (row) =>
                row.kind === 'group' &&
                row.id !== group.id &&
                !row.ancestors.includes(group.id),
            )
            .map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
        </select>
      </label>
      <button disabled={c.disabled} onClick={() => c.ungroup([group.id])}>
        解散场景组
      </button>
    </section>
  );
}
export const hierarchyProperties: PropertyContribution = {
  id: 'hierarchy',
  label: '层级',
  title: '当前场景组层级',
  heading: '场景组层级',
  icon: FolderTree,
  order: 10,
  supports: (target) => target.groupCount > 0,
  Panel: HierarchyProperties,
};
