'use client';
import { useMemo, useState } from 'react';
import { evaluateCurveProgram } from '@/lib/curve-modifiers.mjs';
import { creationDocument } from '@/lib/creation-schema.mjs';
import type { Project } from '@/lib/project';
import type { CurvePreview } from '@/lib/modifier-types';
import type { CreationRuntime } from './creation-runtime';

export function useCurvePreview(
  project: Project,
  objectId?: string,
  runtime?: Pick<CreationRuntime, 'readCurvePreviews'>,
) {
  const [enabled, setEnabled] = useState(true);
  const [choice, setChoice] = useState({ objectId: '', stageId: 'final' });
  // This cheap, exact program stays live during a drag; it never waits for the
  // debounced surface worker and uses the very same curve evaluator as fill.
  const all = useMemo(() => {
    if (runtime) return runtime.readCurvePreviews(project);
    const doc = creationDocument(project) as NonNullable<Project['creation']>;
    return doc.objects
      .filter((o) => o.visible)
      .flatMap(
        (o) => evaluateCurveProgram(project, o).stages,
      ) as CurvePreview[];
  }, [project, runtime]);
  const focusedId = objectId || all[0]?.objectId;
  const stages = all.filter((s) => s.objectId === focusedId);
  const requested = choice.objectId === focusedId ? choice.stageId : 'final';
  const stageId = stages.some((s) => s.stageId === requested)
    ? requested
    : 'final';
  const previews = useMemo(() => {
    if (!enabled) return [];
    const latest = new Map<string, CurvePreview>();
    for (const stage of all) latest.set(stage.objectId, stage);
    const chosen = all.find(
      (s) => s.objectId === focusedId && s.stageId === stageId,
    );
    if (chosen) latest.set(chosen.objectId, chosen);
    return [...latest.values()];
  }, [all, enabled, focusedId, stageId]);
  return {
    previews,
    controls: all.length > 0 && (
      <div
        className="curve-preview-controls"
        data-curve-preview-controls
        title="修改源节点，派生曲线即时更新；橙点表示当前仍未接合的端点"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          派生样条
        </label>
        {enabled && stages.length > 0 && (
          <select
            aria-label="样条预览阶段"
            value={stageId}
            onChange={(e) =>
              setChoice({ objectId: focusedId!, stageId: e.target.value })
            }
          >
            <option value="final">
              {runtime ? '最终曲线' : '最终曲线 / 构面输入'}
            </option>
            {stages
              .filter((stage) => stage.stageId !== 'final')
              .map((s) => (
                <option key={s.stageId} value={s.stageId}>
                  {s.name}
                </option>
              ))}
          </select>
        )}
        {enabled && (
          <output>
            青线：预览 · 橙点：未接合{' '}
            {previews.reduce((n, s) => n + s.junctions.length, 0)}
          </output>
        )}
        {enabled && previews.some((s) => s.diagnostic) && (
          <small role="alert">
            {previews.find((s) => s.diagnostic)?.diagnostic}
          </small>
        )}
      </div>
    ),
  };
}

export function CurvePreviewOverlay({
  previews,
  project,
  scale,
}: {
  previews: CurvePreview[];
  project: Project;
  scale: number;
}) {
  const mm = project.width / project.widthMM;
  const xy = ({ x, y }: { x: number; y: number }) =>
    `${project.width / 2 + x * mm},${project.height / 2 - y * mm}`;
  return (
    <g
      className="derived-curve-preview"
      pointerEvents="none"
      aria-label="修改器后的样条预览"
    >
      {previews.map((s) => (
        <g
          key={s.objectId}
          data-curve-preview-object={s.objectId}
          data-curve-preview-stage={s.stageId}
        >
          <path
            data-derived-curves={s.curves.length}
            d={s.curves
              .map((c) => `M${xy(c[0])} C${xy(c[1])} ${xy(c[2])} ${xy(c[3])}`)
              .join(' ')}
            fill="none"
            stroke="#65d9ff"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
          {s.junctions.map(({ point, degree }, i) => (
            <circle
              key={i}
              data-curve-junction={degree}
              cx={project.width / 2 + point.x * mm}
              cy={project.height / 2 - point.y * mm}
              r={4 / scale}
              fill="#151c21"
              stroke={degree === 1 ? '#ffac62' : '#ff6475'}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            >
              <title>
                {degree === 1 ? '未接合端点' : `${degree} 条曲线分叉`} · (
                {point.x.toFixed(3)}, {point.y.toFixed(3)}) mm
              </title>
            </circle>
          ))}
        </g>
      ))}
    </g>
  );
}
