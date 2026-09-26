'use client';
import { Layers } from 'lucide-react';
import NumberEdit from '../../shared/creation-number';
import { PrintPlacement } from '../creation-print-stack';
import {
  surfaceTarget,
  type PropertyContext,
  type PropertyContribution,
} from './property-context';

function PlacementProperties({ context: c }: { context: PropertyContext }) {
  if (c.scope === 'local') {
    const cells =
      c.scene?.cells.filter((cell) => c.cellKeys.includes(cell.key)) || [];
    return (
      <>
        <p className="creation-muted">
          当前仅查看所选区域的叠放位置。统一移动部件的全部区域，请先选择整个部件。
        </p>
        {cells.map((cell) => (
          <div key={cell.key} className="creation-property-block">
            <b>{cell.name || '区域'}</b>
            <p>
              {cell.printLayerId
                ? c.doc.printStack?.layers.find(
                    (layer) => layer.id === cell.printLayerId,
                  )?.name || '堆叠层已失效'
                : '独立叠放位置'}{' '}
              ·{' '}
              {cell.bottomMM == null
                ? '起始高度尚未求出'
                : `从 ${cell.bottomMM} mm 开始`}
            </p>
          </div>
        ))}
        <button onClick={() => c.select({ kind: 'object', ids: c.objects })}>
          选择所属部件
        </button>
      </>
    );
  }
  const object = c.current;
  return (
    <>
      <PrintPlacement
        doc={c.doc}
        scene={c.scene}
        objectIds={c.objects}
        disabled={c.disabled}
        onCommand={c.command}
        onManage={c.managePrint}
      />
      {!c.doc.printStack && c.objects.length === 1 && object && (
        <div className="creation-position">
          <div>
            起始高度 mm
            <NumberEdit
              label="对象起始高度"
              value={object.zMM}
              disabled={c.disabled}
              onCommit={(zMM) =>
                c.command('object', { id: object.id, changes: { zMM } })
              }
            />
          </div>
          <label>
            放到对象上
            <select
              aria-label="放到对象上"
              value={object.attachId || ''}
              disabled={c.disabled}
              onChange={(e) =>
                c.command('object', {
                  id: object.id,
                  changes: { attachId: e.target.value },
                })
              }
            >
              <option value="">平台 · Z = 0</option>
              {c.doc.objects
                .filter((o) => o.id !== object.id)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
          </label>
          <small>大纲顺序不改变物理高度；此处设置实际的上下关系。</small>
        </div>
      )}
      {!c.doc.printStack && c.objects.length > 1 && (
        <p className="creation-muted">
          起始高度与依附关系请单选部件后设置；启用打印分层后可以批量分配堆叠层。
        </p>
      )}
    </>
  );
}
export const placementProperties: PropertyContribution = {
  id: 'placement',
  label: '叠放',
  title: '当前选区叠放位置',
  heading: '位置与叠放',
  icon: Layers,
  order: 40,
  supports: surfaceTarget,
  Panel: PlacementProperties,
};
