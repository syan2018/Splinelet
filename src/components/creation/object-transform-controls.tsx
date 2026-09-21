'use client';
import { useState } from 'react';

export type ObjectTransformMode = 'translate' | 'rotate' | 'scale';

export default function ObjectTransformControls({
  mode,
  onMode,
  disabled,
  onApply,
}: {
  mode: ObjectTransformMode;
  onMode: (mode: ObjectTransformMode) => void;
  disabled: boolean;
  onApply: (args: Record<string, unknown>) => void;
}) {
  const [x, setX] = useState('0'),
    [y, setY] = useState('0');
  const [angle, setAngle] = useState('15'),
    [factor, setFactor] = useState('100');
  return (
    <section className="object-transform-controls" aria-label="对象变换">
      <div className="creation-actions">
        {(['translate', 'rotate', 'scale'] as const).map((item) => (
          <button
            key={item}
            aria-pressed={mode === item}
            onClick={() => onMode(item)}
          >
            {{ translate: '移动', rotate: '旋转', scale: '缩放' }[item]}
          </button>
        ))}
      </div>
      <p>
        在大纲选择部件或对象组，再拖动面或源线。旋转与等比缩放以选区中心为基点；Shift
        约束方向、15° 或 10% 步进。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onApply(
            mode === 'translate'
              ? { mode, deltaMM: [Number(x), Number(y)] }
              : mode === 'rotate'
                ? { mode, angleRad: (Number(angle) * Math.PI) / 180 }
                : { mode, factor: Number(factor) / 100 },
          );
        }}
      >
        {mode === 'translate' ? (
          <>
            <label>
              X 位移 (mm)
              <input
                aria-label="X 位移 (mm)"
                type="number"
                step="any"
                required
                value={x}
                onChange={(e) => setX(e.target.value)}
              />
            </label>
            <label>
              Y 位移 (mm)
              <input
                aria-label="Y 位移 (mm)"
                type="number"
                step="any"
                required
                value={y}
                onChange={(e) => setY(e.target.value)}
              />
            </label>
          </>
        ) : mode === 'rotate' ? (
          <label>
            旋转角度 (°)
            <input
              aria-label="旋转角度"
              type="number"
              step="any"
              required
              value={angle}
              onChange={(e) => setAngle(e.target.value)}
            />
          </label>
        ) : (
          <label>
            等比缩放 (%)
            <input
              aria-label="等比缩放"
              type="number"
              min="0.01"
              step="any"
              required
              value={factor}
              onChange={(e) => setFactor(e.target.value)}
            />
          </label>
        )}
        <button disabled={disabled} type="submit">
          应用到选中对象
        </button>
      </form>
    </section>
  );
}
