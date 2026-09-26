'use client';
import { SlidersHorizontal } from 'lucide-react';
import CreationModifiers from '../creation-modifiers';
import {
  surfaceTarget,
  type PropertyContext,
  type PropertyContribution,
} from './property-context';

function ConstructionProperties({ context: c }: { context: PropertyContext }) {
  return (
    <>
      <CreationModifiers
        object={c.current}
        project={c.project}
        scene={c.scene || undefined}
        busy={c.disabled}
        cellKeys={c.scope === 'local' ? c.cellKeys : []}
        onLocate={c.locateSources}
        onCommand={c.command}
        renderRecovery={c.renderModifierRecovery}
      />
      {c.current && c.renderPostChain?.(c.current.id)}
      {c.connections}
    </>
  );
}
export const constructionProperties: PropertyContribution = {
  id: 'modifiers',
  label: '构造',
  title: '当前部件构造与修改器',
  heading: '构造与修改器',
  icon: SlidersHorizontal,
  order: 50,
  supports: (target) => surfaceTarget(target) && target.ownerCount === 1,
  Panel: ConstructionProperties,
};
