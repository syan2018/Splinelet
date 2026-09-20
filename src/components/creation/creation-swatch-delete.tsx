'use client';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

type Swatch = { id: string; name: string; color: string };
type CreationDocument = { swatches: Swatch[] };
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export default function CreationSwatchDelete({
  creation,
  owners,
  swatch,
  disabled,
  onDelete,
}: {
  creation: CreationDocument;
  owners: readonly { id: string; name: string }[];
  swatch: Swatch;
  disabled: boolean;
  onDelete: (replacementId?: string) => void;
}) {
  const alternatives = creation.swatches.filter(
    (candidate) => candidate.id !== swatch.id,
  );
  const [open, setOpen] = useState(false);
  const [replacement, setReplacement] = useState(alternatives[0]?.id || '');
  const [error, setError] = useState('');
  const remove = (replacementId?: string) => {
    try {
      onDelete(replacementId);
      setOpen(false);
    } catch (error: unknown) {
      setError(errorMessage(error));
    }
  };
  return (
    <>
      <button
        className="creation-delete-color"
        disabled={disabled || !alternatives.length}
        onClick={() => {
          setError('');
          if (owners.length) {
            setReplacement(alternatives[0]?.id || '');
            setOpen(true);
          } else remove();
        }}
      >
        <Trash2 size={14} />
        删除项目色
      </button>
      {!alternatives.length && <small>至少保留一种项目色。</small>}
      {error && !open && <p role="alert">{error}</p>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="creation-delete-color-dialog">
          <DialogTitle>替换并删除「{swatch.name}」</DialogTitle>
          <DialogDescription>
            这枚颜色被 {owners.length}{' '}
            个部件引用。选择替换颜色后，仅替换这些引用，形状和厚度保持不变。可用
            Ctrl+Z 撤销。
          </DialogDescription>
          <p className="creation-muted">
            {owners.map((owner) => owner.name).join('、')}
          </p>
          <label>
            替换为
            <select
              aria-label="删除颜色时替换为"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
            >
              {alternatives.map((alternative) => (
                <option key={alternative.id} value={alternative.id}>
                  {alternative.name} · {alternative.color.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="dialog-actions">
            <button onClick={() => setOpen(false)}>取消</button>
            <button
              className="primary"
              disabled={
                disabled ||
                !alternatives.some((candidate) => candidate.id === replacement)
              }
              onClick={() => remove(replacement)}
            >
              替换并删除
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
