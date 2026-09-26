'use client';
import { ArrowUpFromLine } from 'lucide-react';
import NumberEdit from '../../shared/creation-number';
import { printMM } from '@/lib/print-stack.mjs';
import {
  surfaceTarget,
  type PropertyContext,
  type PropertyContribution,
} from './property-context';

function ReliefProperties({ context: c }: { context: PropertyContext }) {
  const h = c.height;
  return (
    <div className="creation-property-block">
      <label>
        {c.scope === 'object' ? '部件统一厚度' : '区域厚度'}{' '}
        <span>{h.layerHeight ? '打印层' : 'mm'}</span>
      </label>
      <div className="creation-height-input">
        <NumberEdit
          label={h.layerHeight ? '厚度打印层数' : '凸起厚度'}
          disabled={c.surfaceDisabled}
          value={h.value}
          min={h.min}
          max={h.max}
          step={h.layerHeight ? 1 : 0.1}
          onCommit={h.commit}
        />
        <button
          aria-pressed={h.active}
          disabled={c.surfaceDisabled}
          onClick={h.activate}
        >
          <ArrowUpFromLine size={17} />
          拖动调高
        </button>
      </div>
      <input
        aria-label="调整凸起厚度"
        type="range"
        disabled={c.surfaceDisabled}
        min={h.layerHeight ? 1 : 0.1}
        max={Math.max(h.layerHeight ? 30 : 6, h.value)}
        step={h.layerHeight ? 1 : 0.1}
        value={h.value}
        onPointerDown={h.begin}
        onChange={(e) => h.preview(+e.target.value)}
        onPointerUp={h.finish}
        onPointerCancel={h.cancel}
        onKeyUp={(e) => (e.key === 'Escape' ? h.cancel() : h.finish())}
      />
      {h.layerHeight && (
        <small>
          {h.value} × {h.layerHeight} mm = {printMM(h.value, h.layerHeight)} mm
        </small>
      )}
      <p className="creation-muted">
        厚度决定从起始平面向上凸起的高度；起始位置在“叠放”中设置。
      </p>
      {c.scope === 'object' && c.objects.length > 1 && (
        <p className="creation-muted">应用到全部选中部件的区域。</p>
      )}
    </div>
  );
}
export const reliefProperties: PropertyContribution = {
  id: 'relief',
  label: '浮雕',
  title: '当前选区浮雕厚度',
  heading: '浮雕厚度',
  icon: ArrowUpFromLine,
  order: 30,
  supports: surfaceTarget,
  Panel: ReliefProperties,
};
