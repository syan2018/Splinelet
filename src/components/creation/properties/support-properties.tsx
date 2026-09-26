'use client';
import { Layers3 } from 'lucide-react';
import NumberEdit from '../../shared/creation-number';
import { printCount, printMM } from '@/lib/print-stack.mjs';
import type { PropertyContext, PropertyContribution } from './property-context';
function SupportProperties({ context: c }: { context: PropertyContext }) {
  const h = c.height.layerHeight;
  return (
    <>
      {c.scope === 'object' && (
        <details className="creation-base">
          <summary>生成承托部件 · 可选</summary>
          <p className="creation-muted">
            根据所选部件的外形生成新的承托部件，已有完整底层轮廓时无需添加。
          </p>
          <div>
            外扩边距 mm
            <NumberEdit
              label="底板外扩边距"
              value={c.support.margin}
              min={0}
              max={20}
              disabled={c.disabled}
              onCommit={c.support.setMargin}
            />
          </div>
          <div>
            底板厚度 {h ? '打印层' : 'mm'}
            <NumberEdit
              label="底板厚度"
              value={h ? printCount(c.support.heightMM, h) : c.support.heightMM}
              min={h ? 1 : 0.1}
              max={c.height.max}
              step={h ? 1 : 0.1}
              disabled={c.disabled}
              onCommit={(n) => c.support.setHeight(h ? printMM(n, h) : n)}
            />
          </div>
          <button disabled={c.disabled} onClick={c.support.preview}>
            预览底板
          </button>
          <small>
            {h
              ? '采用当前画笔色。底板占据新的最底层，现有层整体抬升。'
              : '采用当前画笔色。确认后所选部件放到底板顶面。'}
          </small>
        </details>
      )}
    </>
  );
}
export const supportProperties: PropertyContribution = {
  id: 'support',
  label: '承托',
  title: '为选中部件生成承托',
  heading: '承托部件',
  icon: Layers3,
  order: 55,
  supports: (target) => target.kind === 'shape',
  Panel: SupportProperties,
};
