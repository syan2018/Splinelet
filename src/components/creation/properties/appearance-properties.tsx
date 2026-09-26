'use client';
import { Palette } from 'lucide-react';
import CreationColor from '../creation-color';
import {
  surfaceTarget,
  type PropertyContext,
  type PropertyContribution,
} from './property-context';

function AppearanceProperties({ context: c }: { context: PropertyContext }) {
  return (
    <>
      <CreationColor
        label={
          c.sourceOnly
            ? '默认颜色'
            : c.scope === 'local'
              ? `区域颜色 · ${c.cellKeys.length} 区`
              : '部件颜色'
        }
        colors={c.color.colors}
        swatches={c.doc.swatches}
        disabled={c.surfaceDisabled}
        onPaint={c.color.paint}
      />
      {c.scope === 'object' && (
        <p className="creation-muted">
          应用到
          {c.objects.length > 1 ? `所选 ${c.objects.length} 个部件` : '此部件'}
          的全部区域。
        </p>
      )}
    </>
  );
}
export const appearanceProperties: PropertyContribution = {
  id: 'appearance',
  label: '颜色',
  title: '当前选区颜色',
  heading: '颜色与材质',
  icon: Palette,
  order: 20,
  supports: surfaceTarget,
  Panel: AppearanceProperties,
};
