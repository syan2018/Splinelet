'use client';
import { Box } from 'lucide-react';
import CreationSelectionDetails from '../creation-selection-details';
import type { PropertyContext, PropertyContribution } from './property-context';
import { surfaceTarget } from './property-context';

function ShapeProperties({ context: c }: { context: PropertyContext }) {
  return (
    <>
      <CreationSelectionDetails
        selection={c.selection}
        objects={c.objects}
        project={c.project}
        scene={c.scene}
        onSelect={c.select}
        onEnable={() => c.height.commit(c.height.value)}
        onEdit={c.editSources}
      />
      {c.scope === 'object' && (
        <div className="creation-draw-actions">
          {[
            ['boundary', '画轮廓'],
            ['divider', '画分区线'],
            ['hole', '画挖洞轮廓'],
          ].map(([role, label]) => (
            <button
              key={role}
              disabled={c.disabled}
              onClick={() => c.draw(role)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {c.sourceOnly && (
        <p className="creation-source-note">
          仅有线条 · 尚未构面。可以继续闭合轮廓，或把线条用于分区、参考。
        </p>
      )}
      {c.scope === 'object' && c.objects.length > 1 && (
        <button
          disabled={c.disabled}
          onClick={() => c.command('combine_objects', { objectIds: c.objects })}
        >
          整理为一个部件
        </button>
      )}
      <p className="creation-muted">
        颜色、浮雕厚度、叠放位置和输出选项在各自的分类中设置。
      </p>
    </>
  );
}

export const shapeProperties: PropertyContribution = {
  id: 'object',
  label: '形状',
  title: '当前选区形状',
  heading: '形状与边界',
  icon: Box,
  order: 10,
  supports: surfaceTarget,
  Panel: ShapeProperties,
};
