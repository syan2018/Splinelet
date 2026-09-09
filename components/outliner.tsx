'use client';
import { useRef, useState } from 'react';
import {
  Plus,
  Eye,
  EyeOff,
  Trash2,
  FolderPlus,
  ChevronRight,
  GripVertical,
  X,
} from 'lucide-react';
import type { Project } from '@/lib/project';
type Props = {
  project: Project;
  selected: string[];
  active: string | null;
  busy: boolean;
  onSelect: (
    id: string,
    e: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
    ordered: string[],
  ) => void;
  onGroupSelect: (ids: string[], add: boolean) => void;
  onClear: () => void;
  onNew: () => void;
  onGroup: () => void;
  onRename: (kind: 'path' | 'group', id: string, name: string) => void;
  onMove: (
    ids: string[],
    groupId: string,
    targetId?: string,
    after?: boolean,
  ) => void;
  onVisibility: (ids: string[], visible: boolean) => void;
  onDissolve: (id: string) => void;
  onDelete: () => void;
  onEdit: () => void;
};
export function Outliner(p: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({}),
    [rename, setRename] = useState<{
      kind: 'path' | 'group';
      id: string;
      name: string;
    } | null>(null),
    [target, setTarget] = useState(''),
    [dragCount, setDragCount] = useState(0);
  const draft = useRef(rename);
  draft.current = rename;
  const moving = useRef<string[]>([]),
    expand = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groups = [...(p.project.groups || []), { id: '', name: '未分组' }];
  const ordered = groups.flatMap((g) =>
    collapsed[g.id]
      ? []
      : p.project.paths
          .filter((v) => (v.groupId || '') === g.id)
          .map((v) => v.id),
  );
  const commit = () => {
    const r = draft.current;
    draft.current = null;
    setRename(null);
    if (r?.name.trim()) p.onRename(r.kind, r.id, r.name.trim());
  };
  const editor = (kind: 'path' | 'group', id: string, name: string) =>
    rename?.id === id && rename.kind === kind ? (
      <input
        aria-label={kind === 'path' ? '重命名路径' : '重命名分组'}
        autoFocus
        value={rename.name}
        maxLength={kind === 'path' ? 120 : 80}
        onFocus={(e) => e.target.select()}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setRename({ ...rename, name: e.target.value })}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            draft.current = null;
            setRename(null);
          }
        }}
      />
    ) : (
      <span
        className={kind === 'path' ? 'path-title' : 'group-title'}
        title="双击重命名"
        onDoubleClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (kind !== 'group' || id) setRename({ kind, id, name });
        }}
      >
        {name}
      </span>
    );
  const stopDrag = () => {
    moving.current = [];
    setDragCount(0);
    setTarget('');
    if (expand.current) clearTimeout(expand.current);
    expand.current = null;
  };
  const over = (e: React.DragEvent, id: string) => {
    if (!moving.current.length) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (target !== id) {
      if (expand.current) clearTimeout(expand.current);
      setTarget(id);
      if (id.startsWith('g:') && collapsed[id.slice(2)])
        expand.current = setTimeout(
          () => setCollapsed((v) => ({ ...v, [id.slice(2)]: false })),
          650,
        );
    }
  };
  const drop = (
    e: React.DragEvent,
    groupId: string,
    id?: string,
    after = false,
  ) => {
    if (!moving.current.length) return;
    e.preventDefault();
    e.stopPropagation();
    p.onMove(moving.current, groupId, id, after);
    setCollapsed((v) => ({ ...v, [groupId]: false }));
    stopDrag();
  };
  const allSelected =
    p.project.paths.length > 0 && p.selected.length === p.project.paths.length;
  return (
    <section
      className="outliner"
      aria-label="路径树"
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest('input,button')) return;
        if (
          e.code === 'Space' &&
          (e.target as HTMLElement).hasAttribute('data-path-id')
        ) {
          e.preventDefault();
          e.stopPropagation();
          p.onSelect(
            (e.target as HTMLElement).getAttribute('data-path-id')!,
            { ctrlKey: true },
            ordered,
          );
          return;
        }
        if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          const i = ordered.indexOf(p.active || '');
          const id =
            ordered[
              Math.max(
                0,
                Math.min(
                  ordered.length - 1,
                  i + (e.key === 'ArrowDown' ? 1 : -1),
                ),
              )
            ];
          if (id) {
            p.onSelect(id, e, ordered);
            e.currentTarget
              .querySelector<HTMLElement>('[data-path-id="' + id + '"]')
              ?.focus();
          }
        }
        if (e.key === 'F2' && p.selected.length === 1) {
          e.preventDefault();
          const path = p.project.paths.find((v) => v.id === p.selected[0]);
          if (path) setRename({ kind: 'path', id: path.id, name: path.name });
        }
        if (e.key === 'Enter' && p.selected.length === 1) {
          e.preventDefault();
          p.onEdit();
        }
      }}
    >
      <div className="outliner-heading">
        <b>路径与分组</b>
        <span>{p.project.paths.length}</span>
        <button
          aria-label="新建路径"
          title="新建路径 · P"
          disabled={p.busy}
          onClick={p.onNew}
        >
          <Plus size={15} />
        </button>
        <button
          aria-label="新建分组"
          title={p.selected.length ? '将所选路径编组 · Ctrl G' : '新建空分组'}
          disabled={p.busy}
          onClick={p.onGroup}
        >
          <FolderPlus size={15} />
        </button>
      </div>
      <div className="outliner-selection">
        <input
          type="checkbox"
          aria-label="选择全部路径"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = !!p.selected.length && !allSelected;
          }}
          onChange={() =>
            allSelected
              ? p.onClear()
              : p.onGroupSelect(
                  p.project.paths.map((v) => v.id),
                  false,
                )
          }
        />
        <span>
          {dragCount
            ? `正在拖动 ${dragCount} 条路径`
            : p.selected.length
              ? `已选 ${p.selected.length} 条路径`
              : '单击选择 · Shift 连选 · Ctrl 多选'}
        </span>
        {!!p.selected.length && (
          <>
            <button
              aria-label="隐藏所选路径"
              title="隐藏所选"
              onClick={() => p.onVisibility(p.selected, false)}
              disabled={p.busy}
            >
              <EyeOff size={14} />
            </button>
            <button
              aria-label="删除所选路径"
              title="删除所选 · Delete · 可撤销"
              disabled={p.busy}
              onClick={p.onDelete}
            >
              <Trash2 size={14} />
            </button>
            <button
              aria-label="取消路径选择"
              title="取消选择 · Esc"
              onClick={p.onClear}
            >
              <X size={14} />
            </button>
          </>
        )}
      </div>
      <div
        className="outliner-scroll"
        role="listbox"
        aria-label="路径列表"
        aria-multiselectable="true"
        onClick={(e) => {
          if (e.target === e.currentTarget) p.onClear();
        }}
      >
        {groups.map((g) => {
          const members = p.project.paths.filter(
              (v) => (v.groupId || '') === g.id,
            ),
            ids = members.map((v) => v.id),
            selected = ids.filter((id) => p.selected.includes(id)).length;
          return (
            <details
              key={g.id}
              className={
                'path-group ' + (target === 'g:' + g.id ? 'drop-target' : '')
              }
              data-group-id={g.id}
              open={!collapsed[g.id]}
              onDragOver={(e) => over(e, 'g:' + g.id)}
              onDrop={(e) => drop(e, g.id)}
            >
              <summary onClick={(e) => e.preventDefault()}>
                <button
                  className="group-toggle"
                  aria-label={
                    (collapsed[g.id] ? '展开分组 ' : '折叠分组 ') + g.name
                  }
                  aria-expanded={!collapsed[g.id]}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCollapsed((v) => ({ ...v, [g.id]: !v[g.id] }));
                  }}
                >
                  <ChevronRight size={14} />
                </button>
                <input
                  type="checkbox"
                  aria-label={'选择分组 ' + g.name}
                  disabled={!ids.length}
                  checked={!!ids.length && selected === ids.length}
                  ref={(el) => {
                    if (el)
                      el.indeterminate = selected > 0 && selected < ids.length;
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => p.onGroupSelect(ids, true)}
                />
                <div
                  className="group-name"
                  onClick={(e) => {
                    e.preventDefault();
                    p.onGroupSelect(ids, e.ctrlKey || e.metaKey || e.shiftKey);
                  }}
                >
                  {editor('group', g.id, g.name)}
                </div>
                <div className="group-controls">
                  <small>{members.length}</small>
                  <button
                    aria-label={'显示隐藏分组 ' + g.name}
                    title="整组显示 / 隐藏"
                    disabled={p.busy || !ids.length}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      p.onVisibility(ids, !members.some((v) => v.visible));
                    }}
                  >
                    {members.some((v) => v.visible) ? (
                      <Eye size={14} />
                    ) : (
                      <EyeOff size={14} />
                    )}
                  </button>
                  {g.id && (
                    <button
                      aria-label={'解散分组 ' + g.name}
                      title="解散分组，保留路径"
                      disabled={p.busy}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        p.onDissolve(g.id);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </summary>
              {members.map((path) => (
                <div
                  key={path.id}
                  data-path-id={path.id}
                  tabIndex={path.id === (p.active || ordered[0]) ? 0 : -1}
                  role="option"
                  aria-selected={p.selected.includes(path.id)}
                  aria-label={path.name}
                  draggable={!p.busy && rename?.id !== path.id}
                  className={`path-row ${p.selected.includes(path.id) ? 'selected' : ''} ${path.id === p.active ? 'active' : ''} ${path.visible ? '' : 'is-hidden'} ${target === 'b:' + path.id ? 'drop-before' : target === 'a:' + path.id ? 'drop-after' : ''}`}
                  onClick={(e) => {
                    if (!(e.target as HTMLElement).closest('button,input'))
                      p.onSelect(path.id, e, ordered);
                  }}
                  onDragStart={(e) => {
                    const ids = p.selected.includes(path.id)
                      ? p.selected
                      : [path.id];
                    if (!p.selected.includes(path.id))
                      p.onSelect(path.id, {}, ordered);
                    moving.current = ids;
                    e.dataTransfer.setData(
                      'application/x-bezier-paths',
                      JSON.stringify(ids),
                    );
                    e.dataTransfer.effectAllowed = 'move';
                    setDragCount(ids.length);
                  }}
                  onDragEnd={stopDrag}
                  onDragOver={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    over(
                      e,
                      (e.clientY > r.y + r.height / 2 ? 'a:' : 'b:') + path.id,
                    );
                  }}
                  onDrop={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    drop(e, g.id, path.id, e.clientY > r.y + r.height / 2);
                  }}
                >
                  <GripVertical className="drag-grip" size={13} />
                  <span
                    className="path-swatch"
                    style={{ background: path.color }}
                  />
                  <div className="path-select">
                    {editor('path', path.id, path.name)}
                    <small>
                      {path.closed ? '闭合' : '开放'} · {path.curves.length} 段
                      {path.quality < 0.35 ? ' · 待检查' : ''}
                    </small>
                  </div>
                  <button
                    aria-label={'切换可见性 ' + path.name}
                    title="显示 / 隐藏"
                    disabled={p.busy}
                    onClick={() => p.onVisibility([path.id], !path.visible)}
                  >
                    {path.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                </div>
              ))}
              {!members.length && (
                <div className="group-empty">
                  {g.id ? '拖入路径加入分组' : '拖到这里移出分组'}
                </div>
              )}
            </details>
          );
        })}
      </div>
    </section>
  );
}
