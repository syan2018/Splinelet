'use client';
import { regionLabel, regionsForPaths } from '@/lib/creation-selection.mjs';
import type { CreationSelection } from '@/hooks/use-creation-selection';
import type { Project } from '@/lib/project';

type CreationCell = {
  key: string;
  objectId: string;
  painted?: boolean;
};
type CreationObject = { id: string; name: string };
type CreationScene = {
  cells: CreationCell[];
  creation: { objects: CreationObject[] };
};

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
  project: Project;
  scene: CreationScene | null;
  onSelect: (selection: CreationSelection) => void;
  onEdit: () => void;
  onEnable: () => void;
}) {
  const cells = (scene?.cells || []).filter(
    (c) => selection.kind === 'cell' && selection.ids.includes(c.key),
  );
  const owned = (scene?.cells || []).filter((c) =>
    objects.includes(c.objectId),
  );
  const paths = project.paths.filter(
    (path) => selection.kind === 'path' && selection.ids.includes(path.id),
  );
  const owners =
    scene?.creation.objects.filter((object) => objects.includes(object.id)) ||
    [];
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
      ? (regionsForPaths(project, scene, selection.ids) as CreationCell[])
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
                choose(e, { kind: 'cell', ids: owned.map((c) => c.key) })
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
      <output className="creation-edit-scope">
        {selection.kind === 'path'
          ? '线条 · 编辑节点与形状'
          : selection.kind === 'cell'
            ? `${cells.length === 1 ? '单个区域' : `仅选中的 ${cells.length} 个区域`} · ${owners.map((object) => object.name).join('、')}`
            : `整个部件 · 修改将应用到 ${owned.length} 个区域`}
      </output>
      {selection.kind === 'path' && (
        <div className="creation-source-note">
          <p>颜色和厚度属于区域。先选择线条围成的区域，再调整这些属性。</p>
          {related.length > 0 && (
            <button
              onClick={() =>
                onSelect({ kind: 'cell', ids: related.map((cell) => cell.key) })
              }
            >
              {related.length === 1
                ? '选择围成的区域'
                : `选择对应的 ${related.length} 个区域`}
            </button>
          )}
        </div>
      )}
      {cells.some((cell) => !cell.painted) && (
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
