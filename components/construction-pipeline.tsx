'use client';
import type { ModifierCommand } from '@/lib/modifier-types';
type Output = { key: string; signature: string };
type Graph = { outputs: Output[] };
type PipelineObject = {
  id: string;
  name: string;
  pathIds?: string[];
  surfaceGraph?: Graph;
};
type PipelineScene = {
  errors?: { objectId: string; message: string; pathIds?: string[] }[];
  surfaceGraphs?: Record<string, Graph>;
  surfaceGraphCandidates?: Record<string, Graph>;
};

export default function ConstructionPipeline({
  object,
  scene,
  onCommand,
  onLocate,
  busy = false,
}: {
  object: PipelineObject;
  scene?: PipelineScene;
  onCommand: ModifierCommand;
  onLocate?: (ids: string[]) => void;
  busy?: boolean;
}) {
  const failure = scene?.errors?.find((e) => e.objectId === object.id);
  const graph = scene?.surfaceGraphs?.[object.id] || object.surfaceGraph;
  const proposal = scene?.surfaceGraphCandidates?.[object.id];
  const old = object.surfaceGraph?.outputs || [];
  const lost = proposal
    ? old.filter((o) => !proposal.outputs.some((n) => n.key === o.key)).length
    : 0;
  const added = proposal
    ? proposal.outputs.filter((o) => !old.some((n) => n.key === o.key)).length
    : 0;
  const ids = failure?.pathIds?.length ? failure.pathIds : object.pathIds || [];
  return (
    <section
      className={'construction-pipeline ' + (failure ? 'blocked' : '')}
      aria-label={object.name + ' 构造链'}
    >
      <div className="construction-stages">
        <span>源轮廓</span>
        <span>→ 分区轮廓 {graph?.outputs.length || ''}</span>
        <span>→ 面片</span>
        <span>→ 颜色 / 厚度</span>
        <span>→ 叠放 / 导出</span>
      </div>
      {failure ? (
        <>
          <strong>产出链已暂停</strong>
          <p>{failure.message}</p>
          <p className="modifier-hint">
            源线和下游设置保留。修复来源后自动恢复；暂停期间不能给失效面上色、拉伸或导出。
          </p>
          <div className="modifier-actions">
            {onLocate && ids.length > 0 && (
              <button disabled={busy} onClick={() => onLocate(ids)}>
                定位源线
              </button>
            )}
            {proposal && (
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `重建「${object.name}」的分区输出？\n${lost} 个失效输出将解除，${added} 个新输出使用部件默认设置。仍能对应的区域保留颜色和厚度。\n引用失效输出的后续修改器会继续暂停，需重新选择范围或移除重建。此操作可撤销。`,
                    )
                  )
                    onCommand('rebuild_surfaces', {
                      objectId: object.id,
                      confirm: true,
                    });
                }}
              >
                重建分区输出…
              </button>
            )}
          </div>
        </>
      ) : (
        <small>按来源引用计算 · 区域设置跟随输出轮廓</small>
      )}
    </section>
  );
}
