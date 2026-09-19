'use client';
import { useState } from 'react';
import type { Project } from '@/lib/project';

type Connection = {
  objectId: string;
  pathId: string;
  endpoint: number;
  status?: string;
};
type Diagnostic = Connection & { message?: string; gapMM: number };
type BoundaryOption = { id: string; name: string; gapMM: number };
type Closure = {
  objectId: string;
  featureId: string;
  regionId: string;
  boundaryRegionId?: string;
  boundaryOptions?: BoundaryOption[];
  disabled?: boolean;
  pathIds: string[];
};
type CreationObject = {
  id: string;
  joinMM?: number;
  disabledClosureFeatureIds?: string[];
  roles: Record<string, string>;
  modifiers?: { type: string; rolePathId?: string }[];
};
type CreationScene = {
  diagnostics?: Diagnostic[];
  connections: Connection[];
  closures?: Closure[];
};
type ConnectionProps = {
  object: CreationObject;
  scene: CreationScene;
  project: Project;
  preview?: CreationScene;
  onPreview: (distance: number) => void;
  onCancel: () => void;
  onApply: (distance: number) => void;
  onModifiers?: () => void;
  onCommand: (action: string, args: Record<string, unknown>) => void;
  onLocate: (paths: string[], connections?: (Connection | Closure)[]) => void;
};

// Construction controls are deliberately separate from source editing: these
// connections close derived faces and never append anchors to the drawn paths.
export default function CreationConnections(p: ConnectionProps) {
  const o = p.object;
  const sourceDistance = o.joinMM || 0.15;
  const [draft, setDraft] = useState<{
    objectId: string;
    source: number;
    value: number;
  }>();
  const distance =
    draft?.objectId === o.id && draft.source === sourceDistance
      ? draft.value
      : sourceDistance;
  const setDistance = (value: number) =>
    setDraft({ objectId: o.id, source: sourceDistance, value });
  const diagnostics = (p.scene?.diagnostics || []).filter(
    (d) => d.objectId === o.id,
  );
  const gaps = diagnostics.filter(
    (d) => d.status === 'unconnected' && d.pathId,
  );
  const connections =
    (p.preview || p.scene)?.connections.filter((c) => c.objectId === o.id) ||
    [];
  const disabled = diagnostics.filter((d) => d.status === 'disabled');
  const closures = (p.scene?.closures || []).filter(
    (c) => c.objectId === o.id && !c.disabled,
  );
  const features: string[] = [
    ...new Set<string>(closures.map((c) => c.featureId)),
  ];
  const disabledFeatures: string[] = o.disabledClosureFeatureIds || [];
  const name = (id: string) =>
    p.project.paths.find((path) => path.id === id)?.name || '线条';
  const featureName = (id: string) =>
    p.project.model?.features.find(
      (f: { id: string; name: string }) => f.id === id,
    )?.name || '带状面';
  const existing = diagnostics.filter((d) => d.status === 'existing_boundary');
  const divider = Object.entries(o.roles).some(
    ([id, role]) =>
      role === 'divider' &&
      !existing.some((d) => d.pathId === id) &&
      !o.modifiers?.some((m) => m.type === 'split' && m.rolePathId === id),
  );
  const valid = Number.isFinite(distance) && distance >= 0 && distance <= 5;
  return (
    <div className="creation-constructions">
      {o.modifiers?.some((m) => m.type === 'split' && m.rolePathId) && (
        <button onClick={p.onModifiers}>分区连接设置 · 修改器</button>
      )}
      {existing.map((d) => (
        <p className="creation-source-note" key={d.pathId}>
          {d.message}
        </p>
      ))}
      {divider && (
        <details
          className="creation-join"
          open={gaps.length > 0 || !!p.preview}
        >
          <summary>
            分区补边{gaps.length ? ` · ${gaps.length} 个端点未接合` : ''}
          </summary>
          {gaps.length > 0 && (
            <p className="creation-source-note">
              端点与边界仍差 {Math.min(...gaps.map((d) => d.gapMM)).toFixed(3)}–
              {Math.max(...gaps.map((d) => d.gapMM)).toFixed(3)} mm。
              线条看似相接，也可能留有不足一个像素的缺口。预览补齐后再接受。
            </p>
          )}
          {diagnostics
            .filter((d) => d.message && d.status !== 'existing_boundary')
            .map((d, i: number) => (
              <p key={i} className="creation-source-note">
                {d.message}
              </p>
            ))}
          <label>
            补边范围 mm
            <input
              type="number"
              aria-label="创作补边距离"
              min={0}
              max={5}
              step={0.01}
              value={Number.isFinite(distance) ? distance : ''}
              onChange={(e) => {
                setDistance(
                  e.target.value === '' ? NaN : Number(e.target.value),
                );
                p.onCancel();
              }}
            />
          </label>
          <div className="creation-connection-actions">
            <button disabled={!valid} onClick={() => p.onPreview(distance)}>
              预览补边
            </button>
            {gaps.length > 0 && (
              <button
                onClick={() => {
                  const d = Math.min(
                    5,
                    Math.ceil(
                      (Math.max(...gaps.map((d) => d.gapMM)) + 0.001) * 100,
                    ) / 100,
                  );
                  setDistance(d);
                  p.onPreview(d);
                }}
              >
                预览补齐小缺口
              </button>
            )}
          </div>
          {p.preview && (
            <div className="creation-source-note">
              <p>{connections.length} 处补边 · 橙色虚线仅供预览</p>
              <div className="creation-connection-actions">
                <button disabled={!valid} onClick={() => p.onApply(distance)}>
                  接受补边
                </button>
                <button onClick={p.onCancel}>取消预览</button>
              </div>
            </div>
          )}
          {!p.preview && (o.joinMM || 0) > 0 && (
            <p className="creation-source-note">
              已应用 · 范围 {o.joinMM} mm{' '}
              <button onClick={() => p.onApply(0)}>移除全部补边</button>
            </p>
          )}
          {!p.preview &&
            [...connections, ...disabled].map((c) => (
              <div
                className="creation-connection-row"
                key={c.pathId + ':' + c.endpoint}
              >
                <button
                  title="定位这条线及其端点"
                  onClick={() => p.onLocate([c.pathId], [c])}
                >
                  {name(c.pathId)} · {c.endpoint === 0 ? '起点' : '终点'}
                </button>
                <button
                  onClick={() =>
                    p.onCommand('connection', {
                      objectId: o.id,
                      pathId: c.pathId,
                      endpoint: c.endpoint,
                      disabled: c.status !== 'disabled',
                    })
                  }
                >
                  {c.status === 'disabled' ? '恢复补边' : '取消此补边'}
                </button>
              </div>
            ))}
        </details>
      )}
      {(features.length > 0 || disabledFeatures.length > 0) && (
        <details className="creation-join">
          <summary>构面封口 · {features.length} 个带状面</summary>
          <p className="creation-source-note">
            封口只影响面，不移动源节点。可直连端点，或沿已有裁切轮廓封口；改完可用
            Ctrl+Z 撤销。停用会隐藏对应面。
          </p>
          {features.map((id) => (
            <div className="creation-closure" key={id}>
              <span>
                {featureName(id)}
                {closures.some((c) => c.featureId === id && c.boundaryRegionId)
                  ? ' · 沿轮廓封口'
                  : ' · 端点直连'}
              </span>
              {[
                ...new Map<string, Closure>(
                  closures
                    .filter((c) => c.featureId === id)
                    .map((c) => [c.regionId, c]),
                ).values(),
              ].map((closure) => (
                <label key={closure.regionId}>
                  封口方式
                  <select
                    aria-label={'封口方式 ' + featureName(id)}
                    value={
                      closure.boundaryRegionId ||
                      p.project.model?.regions.find(
                        (r: { id: string; boundaryRegionId?: string }) =>
                          r.id === closure.regionId,
                      )?.boundaryRegionId ||
                      ''
                    }
                    onChange={(e) =>
                      p.onCommand('closure_boundary', {
                        objectId: o.id,
                        featureId: id,
                        regionId: closure.regionId,
                        boundaryRegionId: e.target.value || null,
                        joinMM: 0.15,
                      })
                    }
                  >
                    <option value="">端点直连</option>
                    {(closure.boundaryOptions || []).map((boundary) => (
                      <option
                        key={boundary.id}
                        value={boundary.id}
                        disabled={boundary.gapMM > 0.15}
                      >
                        沿 {boundary.name} · 间隙 {boundary.gapMM.toFixed(3)} mm
                        {boundary.gapMM > 0.15 ? '（先将端点移近轮廓）' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <div className="creation-connection-actions">
                <button
                  onClick={() => {
                    const list = closures.filter((c) => c.featureId === id);
                    p.onLocate(
                      [...new Set<string>(list.flatMap((c) => c.pathIds))],
                      list,
                    );
                  }}
                >
                  查看封口
                </button>
                <button
                  aria-label={'取消封口 ' + featureName(id)}
                  onClick={() =>
                    p.onCommand('remove_connection', {
                      objectId: o.id,
                      featureIds: [id],
                      disabled: true,
                    })
                  }
                >
                  取消封口与此面
                </button>
              </div>
            </div>
          ))}
          {disabledFeatures.map((id) => (
            <div className="creation-closure" key={id}>
              <span>{featureName(id)} · 已停用</span>
              <button
                aria-label={'恢复构面 ' + featureName(id)}
                onClick={() =>
                  p.onCommand('remove_connection', {
                    objectId: o.id,
                    featureIds: [id],
                    disabled: false,
                  })
                }
              >
                恢复封口与此面
              </button>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
