'use client';
import type { JoinConnection, JoinEndpointOption } from '@/lib/modifier-types';

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
  return (
    <fieldset disabled={disabled} className="modifier-parameters">
      <legend>端点连接</legend>
      {value.map((connection, index) => (
        <div key={index} className="modifier-field">
          {(['a', 'b'] as const).map((side) => {
            const endpoint = connection[side];
            const current = JSON.stringify(endpoint);
            return (
              <label key={side}>
                {side === 'a' ? '从' : '接到'}
                <select
                  aria-label={`连接 ${index + 1} ${side}`}
                  value={current}
                  onChange={(event) => {
                    const next = structuredClone(value);
                    next[index][side] = JSON.parse(event.target.value);
                    onChange(next);
                  }}
                >
                  {!options.some(
                    (option) => JSON.stringify(option.endpoint) === current,
                  ) && (
                    <option value={current}>
                      已保存的连接 · {endpoint.edgeEnd.end} ·{' '}
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
                    <option value="next">下一份</option>
                    <option value="previous">上一份</option>
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
        onClick={() =>
          onChange([
            ...value,
            { a: options[0].endpoint, b: (options[1] || options[0]).endpoint },
          ])
        }
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
