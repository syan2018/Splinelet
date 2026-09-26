'use client';
import { PackageCheck } from 'lucide-react';
import type { PropertyContext, PropertyContribution } from './property-context';

function OutputProperties({ context: c }: { context: PropertyContext }) {
  const object = c.current;
  if (!object) return null;
  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={object.printable}
          disabled={c.disabled}
          onChange={(e) =>
            c.command('object', {
              id: object.id,
              changes: { printable: e.target.checked },
            })
          }
        />
        参与成品导出
      </label>
      <p className="creation-muted">
        控制此部件是否加入成品。完整工程的实体检查和文件导出位于“工程 → 导出”。
      </p>
    </>
  );
}
export const outputProperties: PropertyContribution = {
  id: 'output',
  label: '输出',
  title: '当前部件输出选项',
  heading: '成品参与',
  icon: PackageCheck,
  order: 60,
  supports: (target) => target.kind === 'shape' && target.count === 1,
  Panel: OutputProperties,
};
