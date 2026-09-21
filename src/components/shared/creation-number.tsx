'use client';
import { useRef, useState } from 'react';
export default function NumberEdit({
  label,
  value,
  onCommit,
  min = 0,
  max = 1000,
  step = 0.1,
  disabled = false,
}: {
  label: string;
  value: number | null;
  onCommit: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<{
    value: number | null;
    text: string;
  } | null>(null);
  const cancelled = useRef(false);
  const text =
    draft?.value === value
      ? draft.text
      : value == null
        ? ''
        : String(+value.toFixed(6));
  const commit = () => {
    setDraft(null);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (!draft || draft.value !== value) return;
    const n = Number(draft.text);
    if (
      draft.text.trim() &&
      Number.isFinite(n) &&
      n >= min &&
      n <= max &&
      (step !== 1 || Number.isInteger(n))
    ) {
      if (n !== value) onCommit(n);
    }
  };
  return (
    <input
      type="number"
      disabled={disabled}
      aria-label={label}
      placeholder={value == null ? '未设置' : undefined}
      min={min}
      max={max}
      step={step}
      value={text}
      onFocus={() => {
        cancelled.current = false;
      }}
      onChange={(e) => setDraft({ value, text: e.target.value })}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
