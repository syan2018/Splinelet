'use client';
import { useState } from 'react';
import type { DocumentV4, EntityRef } from '@/lib/document/types';

type Props = {
  document: DocumentV4;
  selectedIds: string[];
  onSelect: (refs: EntityRef[]) => void;
  onAction: (action: Record<string, unknown>) => void;
};
export function V4ObjectTree({
  document,
  selectedIds,
  onSelect,
  onAction,
}: Props) {
  const [filter, setFilter] = useState('');
  const nodes = Object.values(document.nodes);
  const select = (id: string, additive: boolean) => {
    const ids = additive
      ? selectedIds.includes(id)
        ? selectedIds.filter((value) => value !== id)
        : [...selectedIds, id]
      : [id];
    onSelect(ids.map((id) => ({ kind: 'node', id })));
  };
  const render = (parentId: string | null, depth = 0): React.ReactNode =>
    nodes
      .filter((node) => node.parentId === parentId)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((node) => (
        <div key={node.id}>
          {(!filter ||
            node.name
              .toLocaleLowerCase()
              .includes(filter.toLocaleLowerCase())) && (
            <div
              style={{
                marginLeft: depth * 12,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <button
                style={{ flex: 1, textAlign: 'left', marginTop: 6 }}
                aria-pressed={selectedIds.includes(node.id)}
                data-node-id={node.id}
                onClick={(event) =>
                  select(
                    node.id,
                    event.shiftKey || event.ctrlKey || event.metaKey,
                  )
                }
              >
                {node.kind === 'group' ? '▾ ' : ''}
                {node.name}
              </button>
              <button
                aria-label={`${node.visible ? '隐藏' : '显示'} ${node.name}`}
                onClick={() =>
                  onAction({
                    kind: 'set-node',
                    nodeId: node.id,
                    value: { visible: !node.visible },
                  })
                }
              >
                {node.visible ? '◉' : '○'}
              </button>
              <button
                aria-label={`${node.locked ? '解锁' : '锁定'} ${node.name}`}
                onClick={() =>
                  onAction({
                    kind: 'set-node',
                    nodeId: node.id,
                    value: { locked: !node.locked },
                  })
                }
              >
                {node.locked ? '🔒' : '◇'}
              </button>
            </div>
          )}
          {node.kind === 'group' && render(node.id, depth + 1)}
        </div>
      ));
  const selected =
    selectedIds.length === 1 ? document.nodes[selectedIds[0]] : null;
  return (
    <>
      <h2>部件</h2>
      <button onClick={() => onAction({ kind: 'create-shape' })}>新部件</button>
      <input
        aria-label="筛选部件"
        placeholder="查找部件"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        style={{ width: '100%', marginTop: 8 }}
      />
      {render(null)}
      {!nodes.length && <p>在画布上画线，开始一个部件。</p>}
      {selected && (
        <label>
          名称
          <input
            key={selected.id + selected.name}
            aria-label="部件名称"
            defaultValue={selected.name}
            onBlur={(event) => {
              if (event.target.value !== selected.name)
                onAction({
                  kind: 'set-node',
                  nodeId: selected.id,
                  value: { name: event.target.value },
                });
            }}
          />
        </label>
      )}
      {selectedIds.length > 0 && (
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 12 }}
        >
          <button
            onClick={() =>
              onAction({ kind: 'copy-nodes', nodeIds: selectedIds })
            }
          >
            复制
          </button>
          <button
            onClick={() =>
              onAction({ kind: 'delete-nodes', nodeIds: selectedIds })
            }
          >
            删除
          </button>
          <button
            onClick={() =>
              onAction({ kind: 'group-nodes', nodeIds: selectedIds })
            }
          >
            编组
          </button>
          {selectedIds.every((id) => document.nodes[id]?.kind === 'group') && (
            <button
              onClick={() =>
                onAction({ kind: 'ungroup-nodes', nodeIds: selectedIds })
              }
            >
              解组
            </button>
          )}
        </div>
      )}
    </>
  );
}
