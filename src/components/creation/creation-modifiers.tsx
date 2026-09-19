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
import { modifierStages } from '@/lib/modifier-stages.mjs';
import ConstructionPipeline from './construction-pipeline';
import type {
  SurfaceModifier,
  ModifierInputRef,
  ModifierProject,
  ModifierObject,
  ModifierScene,
  ModifierCommand,
  SurfaceScope,
  ModifierControls,
} from '@/lib/modifier-types';

const operationNames: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(modifierStages)
      .filter(([type]) => type !== 'boolean')
      .map(([type, stage]) => [type, stage.name]),
  ),
  difference: '挖洞',
  intersection: '相交',
  union: '合并',
};

const curveModifierTypes = new Set(['curve_mirror', 'curve_array', 'fill']);
const radialTypes = new Set(['radial_array', 'curve_array']);

function ProgramModifierCard({
  controls,
  error,
  note,
  onCommand,
}: {
  controls: ModifierControls;
  error?: string;
  note?: string;
  onCommand: ModifierCommand;
}) {
  const [open, setOpen] = useState(false);
  const { values, type } = controls;
  const editable = (field: string) =>
    !controls.locked && controls.editableFields.includes(field);
  const reason = (field: string) => {
    const diagnostic = controls.diagnostics
      .filter((item) => item.field === field)
      .map((item) => item.message)
      .join('；');
    return [
      controls.locked ? '部件已锁定' : '',
      controls.drivenFields.includes(field) ? '由参数或表达式驱动' : '',
      diagnostic,
    ]
      .filter(Boolean)
      .join('；');
  };
  const update = (changes: Record<string, unknown>) =>
    onCommand('modifier_update', {
      objectId: controls.ownerNodeId,
      modifierId: controls.operatorId,
      changes,
    });
  const number = (
    field: 'angleDeg' | 'count' | 'distanceMM',
    label: string,
    min: number,
    max: number,
    step = 0.1,
    unit = 'mm',
  ) => (
    <ModifierNumber
      label={label}
      value={values[field]}
      min={min}
      max={max}
      step={step}
      unit={unit}
      disabled={!editable(field)}
      note={reason(field)}
      onChange={(value) => update({ [field]: value })}
    />
  );
  const display = (value: number | undefined) => value ?? '未解析';
  const isRadial = radialTypes.has(type);
  const centerLabel = isRadial ? '阵列中心' : '镜像中心';
  const center = values.centerMM;
  const summary = isRadial
    ? `${operationNames[type]}：${display(values.count)} 份 · 每 ${display(values.angleDeg)}° · 中心 (${display(center?.x)}, ${display(center?.y)}) mm`
    : type === 'curve_mirror'
      ? `曲线镜像：轴 ${display(values.angleDeg)}° · 中心 (${display(center?.x)}, ${display(center?.y)}) mm`
      : type === 'offset'
        ? `轮廓偏移 ${display(values.distanceMM)} mm`
        : type === 'boolean'
          ? operationNames[values.operation || ''] || '运算未解析'
          : values.name;
  return (
    <article
      aria-label={values.name}
      className={
        'modifier-card ' +
        (!values.enabled ? 'disabled ' : '') +
        (error ? 'has-error' : '')
      }
      data-modifier-id={controls.operatorId}
    >
      <div className="modifier-card-header">
        <span className="modifier-grip" title="此步骤暂不支持调整顺序">
          <GripVertical size={14} />
        </span>
        <input
          type="checkbox"
          checked={values.enabled}
          disabled={!editable('enabled')}
          aria-label={'启用 ' + values.name}
          onChange={(event) => update({ enabled: event.target.checked })}
        />
        <button
          className="modifier-expand"
          aria-label={'参数 ' + values.name}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <ModifierName
          value={values.name}
          disabled={!editable('name')}
          onChange={(name) => update({ name })}
        />
        <details className="modifier-menu">
          <summary aria-label={'操作 ' + values.name}>⋯</summary>
          <div>
            <button disabled title="此步骤暂不支持调整顺序">
              上移
            </button>
            <button disabled title="此步骤暂不支持调整顺序">
              下移
            </button>
            <button disabled title="此步骤暂不支持删除">
              删除修改器
            </button>
          </div>
        </details>
      </div>
      {!open && (
        <button className="modifier-summary" onClick={() => setOpen(true)}>
          {summary}
        </button>
      )}
      {open && (
        <div className="modifier-parameters">
          {type === 'boolean' && (
            <label className="modifier-field">
              <span>运算</span>
              <select
                aria-label={'运算 ' + values.name}
                value={values.operation ?? ''}
                disabled={!editable('operation')}
                onChange={(event) => update({ operation: event.target.value })}
              >
                {!['difference', 'intersection', 'union'].includes(
                  values.operation || '',
                ) && (
                  <option value={values.operation ?? ''} disabled>
                    {values.operation
                      ? '运算无效：' + values.operation
                      : '未解析'}
                  </option>
                )}
                {['difference', 'intersection', 'union'].map((operation) => (
                  <option key={operation} value={operation}>
                    {operationNames[operation]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {type === 'offset' && number('distanceMM', '轮廓偏移距离', -20, 20)}
          {isRadial && number('count', '阵列数量', 1, 64, 1, '份')}
          {(isRadial || type === 'curve_mirror') && (
            <>
              {number(
                'angleDeg',
                isRadial ? '每份旋转角度' : '镜像轴角度',
                -360,
                360,
                1,
                '°',
              )}
              {(['x', 'y'] as const).map((axis) => (
                <ModifierNumber
                  key={axis}
                  label={centerLabel + ' ' + axis.toUpperCase()}
                  value={center?.[axis]}
                  min={-10000}
                  max={10000}
                  disabled={!editable('centerMM') || !center}
                  note={
                    reason('centerMM') ||
                    (!center ? '中心未解析，不能以默认坐标覆盖' : '')
                  }
                  onChange={(value) => {
                    if (center)
                      update({ centerMM: { ...center, [axis]: value } });
                  }}
                />
              ))}
              <p className="modifier-hint">
                中心坐标以模型毫米为单位，画布中心为 (0, 0)，Y 轴向上。
              </p>
            </>
          )}
          <p className="modifier-hint">
            此处暂不支持更改来源、作用范围和接合参数。
          </p>
        </div>
      )}
      {controls.locked && (
        <p className="modifier-hint">部件已锁定，修改器只读。</p>
      )}
      {controls.drivenFields.length > 0 && (
        <p className="modifier-hint">
          含参数或表达式驱动值，普通数值输入不能解除绑定。
        </p>
      )}
      {error && (
        <div className="modifier-error" role="alert">
          <p>此步已暂停：{error}</p>
        </div>
      )}
      {note && note !== error && <p className="modifier-hint">{note}</p>}
    </article>
  );
}

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
            {!sourceFeatureId && !curveModifierTypes.has(m.type) && (
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
                {radialTypes.has(m.type)
                  ? `${operationNames[m.type]}：${m.count ?? 4} 份 · 每 ${m.angleDeg ?? 90}° · 中心 (${m.centerMM?.x ?? 0}, ${m.centerMM?.y ?? 0}) mm`
                  : m.type === 'curve_mirror'
                    ? `曲线镜像：轴 ${m.angleDeg ?? 90}° · 中心 (${m.centerMM?.x ?? 0}, ${m.centerMM?.y ?? 0}) mm`
                    : m.type === 'fill'
                      ? `闭合构面：接合 ${m.joinMM ?? 0.001} mm`
                      : operationNames[m.operation || m.type]}
                {m.type === 'offset'
                  ? ` ${m.distanceMM} mm`
                  : ![
                      'radial_array',
                      'curve_mirror',
                      'curve_array',
                      'fill',
                    ].includes(m.type) && `：${inputName || '来源缺失'}`}
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
                {!['offset', 'radial_array', ...curveModifierTypes].includes(
                  m.type,
                ) && (
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
                {radialTypes.has(m.type) && (
                  <>
                    <ModifierNumber
                      label="阵列数量"
                      value={m.count ?? 4}
                      min={1}
                      max={64}
                      step={1}
                      unit="份"
                      onChange={(count: number) => update({ count })}
                    />
                    <ModifierNumber
                      label="每份旋转角度"
                      value={m.angleDeg ?? 90}
                      min={-360}
                      max={360}
                      step={1}
                      unit="°"
                      onChange={(angleDeg: number) => update({ angleDeg })}
                    />
                    <ModifierNumber
                      label="阵列中心 X"
                      min={-10000}
                      max={10000}
                      value={m.centerMM?.x ?? 0}
                      onChange={(x: number) =>
                        update({ centerMM: { x, y: m.centerMM?.y ?? 0 } })
                      }
                    />
                    <ModifierNumber
                      label="阵列中心 Y"
                      min={-10000}
                      max={10000}
                      value={m.centerMM?.y ?? 0}
                      onChange={(y: number) =>
                        update({ centerMM: { x: m.centerMM?.x ?? 0, y } })
                      }
                    />
                    <p className="modifier-hint">
                      {m.type === 'radial_array'
                        ? '原面保留；每个面按此角度绕中心复制并合并。'
                        : '源线保持可编辑，复制线由此派生。'}
                      中心坐标以模型毫米为单位，画布中心为 (0, 0)，Y 轴向上。
                    </p>
                  </>
                )}
                {m.type === 'curve_mirror' && (
                  <>
                    <ModifierNumber
                      label="镜像轴角度"
                      value={m.angleDeg ?? 90}
                      min={-360}
                      max={360}
                      step={1}
                      unit="°"
                      onChange={(angleDeg: number) => update({ angleDeg })}
                    />
                    <ModifierNumber
                      label="镜像中心 X"
                      min={-10000}
                      max={10000}
                      value={m.centerMM?.x ?? 0}
                      onChange={(x: number) =>
                        update({ centerMM: { x, y: m.centerMM?.y ?? 0 } })
                      }
                    />
                    <ModifierNumber
                      label="镜像中心 Y"
                      min={-10000}
                      max={10000}
                      value={m.centerMM?.y ?? 0}
                      onChange={(y: number) =>
                        update({ centerMM: { x: m.centerMM?.x ?? 0, y } })
                      }
                    />
                    <p className="modifier-hint">
                      镜像轴从模型 +X 轴逆时针计角；中心以毫米计，画布中心为 (0,
                      0)，Y 轴向上。
                    </p>
                  </>
                )}
                {m.type === 'fill' && (
                  <>
                    <ModifierNumber
                      label="端点接合范围"
                      value={m.joinMM ?? 0.001}
                      min={0}
                      max={1}
                      step={0.001}
                      onChange={(joinMM: number) => update({ joinMM })}
                    />
                    <p className="modifier-hint">
                      将前面派生出的曲线闭合为面；源线与镜像、阵列副本仍可继续编辑。
                    </p>
                  </>
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
    [distance, setDistance] = useState(0.5),
    [count, setCount] = useState(4),
    [angleDeg, setAngleDeg] = useState(90),
    [centerX, setCenterX] = useState(0),
    [centerY, setCenterY] = useState(0),
    [joinMM, setJoinMM] = useState(0.001);
  if (!object)
    return (
      <div className="creation-empty">
        <Layers size={24} />
        <p>先选择一个部件或区域，再添加修改器。</p>
      </div>
    );
  const programStatuses = (scene?.modifierStatus || []).filter(
    (status) => status.objectId === object.id && status.controls,
  );
  if (scene?.modifierModel === 'program' || programStatuses.length) {
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
          源线条保持可编辑；在这里调整各步骤的参数。
        </p>
        <div className="modifier-stack">
          {programStatuses.map((status) => (
            <ProgramModifierCard
              key={status.modifierId}
              controls={status.controls!}
              error={status.error}
              note={status.note}
              onCommand={onCommand}
            />
          ))}
        </div>
        {!programStatuses.length && (
          <p className="modifier-empty">当前没有可展示的修改器参数。</p>
        )}
        <button className="modifier-add" disabled title="暂不支持添加新步骤">
          <Plus size={15} />
          添加修改器
        </button>
        <p className="modifier-hint">
          当前支持编辑已有步骤的名称、启用状态及参数，暂不支持增删和排序。
        </p>
        <p className="modifier-output">输出面 → 按“颜色与高低”中的厚度拉伸</p>
      </fieldset>
    );
  }
  const type = ['difference', 'union', 'intersection'].includes(kind)
    ? 'boolean'
    : kind;
  const sourceEntries = Object.entries(object.sources || {});
  const add = () => {
    const args: Record<string, unknown> = {
      objectId: object.id,
      type,
      operation: kind,
      name: operationNames[kind],
      cellKeys,
    };
    if (curveModifierTypes.has(type)) {
      delete args.cellKeys;
      args.targets = { kind: 'all' };
    }
    if (type === 'offset') args.distanceMM = distance;
    else if (radialTypes.has(type)) {
      args.count = count;
      args.angleDeg = angleDeg;
      args.centerMM = { x: centerX, y: centerY };
    } else if (type === 'curve_mirror') {
      args.angleDeg = angleDeg;
      args.centerMM = { x: centerX, y: centerY };
    } else if (type === 'fill') {
      args.joinMM = joinMM;
    } else if (input) args.input = input;
    onCommand('modifier_add', args);
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
      <p className="modifier-hint">
        曲线操作保留源线，闭合构面之后才能执行面操作。步骤顺序不匹配或轮廓未闭合时暂停输出，修复后恢复。
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
          ) : radialTypes.has(type) ? (
            <>
              <ModifierNumber
                label="阵列数量"
                value={count}
                min={1}
                max={64}
                step={1}
                unit="份"
                onChange={setCount}
              />
              <ModifierNumber
                label="每份旋转角度"
                value={angleDeg}
                min={-360}
                max={360}
                step={1}
                unit="°"
                onChange={setAngleDeg}
              />
              <ModifierNumber
                label="阵列中心 X"
                min={-10000}
                max={10000}
                value={centerX}
                onChange={setCenterX}
              />
              <ModifierNumber
                label="阵列中心 Y"
                min={-10000}
                max={10000}
                value={centerY}
                onChange={setCenterY}
              />
              <p className="modifier-hint">
                {type === 'radial_array'
                  ? '原面保留，复制面将合并。'
                  : '源线保持可编辑，复制线由此派生。'}
                中心坐标以模型毫米为单位，画布中心为 (0, 0)，Y 轴向上。
              </p>
            </>
          ) : type === 'curve_mirror' ? (
            <>
              <ModifierNumber
                label="镜像轴角度"
                value={angleDeg}
                min={-360}
                max={360}
                step={1}
                unit="°"
                onChange={setAngleDeg}
              />
              <ModifierNumber
                label="镜像中心 X"
                min={-10000}
                max={10000}
                value={centerX}
                onChange={setCenterX}
              />
              <ModifierNumber
                label="镜像中心 Y"
                min={-10000}
                max={10000}
                value={centerY}
                onChange={setCenterY}
              />
              <p className="modifier-hint">
                镜像轴从模型 +X 轴逆时针计角；中心以毫米计，画布中心为 (0, 0)，Y
                轴向上。
              </p>
            </>
          ) : type === 'fill' ? (
            <>
              <ModifierNumber
                label="端点接合范围"
                value={joinMM}
                min={0}
                max={1}
                step={0.001}
                onChange={setJoinMM}
              />
              <p className="modifier-hint">
                将当前派生曲线闭合为面；不需要额外的输入操作数。
              </p>
            </>
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
            {curveModifierTypes.has(type)
              ? '作用于整个部件的曲线构造'
              : cellKeys.length
                ? `作用于当前选中的 ${cellKeys.length} 个面`
                : '作用于整个部件'}
            。添加后仍可修改范围。
          </p>
          <div className="modifier-actions">
            <button
              disabled={
                !['offset', 'radial_array', ...curveModifierTypes].includes(
                  type,
                ) && !input
              }
              onClick={add}
            >
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
