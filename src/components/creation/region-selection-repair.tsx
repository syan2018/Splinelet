'use client';
import { useEffect, useRef, useState } from 'react';
import type { CreationRuntime, ModifierInputRepair } from './creation-runtime';
import type { StudioDisplayProject } from '@/lib/editor/studio-display-types';
import type { OutputRef } from '@/lib/document/types';
import { ResultPreview } from './modifier-result-preview';
import { outputIdentity } from '@/lib/construction/output-identity.mjs';

export default function RegionSelectionRepair({
  runtime,
  project,
  ownerNodeId,
  modifierId,
  onCommitted,
}: {
  runtime: CreationRuntime;
  project: StudioDisplayProject;
  ownerNodeId: string;
  modifierId: string;
  onCommitted: () => void;
}) {
  const view = runtime.readRegionSelections(project, ownerNodeId, modifierId);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [prepared, setPrepared] = useState<ModifierInputRepair | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const active = useRef(true);
  const held = useRef<ModifierInputRepair | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      held.current?.cancel();
    };
  }, []);
  const clear = () => {
    held.current?.cancel();
    held.current = null;
    setPrepared(null);
  };
  if (!view.definitions.length) return null;
  const statusNames: Record<string, string> = {
    resolved: '已满足',
    blocked: '上游中断',
    missing: '需重新指定',
    ambiguous: '不唯一',
  };
  return (
    <details>
      <summary>局部区域选择 · {view.definitions.length} 项</summary>
      <p className="modifier-hint">
        这里保存的是明确的选择条件。重新选择会保留这项选择的颜色、高低与下游引用；已被另一项占用的面不能直接覆盖。
      </p>
      {view.definitions.map((definition, ordinal) => {
        const choice = choices[definition.definitionId];
        const candidate = choice
          ? definition.candidates[Number(choice)]
          : undefined;
        const value = view.geometryStage.value as
          | { regions?: { ref: OutputRef }[] }
          | undefined;
        const previewStage = candidate
          ? {
              ...view.geometryStage,
              value: {
                ...value,
                regions: value?.regions?.filter(
                  (region) =>
                    outputIdentity(region.ref) ===
                    outputIdentity(candidate.ref),
                ),
              },
            }
          : null;
        return (
          <div key={definition.definitionId}>
            <p className="modifier-hint">
              选择 {ordinal + 1} ·{' '}
              {statusNames[definition.status] || definition.status}
            </p>
            <select
              aria-label={`重指定局部选择 ${ordinal + 1}`}
              value={choices[definition.definitionId] || ''}
              disabled={loading}
              onChange={(event) => {
                clear();
                setChoices({
                  ...choices,
                  [definition.definitionId]: event.target.value,
                });
              }}
            >
              <option value="">选择当前结果…</option>
              {definition.candidates.map((item, index) => (
                <option
                  key={index}
                  value={String(index)}
                  disabled={!!item.occupiedByDefinitionId}
                >
                  {item.label}
                  {item.occupiedByDefinitionId ? '（已被占用）' : ''}
                </option>
              ))}
            </select>
            {previewStage && (
              <ResultPreview stage={previewStage} label="候选选择" />
            )}
            <button
              disabled={
                loading ||
                !choices[definition.definitionId] ||
                !!candidate?.occupiedByDefinitionId
              }
              onClick={async () => {
                if (!candidate) return;
                clear();
                setLoading(true);
                setMessage('');
                try {
                  const next = await runtime.prepareRegionSelectionRepair(
                    {
                      definitionId: definition.definitionId,
                      candidateRef: candidate.ref,
                    },
                    { project },
                  );
                  if (!active.current) {
                    next.cancel();
                    return;
                  }
                  held.current = next;
                  setPrepared(next);
                } catch (error) {
                  if (active.current)
                    setMessage(
                      error instanceof Error ? error.message : String(error),
                    );
                } finally {
                  if (active.current) setLoading(false);
                }
              }}
            >
              预览重新选择
            </button>
          </div>
        );
      })}
      {loading && <output>正在检查选择影响…</output>}
      {prepared && (
        <div>
          <p className="modifier-hint">预览未写入工程。确认后可以撤销。</p>
          {prepared.preview
            ?.filter((item) => item.error)
            .map((item) => (
              <p className="modifier-error" key={item.modifierId}>
                {item.error}
              </p>
            ))}
          <button
            onClick={() => {
              try {
                prepared.commit();
                clear();
                onCommitted();
              } catch (error) {
                setMessage(
                  error instanceof Error ? error.message : String(error),
                );
                clear();
              }
            }}
          >
            确认重新选择
          </button>
          <button onClick={clear}>取消重新选择</button>
        </div>
      )}
      {message && (
        <p role="alert" className="modifier-error">
          {message}
        </p>
      )}
    </details>
  );
}
