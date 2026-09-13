'use client';
import { useState } from 'react';
import {
  GripVertical,
  ChevronDown,
  ChevronRight,
  Plus,
  Layers,
} from 'lucide-react';
import {
  SurfaceTargets,
  ModifierInput,
  ModifierNumber,
  ModifierName,
} from './modifier-controls';
import { targetForCell } from '@/lib/modifier-schema.mjs';
import ConstructionPipeline from './construction-pipeline';
import type {
  SurfaceModifier,
  ModifierInputRef,
  ModifierProject,
  ModifierObject,
  ModifierScene,
  ModifierCommand,
  SurfaceScope,
} from '@/lib/modifier-types';

const operationNames: Record<string, string> = {
  difference: '挖洞',
  intersection: '相交',
  union: '合并',
  split: '分区',
  offset: '轮廓偏移',
};

function ModifierStack({
  stack,
  object,
  project,
  scene,
  sourceFeatureId,
  onCommand,
}: {
  stack: SurfaceModifier[];
  object: ModifierObject;
  project: ModifierProject;
  scene?: ModifierScene;
  sourceFeatureId?: string;
  onCommand: ModifierCommand;
}) {
  const [expanded, setExpanded] = useState<string[]>([]),
    [drag, setDrag] = useState<string | null>(null);
  const send = (action: string, args: Record<string, unknown>) =>
    onCommand(action, { objectId: object.id, sourceFeatureId, ...args });
  const move = (id: string, beforeId: string | null) =>
    send('modifier_move', { modifierId: id, beforeId });
  return (
    <div
      className="modifier-stack"
      onDragOver={(e) => {
        if (drag) e.preventDefault();
      }}
      onDrop={(e) => {
        if (drag) {
          e.preventDefault();
          const beforeId =
            (e.target as Element)
              .closest('[data-modifier-id]')
              ?.getAttribute('data-modifier-id') || null;
          if (drag !== beforeId) move(drag, beforeId);
          setDrag(null);
        }
      }}
    >
      {stack.map((m, index: number) => {
        const status = scene?.modifierStatus?.find(
          (s) => s.objectId === object.id && s.modifierId === m.id,
        );
        const options =
          status?.inputOptions ||
          (scene?.modifierBaseCells || scene?.cells || [])
            .filter((c) => c.objectId === object.id)
            .map((c) => ({
              ref: targetForCell(c),
              name: c.name || '区域',
            }));
        const unique = [
          ...new Map(options.map((o) => [o.ref.key, o])).values(),
        ];
        const open = expanded.includes(m.id),
          update = (changes: Partial<SurfaceModifier>) =>
            send('modifier_update', { modifierId: m.id, changes });
        const inputName =
          m.input?.kind === 'object'
            ? scene?.creation.objects.find((o) => o.id === m.input?.id)?.name
            : m.input?.kind === 'region'
              ? project.model?.regions.find((r) => r.id === m.input?.id)?.name
              : project.paths.find((p) => p.id === m.input?.id)?.name;
        return (
          <article
            aria-label={m.name}
            key={m.id}
            className={
              'modifier-card ' +
              (!m.enabled ? 'disabled ' : '') +
              (status?.error ? 'has-error' : '')
            }
            data-modifier-id={m.id}
          >
            <div className="modifier-card-header">
              <span
                draggable
                className="modifier-grip"
                title="拖动排序"
                onDragStart={(e) => {
                  setDrag(m.id);
                  e.dataTransfer.setData('application/x-modifier', m.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setDrag(null)}
              >
                <GripVertical size={14} />
              </span>
              <input
                type="checkbox"
                checked={m.enabled}
                aria-label={'启用 ' + m.name}
                onChange={(e) => update({ enabled: e.target.checked })}
              />
              <button
                className="modifier-expand"
                aria-label={'参数 ' + m.name}
                aria-expanded={open}
                onClick={() =>
                  setExpanded(
                    open
                      ? expanded.filter((id) => id !== m.id)
                      : [...expanded, m.id],
                  )
                }
              >
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <ModifierName
                value={m.name}
                onChange={(name: string) => update({ name })}
              />
              <details className="modifier-menu">
                <summary aria-label={'操作 ' + m.name}>⋯</summary>
                <div>
                  <button
                    disabled={index === 0}
                    onClick={(e) => {
                      send('modifier_move', {
                        modifierId: m.id,
                        direction: -1,
                      });
                      e.currentTarget
                        .closest('details')
                        ?.removeAttribute('open');
                    }}
                  >
                    上移
                  </button>
                  <button
                    disabled={index === stack.length - 1}
                    onClick={(e) => {
                      send('modifier_move', { modifierId: m.id, direction: 1 });
                      e.currentTarget
                        .closest('details')
                        ?.removeAttribute('open');
                    }}
                  >
                    下移
                  </button>
                  <button
                    onClick={() =>
                      send('modifier_remove', { modifierId: m.id })
                    }
                  >
                    删除修改器
                  </button>
                </div>
              </details>
            </div>
            {!sourceFeatureId && (
              <SurfaceTargets
                value={m.targets}
                options={unique}
                label={'作用范围 ' + m.name}
                onChange={(targets: SurfaceScope) => update({ targets })}
              />
            )}
            {!open && (
              <button
                className="modifier-summary"
                onClick={() => setExpanded([...expanded, m.id])}
              >
                {operationNames[m.operation || m.type]}
                {m.type === 'offset'
                  ? ` ${m.distanceMM} mm`
                  : `：${inputName || '来源缺失'}`}
              </button>
            )}
            {open && (
              <div className="modifier-parameters">
                {m.type === 'boolean' && (
                  <label className="modifier-field">
                    <span>运算</span>
                    <select
                      aria-label={'运算 ' + m.name}
                      value={m.operation}
                      onChange={(e) => update({ operation: e.target.value })}
                    >
                      {['difference', 'intersection', 'union'].map((op) => (
                        <option key={op} value={op}>
                          {operationNames[op]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {m.type !== 'offset' && (
                  <ModifierInput
                    value={m.input}
                    project={project}
                    objects={scene?.creation.objects || []}
                    objectId={object.id}
                    type={m.type}
                    nested={!!sourceFeatureId}
                    label={'来源 ' + m.name}
                    onChange={(input: ModifierInputRef) => update({ input })}
                  />
                )}
                {m.input?.kind === 'object' && (
                  <label className="modifier-outline">
                    <input
                      type="checkbox"
                      checked={m.input.projection === 'outline'}
                      onChange={(e) =>
                        update({
                          input: {
                            ...m.input!,
                            projection: e.target.checked
                              ? 'outline'
                              : 'surface',
                          },
                        })
                      }
                    />
                    仅取外轮廓，填平内孔
                  </label>
                )}
                {m.type === 'offset' && (
                  <ModifierNumber
                    label="轮廓偏移距离"
                    value={m.distanceMM}
                    onChange={(distanceMM: number) => update({ distanceMM })}
                  />
                )}
                {m.type === 'split' && (
                  <>
                    <ModifierNumber
                      label="端点接合范围"
                      value={m.joinMM || 0}
                      min={0}
                      max={5}
                      step={0.01}
                      onChange={(joinMM: number) => update({ joinMM })}
                    />
                    <p className="modifier-hint">
                      每一步用一条开放线把一个面分成两区；后续修改器可以只作用于其中一区。
                    </p>
                  </>
                )}
              </div>
            )}
            {status?.error && (
              <div className="modifier-error" role="alert">
                <p>此步已暂停：{status.error}</p>
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        `移除「${m.name}」及其后的 ${stack.length - index - 1} 个修改器？\n相关输出样式随步骤解除，源线保留。此操作可撤销。`,
                      )
                    )
                      send('modifier_truncate', {
                        modifierId: m.id,
                        confirm: true,
                      });
                  }}
                >
                  移除此步及下游…
                </button>
              </div>
            )}
            {status?.note && <p className="modifier-hint">{status.note}</p>}
          </article>
        );
      })}
    </div>
  );
}

export default function CreationModifiers({
  object,
  project,
  scene,
  cellKeys,
  onCommand,
  busy,
  onLocate,
}: {
  object?: ModifierObject;
  project: ModifierProject;
  scene?: ModifierScene;
  cellKeys: string[];
  onCommand: ModifierCommand;
  busy: boolean;
  onLocate?: (ids: string[]) => void;
}) {
  const [adding, setAdding] = useState(false),
    [kind, setKind] = useState('difference'),
    [input, setInput] = useState<ModifierInputRef | null>(null),
    [distance, setDistance] = useState(0.5);
  if (!object)
    return (
      <div className="creation-empty">
        <Layers size={24} />
        <p>先选择一个部件或区域，再添加修改器。</p>
      </div>
    );
  const type = ['difference', 'union', 'intersection'].includes(kind)
    ? 'boolean'
    : kind;
  const sourceEntries = Object.entries(object.sources || {});
  const add = () => {
    onCommand('modifier_add', {
      objectId: object.id,
      type,
      operation: kind,
      input,
      distanceMM: distance,
      name: operationNames[kind],
      cellKeys,
    });
    setAdding(false);
  };
  return (
    <fieldset
      className="creation-modifiers"
      key={object.id}
      disabled={busy}
      aria-busy={busy}
    >
      <div className="modifier-heading">
        <strong>{object.name}</strong>
        <span>修改器</span>
      </div>
      <p className="modifier-hint">
        从上到下计算。源线条保留，随时停用或撤销。
      </p>
      <ConstructionPipeline
        object={object}
        scene={scene}
        onCommand={onCommand}
        busy={busy}
        onLocate={onLocate}
      />
      <ModifierStack
        stack={object.modifiers || []}
        object={object}
        project={project}
        scene={scene}
        onCommand={onCommand}
      />
      {!object.modifiers?.length && (
        <p className="modifier-empty">当前直接使用基础面。</p>
      )}
      {!adding ? (
        <button className="modifier-add" onClick={() => setAdding(true)}>
          <Plus size={15} />
          添加修改器
        </button>
      ) : (
        <div className="modifier-add-form">
          <label className="modifier-field">
            <span>操作</span>
            <select
              aria-label="新修改器类型"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setInput(null);
              }}
            >
              {Object.entries(operationNames).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {type === 'offset' ? (
            <ModifierNumber
              label="轮廓偏移距离"
              value={distance}
              onChange={setDistance}
            />
          ) : (
            <ModifierInput
              value={input}
              project={project}
              objects={scene?.creation.objects || []}
              objectId={object.id}
              type={type}
              label="新修改器来源"
              onChange={setInput}
            />
          )}
          <p className="modifier-hint">
            {cellKeys.length
              ? `作用于当前选中的 ${cellKeys.length} 个面`
              : '作用于整个部件'}
            。添加后仍可修改范围。
          </p>
          <div className="modifier-actions">
            <button disabled={type !== 'offset' && !input} onClick={add}>
              添加
            </button>
            <button onClick={() => setAdding(false)}>取消</button>
          </div>
        </div>
      )}
      {!!sourceEntries.length && (
        <details className="modifier-sources">
          <summary>基础面来源 · {sourceEntries.length}</summary>
          <p className="modifier-hint">
            每个基础面先计算自己的构造，再进入上面的修改器栈。
          </p>
          {sourceEntries.map(([featureId, source]) => (
            <details key={featureId} className="modifier-source">
              <summary>
                {project.model?.features.find((f) => f.id === featureId)
                  ?.name || featureId}
              </summary>
              <p className="modifier-source-name">
                来源：
                {project.model?.regions.find((r) => r.id === source.regionId)
                  ?.name || '来源已删除'}
              </p>
              <ModifierStack
                stack={source.modifiers}
                object={object}
                project={project}
                scene={scene}
                sourceFeatureId={featureId}
                onCommand={onCommand}
              />
            </details>
          ))}
        </details>
      )}
      <p className="modifier-output">输出面 → 按“颜色与高低”中的厚度拉伸</p>
    </fieldset>
  );
}
