'use client';
import { useState } from 'react';
import type { JoinConnection, JoinEndpointOption } from '@/lib/modifier-types';
import JoinPreview from './join-preview';

export default function JoinConnections({
  value,
  options,
  onChange,
  disabled = false,
}: {
  value: JoinConnection[];
  options: JoinEndpointOption[];
  onChange: (value: JoinConnection[]) => void;
  disabled?: boolean;
}) {
  const [active, setActive] = useState(0);
  return (
    <fieldset disabled={disabled} className="modifier-parameters">
      <legend>端点连接</legend>
      <JoinPreview
        options={options}
        connection={value[Math.min(active, value.length - 1)]}
      />
      {!!value.length && (
        <p className="modifier-hint">
          连接 {Math.min(active + 1, value.length)} · A 金色 → B 青色
        </p>
      )}
      {value.map((connection, index) => (
        <div
          key={index}
          className="modifier-field"
          onFocusCapture={() => setActive(index)}
        >
          {(['a', 'b'] as const).map((side) => {
            const endpoint = connection[side];
            const current = JSON.stringify(endpoint);
            return (
              <label key={side}>
                {side === 'a' ? 'A · 从' : 'B · 接到'}
                <select
                  aria-label={`连接 ${index + 1} ${side}`}
                  value={current}
                  onChange={(event) => {
                    setActive(index);
                    const next = structuredClone(value);
                    next[index][side] = JSON.parse(event.target.value);
                    onChange(next);
                  }}
                >
                  {!options.some(
                    (option) => JSON.stringify(option.endpoint) === current,
                  ) && (
                    <option value={current}>
                      {endpoint.edgeEnd.edgeId} ·{' '}
                      {endpoint.edgeEnd.end === 'start' ? '起端' : '末端'} ·{' '}
                      {endpoint.selector?.index ?? '源'}
                    </option>
                  )}
                  {options.map((option) => (
                    <option
                      key={JSON.stringify(option.endpoint)}
                      value={JSON.stringify(option.endpoint)}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
                {endpoint.selector && (
                  <select
                    aria-label={`连接 ${index + 1} ${side} 重复`}
                    value={String(endpoint.selector.index)}
                    onChange={(event) => {
                      setActive(index);
                      const next = structuredClone(value);
                      const raw = event.target.value;
                      next[index][side].selector = {
                        ...endpoint.selector!,
                        index: /^\d+$/.test(raw) ? Number(raw) : raw,
                        wrap: true,
                      };
                      onChange(next);
                    }}
                  >
                    {typeof endpoint.selector.index === 'number' && (
                      <option value={endpoint.selector.index}>仅此实例</option>
                    )}
                    <option value="each">每份</option>
                    {side === 'b' && <option value="next">下一份</option>}
                    {side === 'b' && <option value="previous">上一份</option>}
                  </select>
                )}
              </label>
            );
          })}
          <button onClick={() => onChange(value.filter((_, i) => i !== index))}>
            移除连接 {index + 1}
          </button>
        </div>
      ))}
      <button
        disabled={!options.length}
        onClick={() => {
          setActive(value.length);
          onChange([
            ...value,
            { a: options[0].endpoint, b: (options[1] || options[0]).endpoint },
          ]);
        }}
      >
        添加端点对应
      </button>
      <p className="modifier-hint">
        选择要相接的端点及实例。重复连接可设“每份 →
        下一份”。连接保留各自切线，不会自动闭合单个扇区。
      </p>
    </fieldset>
  );
}
