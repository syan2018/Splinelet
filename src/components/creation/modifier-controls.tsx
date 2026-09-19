'use client';
import { useRef, useState } from 'react';
import type {
  SurfaceScope,
  SurfaceOption,
  ModifierInputRef,
  ModifierObject,
  ModifierProject,
} from '@/lib/modifier-types';

export function SurfaceTargets({
  value,
  options,
  onChange,
  label,
}: {
  value: SurfaceScope;
  options: SurfaceOption[];
  onChange: (value: SurfaceScope) => void;
  label: string;
}) {
  const [multiple, setMultiple] = useState(false),
    [draft, setDraft] = useState<string[]>([]);
  const refs = value.refs || [];
  const chosen =
    value.kind === 'all' ? 'all' : refs.length === 1 ? refs[0].key : 'multiple';
  return (
    <div className="modifier-targets">
      <label>
        <span>作用于</span>
        <select
          aria-label={label}
          value={chosen}
          onChange={(e) => {
            if (e.target.value === 'multiple') {
              setDraft(refs.map((r) => r.key));
              setMultiple(true);
              return;
            }
            setMultiple(false);
            onChange(
              e.target.value === 'all'
                ? { kind: 'all' }
                : {
                    kind: 'selected',
                    refs: [
                      options.find((o) => o.ref.key === e.target.value)!.ref,
                    ],
                  },
            );
          }}
        >
          <option value="all">整个部件</option>
          {options.map((o) => (
            <option key={o.ref.key} value={o.ref.key}>
              {o.name}
            </option>
          ))}
          {refs
            .filter((r) => !options.some((o) => o.ref.key === r.key))
            .map((r) => (
              <option key={r.key} value={r.key} disabled>
                {r.name} · 来源已变化
              </option>
            ))}
          <option value="multiple">
            {refs.length > 1 ? `已选 ${refs.length} 个面` : '选择多个面…'}
          </option>
        </select>
      </label>
      {multiple && (
        <div className="modifier-multi">
          <div className="modifier-choices">
            {options.map((o) => (
              <label key={o.ref.key}>
                <input
                  type="checkbox"
                  checked={draft.includes(o.ref.key)}
                  onChange={(e) =>
                    setDraft(
                      e.target.checked
                        ? [...draft, o.ref.key]
                        : draft.filter((k) => k !== o.ref.key),
                    )
                  }
                />
                {o.name}
              </label>
            ))}
          </div>
          <div className="modifier-actions">
            <button
              disabled={!draft.length}
              onClick={() => {
                onChange({
                  kind: 'selected',
                  refs: options
                    .filter((o) => draft.includes(o.ref.key))
                    .map((o) => o.ref),
                });
                setMultiple(false);
              }}
            >
              应用范围
            </button>
            <button onClick={() => setMultiple(false)}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ModifierInput({
  value,
  project,
  objects,
  objectId,
  type,
  nested,
  onChange,
  label,
}: {
  value?: ModifierInputRef | null;
  project: ModifierProject;
  objects: ModifierObject[];
  objectId: string;
  type: string;
  nested?: boolean;
  onChange: (input: ModifierInputRef) => void;
  label: string;
}) {
  const encode = (kind: string, id: string) => JSON.stringify([kind, id]);
  const options = [
    ...project.paths
      .filter((p) => (type === 'split' ? !p.closed : p.closed))
      .map((p) => ({ kind: 'path', id: p.id, name: p.name })),
    ...(type === 'split' || nested
      ? []
      : objects
          .filter((o) => o.id !== objectId)
          .map((o) => ({ kind: 'object', id: o.id, name: o.name }))),
    ...(nested
      ? (project.model?.regions || []).map((r) => ({
          kind: 'region',
          id: r.id,
          name: r.name,
        }))
      : []),
  ];
  return (
    <label className="modifier-field">
      <span>{type === 'split' ? '分区线' : '工具'}</span>
      <select
        aria-label={label}
        value={value ? encode(value.kind, value.id) : ''}
        onChange={(e) => {
          const [kind, id] = JSON.parse(e.target.value) as [
            ModifierInputRef['kind'],
            string,
          ];
          onChange({ kind, id });
        }}
      >
        <option value="" disabled>
          选择{type === 'split' ? '开放样条' : '闭合线或对象'}…
        </option>
        {(['path', 'object', 'region'] as const).map((kind) => (
          <optgroup
            key={kind}
            label={
              { path: '曲线', object: '对象的最终结果', region: '基础构造面' }[
                kind
              ]
            }
          >
            {options
              .filter((o) => o.kind === kind)
              .map((o) => (
                <option key={o.id} value={encode(kind, o.id)}>
                  {o.name}
                </option>
              ))}
          </optgroup>
        ))}
        {value &&
          !options.some((o) => o.kind === value.kind && o.id === value.id) && (
            <option value={encode(value.kind, value.id)} disabled>
              来源已删除或类型不符
            </option>
          )}
      </select>
    </label>
  );
}

export function ModifierNumber({
  value,
  onChange,
  label,
  step = 0.1,
  min = -20,
  max = 20,
  unit = 'mm',
}: {
  value?: number;
  onChange: (value: number) => void;
  label: string;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const commit = () => {
    if (
      !cancelled.current &&
      draft !== null &&
      draft.trim() &&
      Number.isFinite(+draft) &&
      +draft !== value
    )
      onChange(+draft);
    cancelled.current = false;
    setDraft(null);
  };
  return (
    <label className="modifier-field">
      <span>{label}</span>
      <div className="modifier-number">
        <input
          aria-label={label}
          type="number"
          value={draft ?? value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => setDraft(e.target.value)}
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
        <span>{unit}</span>
      </div>
    </label>
  );
}

export function ModifierName({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return draft === null ? (
    <span
      className="modifier-name"
      title="双击重命名"
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(value);
      }}
    >
      {value}
    </span>
  ) : (
    <input
      ref={(input) => input?.focus()}
      aria-label="修改器名称"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => {
        if (draft.trim()) onChange(draft.trim());
        setDraft(null);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}
