'use client';
import type { DocumentV4, EntityRef, EdgeEndRef } from '@/lib/document/types';
import { resolveRelation } from '@/lib/geometry/relations.mjs';
type Props = {
  document: DocumentV4;
  active: EntityRef | null;
  onAction: (action: Record<string, unknown>) => void;
};
export function V4SourceInspector({ document, active, onAction }: Props) {
  if (!active || !('sketchId' in active))
    return <p>选择线条的节点或控制柄进行编辑。</p>;
  const sketch = document.sketches[active.sketchId];
  if (!sketch) return <p>来源已删除；可以撤销恢复。</p>;
  const slot =
    active.kind === 'vertex'
      ? sketch.vertices[active.id]?.position
      : active.kind === 'edge-end'
        ? sketch.edges[active.edgeId]?.[
            active.end === 'start' ? 'startHandle' : 'endHandle'
          ]
        : null;
  const relation =
    slot?.kind === 'relation' ? document.relations[slot.relationId] : null;
  const ends: EdgeEndRef[] =
    active.kind === 'vertex'
      ? Object.values(sketch.edges).flatMap((edge) => [
          ...(edge.startVertexId === active.id
            ? [
                {
                  kind: 'edge-end' as const,
                  sketchId: sketch.id,
                  edgeId: edge.id,
                  end: 'start' as const,
                },
              ]
            : []),
          ...(edge.endVertexId === active.id
            ? [
                {
                  kind: 'edge-end' as const,
                  sketchId: sketch.id,
                  edgeId: edge.id,
                  end: 'end' as const,
                },
              ]
            : []),
        ])
      : [];
  const field =
    relation?.kind === 'point-on-axis'
      ? 'distance'
      : relation?.kind === 'handle-continuity' && relation.mode === 'smooth'
        ? 'length'
        : null;
  const scalar =
    field && relation
      ? (relation as unknown as Record<string, unknown>)[field]
      : null;
  const parameter =
    typeof scalar === 'object' &&
    scalar &&
    'kind' in scalar &&
    scalar.kind === 'parameter' &&
    'id' in scalar
      ? document.parameters[String(scalar.id)]
      : null;
  const relationValue = relation
    ? resolveRelation({
        document,
        sketch,
        target: relation.target,
        relationId: relation.id,
      })
    : null;
  return (
    <section aria-label="线条编辑">
      <h2>线条</h2>
      {active.kind === 'path' && (
        <>
          <button
            onClick={() =>
              onAction({
                kind: 'close-path',
                sketchId: sketch.id,
                pathId: active.id,
              })
            }
          >
            闭合线条
          </button>
          <button
            onClick={() =>
              onAction({
                kind: 'reverse-path',
                sketchId: sketch.id,
                pathId: active.id,
              })
            }
          >
            反转方向
          </button>
        </>
      )}
      {(active.kind === 'edge' || active.kind === 'edge-end') && (
        <>
          <button
            onClick={() =>
              onAction({
                kind: 'split-edge',
                sketchId: sketch.id,
                edgeId: 'edgeId' in active ? active.edgeId : active.id,
                t: 0.5,
              })
            }
          >
            中点加节点
          </button>
          <button
            onClick={() =>
              onAction({
                kind: 'remove-edge',
                sketchId: sketch.id,
                edgeId: 'edgeId' in active ? active.edgeId : active.id,
                updatePaths: true,
              })
            }
          >
            删除线段
          </button>
        </>
      )}
      {ends.length === 2 && (
        <div>
          <p>节点连接</p>
          {(['corner', 'smooth', 'symmetric', 'auto'] as const).map(
            (mode, index) => (
              <button
                key={mode}
                onClick={() => {
                  const target = ends[1],
                    source = ends[0];
                  const handle =
                    sketch.edges[target.edgeId][
                      target.end === 'start' ? 'startHandle' : 'endHandle'
                    ];
                  const length =
                    handle.kind === 'free' ? Math.hypot(...handle.vector) : 1;
                  onAction({
                    kind: 'set-continuity',
                    source,
                    target,
                    mode,
                    length,
                  });
                }}
              >
                {['尖角', '平滑', '对称', '自动'][index]}
              </button>
            ),
          )}
        </div>
      )}
      {relation && (
        <>
          <p>
            此位置由关系生成。
            {relationValue?.status === 'ready' ? '' : '关系当前失效。'}
          </p>
          {field && (typeof scalar === 'number' || parameter) && (
            <label>
              {parameter?.name || (field === 'distance' ? '沿轴距离' : '柄长')}
              <input
                key={`${relation.id}:${JSON.stringify(scalar)}:${parameter?.value}`}
                type="number"
                aria-label="关系自由量"
                defaultValue={parameter?.value ?? (scalar as number)}
                onBlur={(event) =>
                  onAction({
                    kind: 'edit-relation',
                    relationId: relation.id,
                    field,
                    value: Number(event.target.value),
                  })
                }
              />
            </label>
          )}
          <button
            onClick={() =>
              onAction({ kind: 'release-relation', relationId: relation.id })
            }
          >
            解除关系并保留当前位置
          </button>
        </>
      )}
    </section>
  );
}
