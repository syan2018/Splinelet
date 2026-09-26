'use client';
import { Spline, Plus } from 'lucide-react';
import CreationSelectionDetails from '../creation-selection-details';
import type { PropertyContext, PropertyContribution } from './property-context';

function SourceProperties({ context: c }: { context: PropertyContext }) {
  const current = c.current;
  const owned = c.source.selectedPaths.filter((id) =>
    current?.pathIds.includes(id),
  );
  return (
    <>
      <CreationSelectionDetails
        selection={c.selection}
        objects={c.objects}
        project={c.project}
        scene={c.scene}
        onSelect={c.select}
        onEdit={c.editSources}
        onEnable={() => c.height.commit(c.height.value)}
      />
      <div className="creation-property-title">
        <b>线条编辑</b>
        <button onClick={c.newPath}>
          <Plus size={14} />
          新线条
        </button>
      </div>
      <div className="creation-source-settings">{c.source.inspector}</div>
      {current && c.objects.length === 1 && owned.length > 0 && (
        <div className="creation-role">
          <span>选中线条的用途</span>
          <div>
            {[
              ['boundary', '轮廓'],
              ['divider', '分区'],
              ['hole', '挖洞'],
              ['guide', '参考'],
            ].map(([role, label]) => (
              <button
                key={role}
                disabled={c.disabled || c.source.checking}
                aria-pressed={owned.every(
                  (id) =>
                    (current.roles[id] ||
                      (c.scene?.modifierModel === 'program'
                        ? undefined
                        : c.project.paths.find((path) => path.id === id)?.closed
                          ? 'boundary'
                          : 'guide')) === role,
                )}
                onClick={() => c.source.chooseRole(role)}
              >
                {label}
              </button>
            ))}
          </div>
          <small>分区保留共享边界；挖洞使用闭合线。参考线不参与填色。</small>
          {c.source.checking && <output>正在检查分区，完成后应用…</output>}
          {c.source.result && (
            <output className="creation-role-result">{c.source.result}</output>
          )}
        </div>
      )}
      {c.connections}
    </>
  );
}
export const sourceProperties: PropertyContribution = {
  id: 'lines',
  label: '线条',
  title: '当前源线属性',
  heading: '源线与用途',
  icon: Spline,
  order: 10,
  supports: (target) => target.kind === 'path',
  Panel: SourceProperties,
};
