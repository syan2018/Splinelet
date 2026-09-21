'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { SvgImportResult } from '@/lib/import/svg-import';

export default function VectorImportDialog({
  input,
  widthMM,
  objects,
  onClose,
  onImport,
}: {
  input: SvgImportResult & { name: string };
  widthMM: number;
  objects: { id: string; name: string }[];
  onClose: () => void;
  onImport: (options: {
    widthMM: number;
    centerMM: number[];
    thicknessMM: number;
    attachId?: string;
  }) => void;
}) {
  const [width, setWidth] = useState(String(Math.min(40, widthMM / 3)));
  const [x, setX] = useState('0'),
    [y, setY] = useState('0');
  const [depth, setDepth] = useState('0.6'),
    [attach, setAttach] = useState('');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="studio-dialog">
        <DialogTitle>导入 SVG／笔迹</DialogTitle>
        <DialogDescription>
          {input.name} · {input.splines.length}{' '}
          条可编辑曲线。填色生成面，描边生成有宽度的笔迹；整组支持变换与撤销。
        </DialogDescription>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onImport({
              widthMM: Number(width),
              centerMM: [Number(x), Number(y)],
              thicknessMM: Number(depth),
              ...(attach ? { attachId: attach } : {}),
            });
          }}
        >
          <label>
            宽度 (mm)
            <input
              aria-label="导入宽度"
              type="number"
              required
              min="0.01"
              max="10000"
              step="any"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
            />
          </label>
          <label>
            中心 X (mm)
            <input
              aria-label="导入中心 X"
              type="number"
              required
              step="any"
              value={x}
              onChange={(e) => setX(e.target.value)}
            />
          </label>
          <label>
            中心 Y (mm)
            <input
              aria-label="导入中心 Y"
              type="number"
              required
              step="any"
              value={y}
              onChange={(e) => setY(e.target.value)}
            />
          </label>
          <label>
            浮雕厚度 (mm)
            <input
              aria-label="导入厚度"
              type="number"
              required
              min="0.01"
              max="1000"
              step="any"
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
            />
          </label>
          <label>
            贴附表面
            <select
              aria-label="导入贴附表面"
              value={attach}
              onChange={(e) => setAttach(e.target.value)}
            >
              <option value="">地面</option>
              {objects.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          {input.warnings.map((warning) => (
            <output key={warning}>{warning}</output>
          ))}
          <div className="confirm-actions">
            <button type="button" onClick={onClose}>
              取消
            </button>
            <button type="submit">导入为对象组</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
