'use client';
import type { DocumentV4, OutputRef, ReliefValue } from '@/lib/document/types';
import { sameOutputRef } from '@/lib/relief/appearance.mjs';
import { isExcluded, partForRelief } from '@/lib/manufacturing/parts.mjs';
type Props = {
  document: DocumentV4;
  target: OutputRef | null;
  onAction: (action: Record<string, unknown>) => void;
};
export function V4ManufacturingTasks({ document, target, onAction }: Props) {
  const definition: ReliefValue = {
    enabled: false,
    thickness: { kind: 'mm', value: 1 },
    mode: 'add',
    placement: { kind: 'free', zMM: 0 },
    ...(target ? document.reliefDefinitions.defaults[target.ownerNodeId] : {}),
    ...Object.values(document.reliefDefinitions.overrides).find(
      (item) => target && sameOutputRef(item.target, target),
    )?.value,
  };
  const set = (value: Partial<ReliefValue>) =>
    onAction({ kind: 'set-relief', target, value });
  const placement = definition.placement;
  const manufacturing = document.manufacturing;
  const partId = target ? partForRelief(document, { ref: target }) : '';
  return (
    <details>
      <summary>打印与零件</summary>
      <p>编组只整理部件；制造零件决定哪些区域生成同一个实体。</p>
      <label>
        每层毫米
        <input
          aria-label="打印层高"
          type="number"
          min="0.001"
          step="0.01"
          defaultValue={manufacturing.layerHeightMM}
          key={manufacturing.layerHeightMM}
          onBlur={(event) =>
            onAction({
              kind: 'set-print-settings',
              layerHeightMM: Number(event.target.value),
            })
          }
        />
      </label>
      <button
        onClick={() =>
          onAction({
            kind: 'create-print-layer',
            name: `第 ${manufacturing.layerOrder.length + 1} 层`,
          })
        }
      >
        增加打印层
      </button>
      <ol>
        {manufacturing.layerOrder.map((id, index) => (
          <li key={id}>
            {manufacturing.layers[id].name}
            <button
              aria-label={`上移 ${manufacturing.layers[id].name}`}
              disabled={index === 0}
              onClick={() => {
                const order = [...manufacturing.layerOrder];
                [order[index - 1], order[index]] = [
                  order[index],
                  order[index - 1],
                ];
                onAction({ kind: 'set-print-settings', layerOrder: order });
              }}
            >
              上移
            </button>
          </li>
        ))}
      </ol>
      <button
        onClick={() =>
          onAction({
            kind: 'create-part',
            name: `零件 ${Object.keys(manufacturing.parts).length + 1}`,
          })
        }
      >
        增加制造零件
      </button>
      {target ? (
        <>
          <label>
            <input
              type="checkbox"
              checked={definition.enabled}
              onChange={(event) => set({ enabled: event.target.checked })}
            />
            此区域参与成品
          </label>
          <label>
            用途
            <select
              aria-label="区域用途"
              value={definition.mode}
              onChange={(event) =>
                set({ mode: event.target.value as ReliefValue['mode'] })
              }
            >
              <option value="add">增加材料</option>
              <option value="cut">切削材料</option>
              <option value="through">贯穿切削</option>
            </select>
          </label>
          <label>
            厚度单位
            <select
              aria-label="厚度单位"
              value={definition.thickness.kind}
              onChange={(event) =>
                set({
                  thickness:
                    event.target.value === 'layers'
                      ? {
                          kind: 'layers',
                          count: Math.max(
                            1,
                            Math.round(
                              (definition.thickness.kind === 'mm'
                                ? definition.thickness.value
                                : definition.thickness.count *
                                  manufacturing.layerHeightMM) /
                                manufacturing.layerHeightMM,
                            ),
                          ),
                        }
                      : {
                          kind: 'mm',
                          value:
                            definition.thickness.kind === 'layers'
                              ? definition.thickness.count *
                                manufacturing.layerHeightMM
                              : definition.thickness.value,
                        },
                })
              }
            >
              <option value="mm">毫米</option>
              <option value="layers">打印层数</option>
            </select>
          </label>
          <label>
            底面位置
            <select
              aria-label="底面位置"
              value={placement.kind}
              onChange={(event) => {
                const kind = event.target.value;
                if (kind === 'free')
                  set({ placement: { kind: 'free', zMM: 0 } });
                if (kind === 'layer' && manufacturing.layerOrder[0])
                  set({
                    placement: {
                      kind: 'layer',
                      layerId: manufacturing.layerOrder[0],
                      offsetMM: 0,
                    },
                  });
                if (kind === 'attached') {
                  const other = Object.values(document.nodes).find(
                    (node) =>
                      node.kind === 'shape' && node.id !== target.ownerNodeId,
                  );
                  if (other)
                    set({
                      placement: {
                        kind: 'attached',
                        target: { kind: 'node', id: other.id },
                        offsetMM: 0,
                      },
                    });
                }
              }}
            >
              <option value="free">指定高度</option>
              <option value="layer" disabled={!manufacturing.layerOrder.length}>
                打印层
              </option>
              <option
                value="attached"
                disabled={
                  Object.values(document.nodes).filter(
                    (node) => node.kind === 'shape',
                  ).length < 2
                }
              >
                放在其他部件上
              </option>
            </select>
          </label>
          {placement.kind === 'layer' && (
            <select
              aria-label="所在打印层"
              value={placement.layerId}
              onChange={(event) =>
                set({
                  placement: { ...placement, layerId: event.target.value },
                })
              }
            >
              {manufacturing.layerOrder.map((id) => (
                <option key={id} value={id}>
                  {manufacturing.layers[id].name}
                </option>
              ))}
            </select>
          )}
          {placement.kind === 'attached' && (
            <select
              aria-label="支撑部件"
              value={
                placement.target.kind === 'node' ? placement.target.id : ''
              }
              onChange={(event) =>
                set({
                  placement: {
                    ...placement,
                    target: { kind: 'node', id: event.target.value },
                  },
                })
              }
            >
              {Object.values(document.nodes)
                .filter(
                  (node) =>
                    node.kind === 'shape' && node.id !== target.ownerNodeId,
                )
                .map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
            </select>
          )}
          <label>
            {placement.kind === 'free' ? '底面毫米' : '偏移毫米'}
            <input
              key={JSON.stringify(placement)}
              aria-label="底面偏移"
              type="number"
              step="0.1"
              defaultValue={
                placement.kind === 'free' ? placement.zMM : placement.offsetMM
              }
              onBlur={(event) =>
                set({
                  placement:
                    placement.kind === 'free'
                      ? { ...placement, zMM: Number(event.target.value) }
                      : { ...placement, offsetMM: Number(event.target.value) },
                })
              }
            />
          </label>
          <label>
            制造零件
            <select
              aria-label="制造零件"
              value={partId}
              onChange={(event) =>
                onAction({
                  kind: 'set-manufacturing-part',
                  target,
                  partId: event.target.value,
                })
              }
            >
              {Object.values(manufacturing.parts).map((part) => (
                <option key={part.id} value={part.id}>
                  {part.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={isExcluded(document, { ref: target })}
              onChange={(event) =>
                onAction({
                  kind: 'set-manufacturing-excluded',
                  target,
                  excluded: event.target.checked,
                })
              }
            />
            从制造中排除
          </label>
        </>
      ) : (
        <p>选择区域后设置底面、层数和制造零件。</p>
      )}
    </details>
  );
}
