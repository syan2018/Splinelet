'use client';
import { useEffect, useState } from 'react';

export default function CreationColor({
  colors,
  swatches,
  label,
  disabled,
  onPaint,
}: {
  colors: string[];
  swatches: { id: string; name: string; color: string }[];
  label: string;
  disabled: boolean;
  onPaint: (args: { color?: string; swatchId?: string }) => void;
}) {
  const unique = [...new Set(colors.map((c) => c.toLowerCase()))];
  const color = unique.length === 1 ? unique[0] : '';
  const [draft, setDraft] = useState(color);
  useEffect(() => setDraft(color), [color]);
  const valid = /^#[a-f0-9]{6}$/i.test(draft);
  const changed = valid && draft.toLowerCase() !== color;
  const commit = () => {
    if (!disabled && changed) onPaint({ color: draft });
  };
  return (
    <div className="creation-property-block creation-local-color">
      <label htmlFor="selection-project-color">
        {label}
        <span>{color ? color.toUpperCase() : '多种颜色'}</span>
      </label>
      <select
        id="selection-project-color"
        aria-label="所选区域的项目色"
        disabled={disabled}
        value={swatches.find((s) => s.color.toLowerCase() === color)?.id || ''}
        onChange={(e) => onPaint({ swatchId: e.target.value })}
      >
        <option value="" disabled>
          {color || '多种颜色'}
        </option>
        {swatches.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} · {s.color.toUpperCase()}
          </option>
        ))}
      </select>
      <div className="creation-color-custom">
        <input
          type="color"
          aria-label="自定义选区颜色"
          value={valid ? draft : color || '#ffffff'}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
        />
        <input
          type="text"
          aria-label="选区颜色 HEX"
          placeholder="#RRGGBB"
          value={draft}
          disabled={disabled}
          spellCheck={false}
          maxLength={7}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
            if (e.key === 'Escape') {
              e.stopPropagation();
              setDraft(color);
            }
          }}
        />
        <button disabled={disabled || !changed} onClick={commit}>
          应用
        </button>
      </div>
      <small>只修改当前选区；自定义颜色点「应用」。Ctrl+Z 撤销。</small>
    </div>
  );
}
