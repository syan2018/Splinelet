'use client';
import {
  objectTransformAttribute,
  type ObjectTransformDelta,
} from '@/lib/source-editor/object-transform-preview';
import { useMemo, useState } from 'react';
import { evaluateCurveProgram } from '@/lib/curve-modifiers.mjs';
import { creationDocument } from '@/lib/creation-schema.mjs';
import { selectCurvePreviews } from '@/lib/editor/curve-preview-selection.mjs';
import type { Project } from '@/lib/project';
import type { CurvePreview } from '@/lib/modifier-types';
import type { CreationRuntime } from './creation-runtime';

export function useCurvePreview(
  project: Project,
  objectId?: string,
  runtime?: Pick<
    CreationRuntime,
    'readCurvePreviews' | 'readEvaluatedCurvePreviews'
  >,
  evaluatedProject?: Project | null,
  live = true,
) {
  const [visibility, setVisibility] = useState({ objectId: '', enabled: true });
  const enabled = visibility.objectId === objectId ? visibility.enabled : true;
  const [choice, setChoice] = useState({ objectId: '', stageId: 'final' });
  // Browsing and rigid moves reuse the worker's evaluated scene. Only source
  // editing needs synchronous curve previews before the surface result arrives.
  const all = useMemo(() => {
    if (runtime) {
      if (!live && runtime.readEvaluatedCurvePreviews)
        return (
          runtime.readEvaluatedCurvePreviews(evaluatedProject || project) || []
        );
      return runtime.readCurvePreviews(project);
    }
    const doc = creationDocument(project) as NonNullable<Project['creation']>;
    return doc.objects
      .filter((o) => o.visible)
      .flatMap(
        (o) => evaluateCurveProgram(project, o).stages,
      ) as CurvePreview[];
  }, [project, runtime, evaluatedProject, live]);
  const focusedId = objectId;
  const stages = all.filter((s) => s.objectId === focusedId);
  const defaultStage =
    stages.find((stage) => stage.defaultPreview)?.stageId || 'final';
  const requested =
    choice.objectId === focusedId ? choice.stageId : defaultStage;
  const stageId = stages.some((s) => s.stageId === requested)
    ? requested
    : defaultStage;
  const previews = selectCurvePreviews(
    all,
    focusedId,
    enabled,
    stageId,
  ) as CurvePreview[];
  const focusedPreviews = previews.filter(
    (stage) => stage.objectId === focusedId,
  );
  const endpoints = focusedPreviews.reduce(
    (n, s) =>
      n + s.junctions.filter((junction) => junction.degree === 1).length,
    0,
  );
  const branches = focusedPreviews.reduce(
    (n, s) => n + s.junctions.filter((junction) => junction.degree > 2).length,
    0,
  );
  const diagnostics = [
    ...new Set(
      focusedPreviews.flatMap((s) => (s.diagnostic ? [s.diagnostic] : [])),
    ),
  ];
  return {
    previews,
    controls: focusedId && stages.length > 0 && (
      <div
        key={focusedId}
        className="curve-preview-controls"
        data-curve-preview-controls
        onPointerDown={(e) => e.stopPropagation()}
      >
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) =>
              setVisibility({ objectId: focusedId, enabled: e.target.checked })
            }
          />
          派生样条
        </label>
        {enabled && (
          <details className="curve-preview-details">
            <summary>
              {diagnostics.length ? '查看预览问题' : '预览设置'}
            </summary>
            <div className="curve-preview-options">
              {stages.length > 0 && (
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
              <span>仅预览当前部件的曲线阶段；取消选择后恢复完整结果。</span>
              {(endpoints > 0 || branches > 0) && (
                <output>
                  {endpoints > 0 &&
                    `橙点：${endpoints} 个开放端点。笔画无需闭合。`}
                  {branches > 0 && `红点：${branches} 处曲线分叉。`}
                </output>
              )}
              {diagnostics.map((diagnostic) => (
                <small key={diagnostic}>{diagnostic}</small>
              ))}
            </div>
          </details>
        )}
      </div>
    ),
  };
}

export function CurvePreviewOverlay({
  previews,
  project,
  scale,
  move,
}: {
  previews: CurvePreview[];
  project: Project;
  scale: number;
  move?: { nodeIds: string[]; delta: ObjectTransformDelta };
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
          transform={
            move?.nodeIds.includes(s.objectId)
              ? objectTransformAttribute(move.delta)
              : undefined
          }
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
