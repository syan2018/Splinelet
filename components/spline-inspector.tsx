'use client';
import { CornerDownLeft, Link, MousePointer2, Check } from 'lucide-react';
import type { TracePath } from '@/lib/project';
import { pathNodes } from '@/public/node-edit.mjs';
import { nodeModes, nodeSides } from '@/public/continuity.mjs';

type End = 'start' | 'end';
type Resume = (end: End) => void;

export function SplineEnds({
  disabled,
  onResume,
}: {
  disabled: boolean;
  onResume: Resume;
}) {
  return (
    <div className="spline-end-actions" role="group" aria-label="选择续画端点">
      <button disabled={disabled} onClick={() => onResume('start')}>
        <CornerDownLeft size={14} />
        从头续画
      </button>
      <button disabled={disabled} onClick={() => onResume('end')}>
        <CornerDownLeft size={14} className="spline-tail-icon" />
        从尾续画
      </button>
    </div>
  );
}

export function SplinePathInspector({
  path,
  count,
  disabled,
  canRefit,
  onEdit,
  onResume,
  onGroup,
  onDelete,
  onClear,
  onRefit,
}: {
  path?: TracePath;
  count: number;
  disabled: boolean;
  canRefit: boolean;
  onEdit: () => void;
  onResume: Resume;
  onGroup: () => void;
  onDelete: () => void;
  onClear: () => void;
  onRefit: () => void;
}) {
  return (
    <section className="spline-inspector paths-section">
      <h3>{count > 1 ? `已选 ${count} 条路径` : path?.name || '未选择路径'}</h3>
      {count === 1 && path ? (
        <>
          <p className="spline-meta">
            {path.closed ? '闭合样条' : '开放样条'} · {pathNodes(path).length}{' '}
            个节点 · {path.curves.length} 段曲线
          </p>
          <button
            className="spline-primary-action"
            disabled={disabled}
            onClick={onEdit}
          >
            <MousePointer2 size={15} />
            编辑节点<kbd>A</kbd>
          </button>
          {!path.closed && (
            <div className="spline-operation-group">
              <h4>接着描线</h4>
              <SplineEnds
                disabled={disabled || !path.visible}
                onResume={onResume}
              />
              <p className="note">画布标记头尾；也可双击开放端点续画。</p>
            </div>
          )}
          <details className="spline-more-actions advanced-actions">
            <summary>路径操作</summary>
            <button disabled={disabled} onClick={onGroup}>
              编组<kbd>Ctrl G</kbd>
            </button>
            <button disabled={disabled} onClick={onClear}>
              取消路径选择<kbd>Esc</kbd>
            </button>
            <div className="spline-menu-divider" />
            <button disabled={disabled || !canRefit} onClick={onRefit}>
              重新拟合当前路径…
            </button>
            <small>重新拟合会替换手动调整，执行前需确认。</small>
            <button
              className="spline-danger"
              disabled={disabled}
              onClick={onDelete}
            >
              删除当前路径<kbd>Del</kbd>
            </button>
          </details>
        </>
      ) : count > 1 ? (
        <>
          <p>拖动已选曲线可整体移动；在大纲中拖动可批量排序和移组。</p>
          <div className="spline-operation-group">
            <button disabled={disabled} onClick={onGroup}>
              编组<kbd>Ctrl G</kbd>
            </button>
            <button onClick={onClear}>
              取消路径选择<kbd>Esc</kbd>
            </button>
          </div>
          <details className="spline-more-actions">
            <summary>批量操作</summary>
            <button
              className="spline-danger"
              disabled={disabled}
              onClick={onDelete}
            >
              删除所选 {count} 条路径<kbd>Del</kbd>
            </button>
          </details>
        </>
      ) : (
        <p>点击曲线或大纲中的路径。Ctrl / Shift 多选，双击名称改名。</p>
      )}
    </section>
  );
}

export function SplineNodeInspector({
  path,
  nodes,
  selection,
  disabled,
  merging,
  canMerge,
  onResume,
  onMode,
  onStraighten,
  onMerge,
  onCancelMerge,
  onDelete,
  onClear,
}: {
  path: TracePath;
  nodes: number[];
  selection: { curve: number; point: number } | null;
  disabled: boolean;
  merging: boolean;
  canMerge: boolean;
  onResume: Resume;
  onMode: (mode: string) => void;
  onStraighten: (curve: number) => void;
  onMerge: () => void;
  onCancelMerge: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const index = nodes.length === 1 ? nodes[0] : null;
  const endpoint =
    index !== null &&
    !path.closed &&
    (index === 0 || index === path.curves.length);
  const hasEndpoint =
    !path.closed && nodes.some((i) => i === 0 || i === path.curves.length);
  const modes = nodeModes(path);
  const mode =
    new Set(nodes.map((i) => modes[i])).size > 1 ? 'mixed' : modes[nodes[0]];
  const point = index === null ? null : pathNodes(path)[index];
  const sides = index === null ? null : nodeSides(path, index);
  const segments: { index: number; name: string }[] = sides
    ? [
        ...(sides.left >= 0 ? [{ index: sides.left, name: '前一段' }] : []),
        ...(sides.right >= 0 ? [{ index: sides.right, name: '后一段' }] : []),
      ]
    : selection && !nodes.length
      ? [{ index: selection.curve, name: '控制柄所在段' }]
      : [];
  return (
    <div className="node-inspector spline-inspector">
      <p className="spline-meta">
        {point
          ? `${endpoint ? (index === 0 ? '头端点' : '尾端点') : `节点 ${index! + 1}`} · X ${point.x.toFixed(1)} / Y ${point.y.toFixed(1)} px`
          : nodes.length
            ? '拖动任一选中节点可整体移动。'
            : selection
              ? '已选控制柄 · 拖动调整弯曲'
              : '点击节点选择 · Shift 多选 · 空白拖动框选'}
      </p>
      {endpoint && (
        <div className="spline-operation-group">
          <button
            className="spline-primary-action"
            disabled={disabled}
            onClick={() => onResume(index === 0 ? 'start' : 'end')}
          >
            <CornerDownLeft size={15} />
            从此端点续画<kbd>E</kbd>
          </button>
          {path.curves.length > 0 && (
            <button disabled={disabled || !canMerge} onClick={onMerge}>
              <Link size={14} />
              连接另一条样条<kbd>M</kbd>
            </button>
          )}
          {!canMerge && path.curves.length > 0 && (
            <p className="note">合并需要另一条可见的开放样条。</p>
          )}
        </div>
      )}
      {merging && <button onClick={onCancelMerge}>取消合并 · Esc</button>}
      {!!nodes.length && (
        <div className="spline-operation-group">
          <h4>节点形状</h4>
          <label className="node-mode">
            连接方式
            <select
              aria-label="节点连接模式"
              disabled={disabled}
              value={mode}
              onChange={(e) => onMode(e.target.value)}
            >
              <option value="mixed" disabled>
                混合
              </option>
              <option value="corner">尖角 · 独立控制柄</option>
              <option value="smooth" disabled={hasEndpoint}>
                平滑 · 共线
              </option>
              <option value="symmetric" disabled={hasEndpoint}>
                对称 · 等长共线
              </option>
            </select>
          </label>
          {hasEndpoint && (
            <p className="note">
              开放端点只有一侧曲线；平滑和对称用于内部节点。
            </p>
          )}
        </div>
      )}
      {segments.length > 0 && (
        <div className="spline-operation-group">
          <h4>相邻曲线</h4>
          {segments.map((s) => (
            <button
              key={s.name}
              disabled={disabled}
              onClick={() => onStraighten(s.index)}
            >
              {s.name}改为直连
              <span className="spline-segment-number">第 {s.index + 1} 段</span>
            </button>
          ))}
          <p className="note">只调整该段控制柄，节点位置不变。</p>
        </div>
      )}
      {!!nodes.length || selection ? (
        <details className="spline-more-actions">
          <summary>选择与删除</summary>
          <button disabled={disabled} onClick={onClear}>
            取消节点选择<kbd>Esc</kbd>
          </button>
          {!!nodes.length && (
            <button
              className="spline-danger"
              disabled={disabled}
              onClick={onDelete}
            >
              删除 {nodes.length === 1 ? '节点' : `所选 ${nodes.length} 个节点`}
              <kbd>Del</kbd>
            </button>
          )}
        </details>
      ) : null}
    </div>
  );
}

export function SplineTraceControls({
  path,
  drawing,
  end,
  disabled,
  onResume,
  onFinish,
  onClose,
}: {
  path?: TracePath;
  drawing: boolean;
  end: End;
  disabled: boolean;
  onResume: Resume;
  onFinish: () => void;
  onClose: (e: React.MouseEvent) => void;
}) {
  if (!path || path.closed)
    return (
      <p className="note">点击底图开始新路径，或选择已有开放路径的端点续画。</p>
    );
  return (
    <div className="spline-trace-controls">
      <h3>{path.name}</h3>
      <p>
        {drawing
          ? `正在从${end === 'start' ? '头' : '尾'}端点续画 · 每次落点增加一段曲线`
          : '选择从哪一端继续描线'}
      </p>
      <SplineEnds disabled={disabled || !path.visible} onResume={onResume} />
      <div className="path-actions">
        <button disabled={!drawing || disabled} onClick={onFinish}>
          <Check size={14} />
          结束描线<kbd>Enter</kbd>
        </button>
        <button disabled={disabled || !path.curves.length} onClick={onClose}>
          <Link size={14} />
          闭合路径<kbd>C</kbd>
        </button>
      </div>
      {drawing && (
        <p className="note">
          点击另一端可闭合 · Shift 不吸附 · Alt 直连 · Esc 结束
        </p>
      )}
    </div>
  );
}
