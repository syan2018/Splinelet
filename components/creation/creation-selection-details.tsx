'use client';
import { regionLabel, regionsForPaths } from '@/lib/creation-selection.mjs';
import type { CreationSelection } from '@/hooks/use-creation-selection';

export default function CreationSelectionDetails({
  selection,
  objects,
  project,
  scene,
  onSelect,
  onEdit,
  onEnable,
}: {
  selection: CreationSelection;
  objects: string[];
  project: any;
  scene: any;
  onSelect: (selection: CreationSelection) => void;
  onEdit: () => void;
  onEnable: () => void;
}) {
  const cells = (scene?.cells || []).filter(
    (c: any) => selection.kind === 'cell' && selection.ids.includes(c.key),
  );
  const owned = (scene?.cells || []).filter((c: any) =>
    objects.includes(c.objectId),
  );
  const paths = project.paths.filter(
    (p: any) => selection.kind === 'path' && selection.ids.includes(p.id),
  );
  const owners =
    scene?.creation.objects.filter((o: any) => objects.includes(o.id)) || [];
  const label =
    selection.kind === 'path'
      ? paths.length === 1
        ? paths[0].name
        : `${paths.length} 条线条`
      : selection.kind === 'cell'
        ? cells.length === 1
          ? regionLabel(cells[0], scene)
          : `${cells.length} 个区域`
        : owners.length === 1
          ? owners[0].name
          : `${owners.length} 个部件`;
  const related =
    selection.kind === 'path'
      ? regionsForPaths(project, scene, selection.ids)
      : [];
  const choose = (e: React.MouseEvent, next: CreationSelection) => {
    const details = e.currentTarget.closest('details');
    if (details) details.open = false;
    onSelect(next);
  };
  return (
    <section
      className="creation-selection-details"
      data-selection-kind={selection.kind}
    >
      <div className="creation-property-title">
        <b>{label}</b>
        {selection.kind !== 'path' && (
          <button aria-label="编辑当前对象边界" onClick={onEdit}>
            编辑线条
          </button>
        )}
        <details className="creation-selection-actions">
          <summary aria-label="选择操作">选择…</summary>
          <div>
            <button
              onClick={(e) => choose(e, { kind: 'object', ids: objects })}
            >
              选择整个部件
            </button>
            <button
              disabled={!owned.length}
              onClick={(e) =>
                choose(e, { kind: 'cell', ids: owned.map((c: any) => c.key) })
              }
            >
              选择全部内部区域
            </button>
            <button onClick={(e) => choose(e, { kind: 'object', ids: [] })}>
              取消选择
            </button>
          </div>
        </details>
      </div>
      <p className="creation-edit-scope" role="status">
        {selection.kind === 'path'
          ? '线条 · 编辑节点与形状'
          : selection.kind === 'cell'
            ? `${cells.length === 1 ? '单个区域' : `仅选中的 ${cells.length} 个区域`} · ${owners.map((o: any) => o.name).join('、')}`
            : `整个部件 · 修改将应用到 ${owned.length} 个区域`}
      </p>
      {selection.kind === 'path' && (
        <div className="creation-source-note">
          <p>颜色和厚度属于区域。先选择线条围成的区域，再调整这些属性。</p>
          {related.length > 0 && (
            <button
              onClick={() =>
                onSelect({ kind: 'cell', ids: related.map((c: any) => c.key) })
              }
            >
              {related.length === 1
                ? '选择围成的区域'
                : `选择对应的 ${related.length} 个区域`}
            </button>
          )}
        </div>
      )}
      {cells.some((c: any) => !c.painted) && (
        <div className="creation-candidate-note">
          <p>
            闭合轮廓已识别。虚线表示尚未加入成品；可直接启用，也可上色或设置厚度。
          </p>
          {cells.length === 1 && (
            <button onClick={onEnable}>启用这个区域</button>
          )}
        </div>
      )}
    </section>
  );
}
