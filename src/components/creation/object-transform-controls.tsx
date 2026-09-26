'use client';
import { useState } from 'react';
import { ArrowRight, Crosshair, Move, RotateCw, Scaling } from 'lucide-react';

export type ObjectTransformMode = 'translate' | 'rotate' | 'scale';

export const objectTransformModes = [
  { mode: 'translate', label: '移动', key: 'G', icon: Move },
  { mode: 'rotate', label: '旋转', key: 'R', icon: RotateCw },
  { mode: 'scale', label: '缩放', key: 'S', icon: Scaling },
] as const;

export function ObjectTransformModes({
  mode,
  onMode,
  compact = false,
}: {
  mode: ObjectTransformMode;
  onMode: (mode: ObjectTransformMode) => void;
  compact?: boolean;
}) {
  return (
    <fieldset
      className={`object-transform-modes${compact ? ' is-compact' : ''}`}
      aria-label="变换模式"
    >
      {objectTransformModes.map(({ mode: value, label, key, icon: Icon }) => (
        <button
          type="button"
          key={value}
          title={`${label} (${key})`}
          aria-label={compact ? `变换：${label}` : label}
          aria-keyshortcuts={key}
          aria-pressed={mode === value}
          onClick={() => onMode(value)}
        >
          <Icon size={compact ? 16 : 20} aria-hidden="true" />
          <span>{label}</span>
          <kbd>{key}</kbd>
        </button>
      ))}
    </fieldset>
  );
}

export default function ObjectTransformControls({
  mode,
  onMode,
  disabled,
  selectionLabel,
  onApply,
}: {
  mode: ObjectTransformMode;
  onMode: (mode: ObjectTransformMode) => void;
  disabled: boolean;
  selectionLabel: string | null;
  onApply: (args: Record<string, unknown>) => void;
}) {
  const [x, setX] = useState('0'),
    [y, setY] = useState('0');
  const [angle, setAngle] = useState('15'),
    [factor, setFactor] = useState('100');
  return (
    <section className="object-transform-controls" aria-label="对象变换">
      <ObjectTransformModes mode={mode} onMode={onMode} />
      <div className="object-transform-target" aria-live="polite">
        <Crosshair size={16} aria-hidden="true" />
        <div>
          <small>{selectionLabel ? '当前选区' : '先选择要变换的对象'}</small>
          <strong title={selectionLabel || undefined}>
            {selectionLabel || '点击画布上的部件，或在大纲中选择'}
          </strong>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (disabled) return;
          onApply(
            mode === 'translate'
              ? { mode, deltaMM: [Number(x), Number(y)] }
              : mode === 'rotate'
                ? { mode, angleRad: (Number(angle) * Math.PI) / 180 }
                : { mode, factor: Number(factor) / 100 },
          );
        }}
      >
        <fieldset disabled={disabled} className="object-transform-fields">
          <legend>
            {
              { translate: '位移距离', rotate: '旋转角度', scale: '等比缩放' }[
                mode
              ]
            }
          </legend>
          <p className="object-transform-caption">
            {mode === 'translate' ? '相对于当前位置' : '以选区中心为基点'}
          </p>
          {mode === 'translate' ? (
            <div className="object-transform-axes">
              <label className="object-transform-value">
                <span className="object-transform-axis-x">X</span>
                <input
                  aria-label="X 位移 (mm)"
                  type="number"
                  step="any"
                  required
                  value={x}
                  onChange={(e) => setX(e.target.value)}
                />
                <small>mm</small>
              </label>
              <label className="object-transform-value">
                <span className="object-transform-axis-y">Y</span>
                <input
                  aria-label="Y 位移 (mm)"
                  type="number"
                  step="any"
                  required
                  value={y}
                  onChange={(e) => setY(e.target.value)}
                />
                <small>mm</small>
              </label>
            </div>
          ) : mode === 'rotate' ? (
            <label className="object-transform-value">
              <RotateCw size={16} aria-hidden="true" />
              <input
                aria-label="旋转角度"
                type="number"
                step="any"
                required
                value={angle}
                onChange={(e) => setAngle(e.target.value)}
              />
              <small>°</small>
            </label>
          ) : (
            <label className="object-transform-value">
              <Scaling size={16} aria-hidden="true" />
              <input
                aria-label="等比缩放"
                type="number"
                min="0.01"
                step="any"
                required
                value={factor}
                onChange={(e) => setFactor(e.target.value)}
              />
              <small>%</small>
            </label>
          )}
          <button
            className="object-transform-apply"
            aria-label="应用到选中对象"
            type="submit"
          >
            {
              { translate: '应用位移', rotate: '应用旋转', scale: '应用缩放' }[
                mode
              ]
            }
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </fieldset>
      </form>
      <div className="object-transform-guide">
        <b>画布变换控件</b>
        <p>
          {mode === 'translate'
            ? '拖动对象或选框移动；四角缩放，顶部圆柄旋转。'
            : mode === 'rotate'
              ? '拖动选框顶部的圆柄，围绕选区中心旋转。'
              : '拖动选框四角等比缩放，对角保持固定。'}
        </p>
        <span>
          <kbd>Shift</kbd>
          {
            {
              translate: '限制水平 / 垂直',
              rotate: '每 15° 对齐',
              scale: '每 10% 对齐',
            }[mode]
          }
        </span>
        <span>
          <kbd>Esc</kbd>取消拖动
        </span>
        {mode === 'scale' && (
          <p>按住 Alt 以中心缩放。保持宽高比，不改变浮雕厚度。</p>
        )}
      </div>
    </section>
  );
}
