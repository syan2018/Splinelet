'use client';
import { useEffect, useState } from 'react';

// Construction controls are deliberately separate from source editing: these
// connections close derived faces and never append anchors to the drawn paths.
export default function CreationConnections(p: {
  object: any;
  scene: any;
  project: any;
  preview: any;
  onPreview: (distance: number) => void;
  onCancel: () => void;
  onApply: (distance: number) => void;
  onCommand: (action: string, args: any) => void;
  onLocate: (paths: string[], connections?: any[]) => void;
}) {
  const o = p.object;
  const [distance, setDistance] = useState(o.joinMM || 0.15);
  useEffect(() => setDistance(o.joinMM || 0.15), [o.id, o.joinMM]);
  const diagnostics = (p.scene?.diagnostics || []).filter(
    (d: any) => d.objectId === o.id,
  );
  const gaps = diagnostics.filter(
    (d: any) => d.status === 'unconnected' && d.pathId,
  );
  const connections =
    (p.preview || p.scene)?.connections.filter(
      (c: any) => c.objectId === o.id,
    ) || [];
  const disabled = diagnostics.filter((d: any) => d.status === 'disabled');
  const closures = (p.scene?.closures || []).filter(
    (c: any) => c.objectId === o.id && !c.disabled,
  );
  const features: string[] = [
    ...new Set<string>(closures.map((c: any) => c.featureId)),
  ];
  const disabledFeatures: string[] = o.disabledClosureFeatureIds || [];
  const name = (id: string) =>
    p.project.paths.find((path: any) => path.id === id)?.name || '线条';
  const featureName = (id: string) =>
    p.project.model?.features.find((f: any) => f.id === id)?.name || '带状面';
  const divider = Object.values(o.roles).includes('divider');
  const valid = Number.isFinite(distance) && distance >= 0 && distance <= 5;
  return (
    <div className="creation-constructions">
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
              端点与边界仍差{' '}
              {Math.min(...gaps.map((d: any) => d.gapMM)).toFixed(3)}–
              {Math.max(...gaps.map((d: any) => d.gapMM)).toFixed(3)} mm。
              线条看似相接，也可能留有不足一个像素的缺口。预览补齐后再接受。
            </p>
          )}
          {diagnostics
            .filter((d: any) => d.message)
            .map((d: any, i: number) => (
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
                      (Math.max(...gaps.map((d: any) => d.gapMM)) + 0.001) *
                        100,
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
            [...connections, ...disabled].map((c: any) => (
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
            两条开放样条之间的带状面需要封口。橙色虚线显示自动生成的直边；取消封口会停用对应面，源样条和其他面保留。
          </p>
          {features.map((id) => (
            <div className="creation-closure" key={id}>
              <span>{featureName(id)}</span>
              <div className="creation-connection-actions">
                <button
                  onClick={() => {
                    const list = closures.filter(
                      (c: any) => c.featureId === id,
                    );
                    p.onLocate(
                      [...new Set<string>(list.flatMap((c: any) => c.pathIds))],
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
