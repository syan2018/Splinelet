'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { ModifierNumber } from './modifier-controls';
import type { ModifierCommand, ModifierObject } from '@/lib/modifier-types';

const names: Record<string, string> = {
  curve_mirror: '曲线镜像',
  curve_array: '曲线阵列',
};

/** Existing add-form interaction, backed by explicitly available commands. */
export default function ProgramModifierAdd({
  object,
  onCommand,
}: {
  object: ModifierObject;
  onCommand: ModifierCommand;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('curve_mirror');
  const [count, setCount] = useState(4);
  const [angleDeg, setAngleDeg] = useState(90);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const options = (object.modifierAdd?.types || []).filter(
    (type) => names[type],
  );
  const type = options.includes(kind) ? kind : options[0];
  const available = Boolean(type);
  if (!open || !available)
    return (
      <>
        <button
          className="modifier-add"
          disabled={!available}
          title={object.modifierAdd?.reason || undefined}
          onClick={() => setOpen(true)}
        >
          <Plus size={15} />
          添加修改器
        </button>
        {!available && (
          <p className="modifier-hint">
            {object.modifierAdd?.reason || '当前没有可添加的修改器'}
          </p>
        )}
      </>
    );
  return (
    <div className="modifier-add-form">
      <label className="modifier-field">
        <span>操作</span>
        <select
          aria-label="新修改器类型"
          value={type}
          onChange={(event) => setKind(event.target.value)}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {names[option]}
            </option>
          ))}
        </select>
      </label>
      {type === 'curve_array' && (
        <ModifierNumber
          label="阵列数量"
          value={count}
          min={1}
          max={64}
          step={1}
          unit="份"
          onChange={setCount}
        />
      )}
      <ModifierNumber
        label={type === 'curve_array' ? '每份旋转角度' : '镜像轴角度'}
        value={angleDeg}
        min={-360}
        max={360}
        step={1}
        unit="°"
        onChange={setAngleDeg}
      />
      <ModifierNumber
        label={type === 'curve_array' ? '阵列中心 X' : '镜像中心 X'}
        value={x}
        min={-10000}
        max={10000}
        onChange={setX}
      />
      <ModifierNumber
        label={type === 'curve_array' ? '阵列中心 Y' : '镜像中心 Y'}
        value={y}
        min={-10000}
        max={10000}
        onChange={setY}
      />
      <p className="modifier-hint">
        源线保持可编辑，新线条由当前曲线派生。中心以毫米计，画布中心为 (0, 0)，Y
        轴向上。
      </p>
      <div className="modifier-actions">
        <button
          onClick={() => {
            onCommand('modifier_add', {
              objectId: object.id,
              type,
              name: names[type],
              targets: { kind: 'all' },
              angleDeg,
              centerMM: { x, y },
              ...(type === 'curve_array' ? { count } : {}),
            });
            setOpen(false);
          }}
        >
          添加
        </button>
        <button onClick={() => setOpen(false)}>取消</button>
      </div>
    </div>
  );
}
