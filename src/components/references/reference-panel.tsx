'use client';

import { useRef, useState } from 'react';
import type { Reference } from '@/lib/document/types';
import './reference.css';

type ReferenceWithUrl = Reference & { url: string };

const acceptedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

export type ReferenceRequest =
  | { kind: 'reference-update'; id: string; patch: Partial<Reference> }
  | { kind: 'reference-delete'; id: string }
  | { kind: 'reference-duplicate'; id: string; newId: string }
  | { kind: 'reference-reorder'; id: string; direction: 'up' | 'down' };

export type ReferencePanelProps = {
  references: ReferenceWithUrl[];
  baseId: string | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (files: File[]) => void;
  onCommand: (request: ReferenceRequest) => void;
  onLocate: (id: string) => void;
  disabled: boolean;
};

type NumericFieldProps = {
  label: string;
  value: number;
  unit?: string;
  disabled: boolean;
  min?: number;
  onCommit: (value: number) => void;
};

function rounded(value: number) {
  return String(+value.toFixed(4));
}

function NumericField({
  label,
  value,
  unit,
  disabled,
  min,
  onCommit,
}: NumericFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const displayed = draft ?? rounded(value);
  const commit = () => {
    const text = draft;
    setDraft(null);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (text == null) return;
    const next = Number(text);
    if (Number.isFinite(next) && (min == null || next >= min) && next !== value)
      onCommit(next);
  };

  return (
    <label className="reference-field">
      <span>{label}</span>
      <span className="reference-input-wrap">
        <input
          aria-label={label}
          disabled={disabled}
          min={min}
          step="any"
          type="number"
          value={displayed}
          onBlur={commit}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => {
            cancelled.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              cancelled.current = true;
              setDraft(null);
              event.currentTarget.blur();
            }
          }}
        />
        {unit && <small>{unit}</small>}
      </span>
    </label>
  );
}

function referenceCenter(reference: Reference) {
  const [a, b, c, d, e, f] = reference.pixelToWorld;
  return {
    x: e + (a * reference.pixelWidth + c * reference.pixelHeight) / 2,
    y: f + (b * reference.pixelWidth + d * reference.pixelHeight) / 2,
  };
}

function referenceWidth(reference: Reference) {
  const [a, b] = reference.pixelToWorld;
  return Math.hypot(a, b) * reference.pixelWidth;
}

function aroundCenter(
  reference: Reference,
  a: number,
  b: number,
  c: number,
  d: number,
) {
  const center = referenceCenter(reference);
  return [
    a,
    b,
    c,
    d,
    center.x - (a * reference.pixelWidth + c * reference.pixelHeight) / 2,
    center.y - (b * reference.pixelWidth + d * reference.pixelHeight) / 2,
  ] as Reference['pixelToWorld'];
}

function changedId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `reference-${Date.now().toString(36)}`;
}

export function ReferencePanel({
  references,
  baseId,
  selectedId,
  onSelect,
  onAdd,
  onCommand,
  onLocate,
  disabled,
}: ReferencePanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const selected =
    references.find((reference) => reference.id === selectedId) ?? null;
  const [opacityDraft, setOpacityDraft] = useState<{
    id: string;
    value: number;
  } | null>(null);
  const [nameDraft, setNameDraft] = useState<{
    id: string;
    value: string;
  } | null>(null);
  const nameCancelled = useRef(false);

  const selectedIsBase = selected?.id === baseId;
  const editable = Boolean(
    selected && !selectedIsBase && !selected.locked && !disabled,
  );
  const commandUpdate = (patch: Partial<Reference>) => {
    if (selected && editable)
      onCommand({ kind: 'reference-update', id: selected.id, patch });
  };
  const opacityDraftValue =
    opacityDraft && opacityDraft.id === selected?.id
      ? opacityDraft.value
      : null;
  const nameDraftValue =
    nameDraft && nameDraft.id === selected?.id ? nameDraft.value : null;
  const opacityValue = opacityDraftValue ?? selected?.opacity;
  const commitOpacity = (value?: number) => {
    const next = value ?? opacityDraftValue;
    if (selected && next != null && next !== selected.opacity && !disabled)
      onCommand({
        kind: 'reference-update',
        id: selected.id,
        patch: { opacity: next },
      });
    setOpacityDraft(null);
  };
  const commitName = () => {
    const name = nameDraftValue?.trim();
    setNameDraft(null);
    if (nameCancelled.current) {
      nameCancelled.current = false;
      return;
    }
    if (selected && name && name !== selected.name && !disabled)
      onCommand({
        kind: 'reference-update',
        id: selected.id,
        patch: { name },
      });
  };

  return (
    <aside
      className="reference-panel"
      aria-label="参考图"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="reference-panel-heading">
        <div>
          <h2>参考图</h2>
          <p>图片独立于作品对象；自动描线仅分析基准底图</p>
        </div>
        <button
          aria-label="添加参考图"
          disabled={disabled}
          type="button"
          onClick={() => fileInput.current?.click()}
        >
          添加
        </button>
        <input
          ref={fileInput}
          aria-label="添加参考图"
          accept="image/png,image/jpeg,image/webp"
          className="reference-file-input"
          disabled={disabled}
          multiple
          type="file"
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []).filter(
              (file) => acceptedImageTypes.has(file.type),
            );
            if (files.length) onAdd(files);
            event.currentTarget.value = '';
          }}
        />
      </div>

      <div className="reference-list" aria-label="参考图列表">
        {[...references].reverse().map((reference) => {
          const isSelected = reference.id === selectedId;
          const isBase = reference.id === baseId;
          return (
            <div
              key={reference.id}
              className={`reference-row${isSelected ? ' selected' : ''}`}
            >
              <button
                aria-label={`${reference.visible ? '隐藏' : '显示'} ${reference.name}`}
                className="reference-icon-button"
                disabled={disabled}
                type="button"
                onClick={() =>
                  onCommand({
                    kind: 'reference-update',
                    id: reference.id,
                    patch: { visible: !reference.visible },
                  })
                }
              >
                {reference.visible ? '◉' : '○'}
              </button>
              <button
                aria-label={`选择 ${reference.name}`}
                className="reference-row-main"
                disabled={disabled}
                type="button"
                onClick={() => onSelect(isSelected ? null : reference.id)}
              >
                <svg
                  aria-hidden="true"
                  className="reference-thumbnail"
                  preserveAspectRatio="xMidYMid slice"
                  viewBox={`0 0 ${reference.pixelWidth} ${reference.pixelHeight}`}
                >
                  <image
                    href={reference.url}
                    width={reference.pixelWidth}
                    height={reference.pixelHeight}
                  />
                </svg>
                <span>
                  <b>{reference.name}</b>
                  {isBase && <small>底图</small>}
                </span>
              </button>
              <button
                aria-label={`${reference.locked ? '解锁' : '锁定'} ${reference.name}`}
                className="reference-icon-button"
                disabled={disabled || isBase}
                type="button"
                onClick={() =>
                  onCommand({
                    kind: 'reference-update',
                    id: reference.id,
                    patch: { locked: !reference.locked },
                  })
                }
              >
                {reference.locked || isBase ? '🔒' : '🔓'}
              </button>
              <button
                aria-label={`调整 ${reference.name}`}
                className="reference-adjust-button"
                disabled={disabled}
                type="button"
                onClick={() => onSelect(reference.id)}
              >
                调整
              </button>
            </div>
          );
        })}
        {!references.length && (
          <p className="reference-empty">还没有参考图。</p>
        )}
      </div>

      {selected && (
        <div className="reference-details">
          <div className="reference-details-heading">
            <input
              aria-label="参考图名称"
              className="reference-name-input"
              disabled={disabled}
              type="text"
              value={nameDraftValue ?? selected.name}
              onBlur={commitName}
              onChange={(event) =>
                setNameDraft({ id: selected.id, value: event.target.value })
              }
              onFocus={() => {
                nameCancelled.current = false;
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') {
                  nameCancelled.current = true;
                  setNameDraft(null);
                  event.currentTarget.blur();
                }
              }}
            />
            <button
              disabled={disabled}
              type="button"
              onClick={() => onSelect(null)}
            >
              完成
            </button>
          </div>
          <div className="reference-opacity">
            <label htmlFor={`reference-opacity-${selected.id}`}>不透明度</label>
            <output>
              {Math.round((opacityValue ?? selected.opacity) * 100)}%
            </output>
            <input
              id={`reference-opacity-${selected.id}`}
              aria-label="不透明度"
              disabled={disabled}
              max="1"
              min="0"
              step="0.01"
              type="range"
              value={opacityValue ?? selected.opacity}
              onBlur={() => commitOpacity()}
              onChange={(event) =>
                setOpacityDraft({
                  id: selected.id,
                  value: Number(event.target.value),
                })
              }
              onPointerUp={(event) =>
                commitOpacity(Number(event.currentTarget.value))
              }
            />
          </div>
          {selectedIsBase ? (
            <div className="reference-base-actions">
              <p className="reference-base-note">底图固定为原点和比例基准。</p>
              <button
                disabled={disabled}
                type="button"
                onClick={() => onLocate(selected.id)}
              >
                定位
              </button>
            </div>
          ) : (
            <>
              <p className="reference-adjustment-hint">
                用中心坐标、宽度和旋转按钮精确调整；锁定后仍可修改名称和不透明度。
              </p>
              <div className="reference-fields">
                <NumericField
                  disabled={!editable}
                  label="中心 X"
                  unit="mm"
                  value={referenceCenter(selected).x}
                  onCommit={(x) => {
                    const center = referenceCenter(selected);
                    const [, , , , e, f] = selected.pixelToWorld;
                    commandUpdate({
                      pixelToWorld: [
                        selected.pixelToWorld[0],
                        selected.pixelToWorld[1],
                        selected.pixelToWorld[2],
                        selected.pixelToWorld[3],
                        e + x - center.x,
                        f,
                      ],
                    });
                  }}
                />
                <NumericField
                  disabled={!editable}
                  label="中心 Y"
                  unit="mm"
                  value={referenceCenter(selected).y}
                  onCommit={(y) => {
                    const center = referenceCenter(selected);
                    const [, , , , e, f] = selected.pixelToWorld;
                    commandUpdate({
                      pixelToWorld: [
                        selected.pixelToWorld[0],
                        selected.pixelToWorld[1],
                        selected.pixelToWorld[2],
                        selected.pixelToWorld[3],
                        e,
                        f + y - center.y,
                      ],
                    });
                  }}
                />
                <NumericField
                  disabled={!editable}
                  label="宽度"
                  min={0.001}
                  unit="mm"
                  value={referenceWidth(selected)}
                  onCommit={(width) => {
                    const currentWidth = referenceWidth(selected);
                    if (currentWidth <= 0) return;
                    const scale = width / currentWidth;
                    const [a, b, c, d] = selected.pixelToWorld;
                    commandUpdate({
                      pixelToWorld: aroundCenter(
                        selected,
                        a * scale,
                        b * scale,
                        c * scale,
                        d * scale,
                      ),
                    });
                  }}
                />
                <NumericField
                  disabled={!editable}
                  label="旋转角度"
                  unit="°"
                  value={
                    (Math.atan2(
                      selected.pixelToWorld[1],
                      selected.pixelToWorld[0],
                    ) *
                      180) /
                    Math.PI
                  }
                  onCommit={(degrees) => {
                    const [a, b, c, d] = selected.pixelToWorld;
                    const delta = (degrees * Math.PI) / 180 - Math.atan2(b, a);
                    const cos = Math.cos(delta),
                      sin = Math.sin(delta);
                    commandUpdate({
                      pixelToWorld: aroundCenter(
                        selected,
                        cos * a - sin * b,
                        sin * a + cos * b,
                        cos * c - sin * d,
                        sin * c + cos * d,
                      ),
                    });
                  }}
                />
              </div>
              <div
                className="reference-transform-actions"
                aria-label="图像变换"
              >
                <button
                  disabled={!editable}
                  type="button"
                  onClick={() => {
                    const [a, b, c, d] = selected.pixelToWorld;
                    const angle = (-15 * Math.PI) / 180;
                    const cosine = Math.cos(angle),
                      sine = Math.sin(angle);
                    commandUpdate({
                      pixelToWorld: aroundCenter(
                        selected,
                        a * cosine + c * sine,
                        b * cosine + d * sine,
                        -a * sine + c * cosine,
                        -b * sine + d * cosine,
                      ),
                    });
                  }}
                >
                  ↺ 15°
                </button>
                <button
                  disabled={!editable}
                  type="button"
                  onClick={() => {
                    const [a, b, c, d] = selected.pixelToWorld;
                    const angle = (15 * Math.PI) / 180;
                    const cosine = Math.cos(angle),
                      sine = Math.sin(angle);
                    commandUpdate({
                      pixelToWorld: aroundCenter(
                        selected,
                        a * cosine + c * sine,
                        b * cosine + d * sine,
                        -a * sine + c * cosine,
                        -b * sine + d * cosine,
                      ),
                    });
                  }}
                >
                  ↻ 15°
                </button>
                <button
                  disabled={!editable}
                  type="button"
                  onClick={() => {
                    const [a, b, c, d] = selected.pixelToWorld;
                    commandUpdate({
                      pixelToWorld: aroundCenter(selected, -a, -b, c, d),
                    });
                  }}
                >
                  水平翻转
                </button>
                <button
                  disabled={!editable}
                  type="button"
                  onClick={() => {
                    const [a, b, c, d] = selected.pixelToWorld;
                    commandUpdate({
                      pixelToWorld: aroundCenter(selected, a, b, -c, -d),
                    });
                  }}
                >
                  垂直翻转
                </button>
              </div>
              <div className="reference-command-actions">
                <button
                  disabled={disabled}
                  type="button"
                  onClick={() => onLocate(selected.id)}
                >
                  定位
                </button>
                <button
                  disabled={disabled}
                  type="button"
                  onClick={() =>
                    onCommand({
                      kind: 'reference-duplicate',
                      id: selected.id,
                      newId: changedId(),
                    })
                  }
                >
                  复制
                </button>
                <button
                  disabled={disabled}
                  type="button"
                  onClick={() =>
                    onCommand({
                      kind: 'reference-reorder',
                      id: selected.id,
                      direction: 'up',
                    })
                  }
                >
                  上移
                </button>
                <button
                  disabled={disabled}
                  type="button"
                  onClick={() =>
                    onCommand({
                      kind: 'reference-reorder',
                      id: selected.id,
                      direction: 'down',
                    })
                  }
                >
                  下移
                </button>
                <button
                  className="reference-delete"
                  disabled={disabled}
                  type="button"
                  onClick={() => {
                    onCommand({ kind: 'reference-delete', id: selected.id });
                    onSelect(null);
                  }}
                >
                  删除
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
