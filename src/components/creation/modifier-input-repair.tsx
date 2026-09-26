'use client';
import { useEffect, useRef, useState } from 'react';
import { ResultPreview } from './modifier-result-preview';
import type { StudioDisplayProject } from '@/lib/editor/studio-display-types';
import type { CreationRuntime, ModifierInputRepair } from './creation-runtime';
import RegionSelectionRepair from './region-selection-repair';

function RepairContents({
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
  const view = runtime.readModifierInputs(project, ownerNodeId, modifierId);
  const [selected, setSelected] = useState<Record<string, string>>({});
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
  return (
    <div className="modifier-fields">
      <p className="modifier-hint">
        当前修订 {view.revision}
        。重新指定输入会保留本步参数和下游引用；仍未满足的局部选择会继续报告问题。
      </p>
      {view.outputs.map((port) => {
        const state = runtime.readModifierSnapshot(project, modifierId, port);
        const previous = state?.lastSuccessful;
        return previous ? (
          <ResultPreview
            key={port}
            stage={previous.stage}
            label={`${port === 'curves' ? '曲线' : '区域'} · ${state.freshness === 'current' ? '已更新' : '上次成功，仅供参考'} · 修订 ${previous.revision}`}
          />
        ) : null;
      })}
      {view.outputs.includes('regions') &&
        runtime.readModifierSnapshot(project, modifierId, 'regions')
          ?.lastSuccessful && (
          <>
            <button
              onClick={() => {
                try {
                  runtime.bakeModifierSnapshot(
                    project,
                    ownerNodeId,
                    modifierId,
                  );
                  onCommitted();
                } catch (error) {
                  setMessage(
                    error instanceof Error ? error.message : String(error),
                  );
                }
              }}
            >
              将区域快照保存为独立来源
            </button>
            <p className="modifier-hint">
              新增一个可保存、可撤销的固定来源；需要时可通过输入关联接入，不会自动替换当前链条。
            </p>
          </>
        )}
      {view.inputs.map((input) => {
        const key = `${input.input}:${input.index}`;
        return (
          <div key={key}>
            <p className="modifier-hint">
              输入 {input.input} {input.index + 1}：{input.label}
            </p>
            {input.diagnostics.map((item, index) => (
              <p key={index} className="modifier-error">
                {item.message}
              </p>
            ))}
            {!!input.options.length && (
              <>
                <select
                  aria-label={`替代输入 ${input.input} ${input.index + 1}`}
                  value={selected[key] || ''}
                  disabled={loading}
                  onChange={(event) => {
                    clear();
                    setSelected({ ...selected, [key]: event.target.value });
                  }}
                >
                  <option value="">选择新的来源…</option>
                  {input.options.map((option, index) => (
                    <option key={index} value={String(index)}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  disabled={loading || !selected[key]}
                  onClick={async () => {
                    setLoading(true);
                    setMessage('');
                    clear();
                    try {
                      const result = await runtime.prepareModifierInputRepair(
                        {
                          ownerNodeId,
                          operatorId: modifierId,
                          input: input.input,
                          index: input.index,
                          reference:
                            input.options[Number(selected[key])].reference,
                        },
                        { project },
                      );
                      if (!active.current) {
                        result.cancel();
                        return;
                      }
                      held.current = result;
                      setPrepared(result);
                    } catch (error) {
                      if (active.current)
                        setMessage(
                          error instanceof Error
                            ? error.message
                            : String(error),
                        );
                    } finally {
                      if (active.current) setLoading(false);
                    }
                  }}
                >
                  预览替换
                </button>
              </>
            )}
          </div>
        );
      })}
      {loading && <output>正在计算替换结果…</output>}
      {prepared && (
        <div>
          <p className="modifier-hint">
            此预览尚未写入工程。确认后可用 Ctrl+Z 撤销。
          </p>
          {Object.entries(prepared.ports).map(([port, stage]) => (
            <ResultPreview key={port} stage={stage} label="替换后结果" />
          ))}
          {(prepared.preview || [])
            .filter((item) => item.error)
            .map((item) => (
              <p key={item.modifierId} className="modifier-error">
                {item.controls?.values.name}：{item.error}
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
            确认替换输入
          </button>
          <button onClick={clear}>取消</button>
        </div>
      )}
      {message && (
        <p role="alert" className="modifier-error">
          {message}
        </p>
      )}
      <RegionSelectionRepair
        runtime={runtime}
        project={project}
        ownerNodeId={ownerNodeId}
        modifierId={modifierId}
        onCommitted={onCommitted}
      />
    </div>
  );
}

export default function ModifierInputRepairPanel(props: {
  runtime: CreationRuntime;
  project: StudioDisplayProject;
  ownerNodeId: string;
  modifierId: string;
  onCommitted: () => void;
}) {
  const [open, setOpen] = useState(false);
  // A new author revision discards any old proposal and selection.
  const identity = props.runtime.readRevision(props.project);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>输入关联与结果快照</summary>
      {open && <RepairContents key={identity} {...props} />}
    </details>
  );
}
