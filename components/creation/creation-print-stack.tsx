'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import NumberEdit from '../shared/creation-number';
type Layer = { id: string; name: string };
type ObjectInfo = { id: string; name: string; printLayerId?: string };
type Level = {
  id: string;
  state: string;
  bottomLayers: number;
  topLayers: number;
  heightLayers: number;
  bottomMM: number;
  topMM: number;
  message?: string;
};
type Doc = {
  printStack?: { layerHeightMM: number; layers: Layer[] };
  objects: ObjectInfo[];
};
type Command = (action: string, args: Record<string, unknown>) => void;

export function PrintPlacement({
  doc,
  scene,
  objectIds,
  disabled,
  onCommand,
  onManage,
}: {
  doc: Doc;
  scene: { printLevels?: Level[] } | null;
  objectIds: string[];
  disabled: boolean;
  onCommand: Command;
  onManage: () => void;
}) {
  const stack = doc.printStack;
  if (!stack)
    return (
      <button className="creation-wide" onClick={onManage}>
        设置打印分层…
      </button>
    );
  const members = doc.objects.filter((o) => objectIds.includes(o.id));
  const values = new Set(members.map((o) => o.printLayerId));
  const id = values.size === 1 ? members[0]?.printLayerId : '';
  const level = scene?.printLevels?.find((l) => l.id === id);
  return (
    <div className="creation-print-placement">
      <label>
        所属堆叠层
        <select
          aria-label="所属堆叠层"
          value={id || ''}
          disabled={disabled}
          onChange={(e) =>
            onCommand('print_assign', { objectIds, layerId: e.target.value })
          }
        >
          <option value="" disabled>
            多个堆叠层
          </option>
          {stack.layers.map((l, i) => (
            <option key={l.id} value={l.id}>
              {i + 1} · {l.name}
            </option>
          ))}
        </select>
      </label>
      <div className="creation-print-caption">
        <small>
          {level?.state === 'ready'
            ? `起点 ${level.bottomLayers} 打印层 · ${level.bottomMM} mm`
            : level?.message || '同层部件共享起始平面'}
        </small>
        <button onClick={onManage}>管理层</button>
      </div>
    </div>
  );
}
export default function PrintStack({
  doc,
  scene,
  objectIds,
  disabled,
  onCommand,
}: {
  doc: Doc;
  scene: { printLevels?: Level[] } | null;
  objectIds: string[];
  disabled: boolean;
  onCommand: Command;
}) {
  const [initialHeight, setInitialHeight] = useState(0.2);
  const [editing, setEditing] = useState('');
  const [name, setName] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  const cancelRename = useRef(false);
  useEffect(() => {
    if (editing) {
      cancelRename.current = false;
      nameInput.current?.focus();
      nameInput.current?.select();
    }
  }, [editing]);
  const stack = doc.printStack;
  function rename() {
    const id = editing;
    setEditing('');
    if (
      !cancelRename.current &&
      name.trim() &&
      name.trim() !== stack?.layers.find((l) => l.id === id)?.name
    )
      onCommand('print_layer_rename', { layerId: id, name: name.trim() });
  }
  return (
    <section className="creation-print-stack" aria-label="打印分层">
      <div className="creation-property-title">
        <b>打印分层</b>
        <span>
          {stack ? `${stack.layers.length} 个堆叠层` : '先分层，再调厚度'}
        </span>
      </div>
      <label className="creation-print-profile">
        每个打印层的高度{' '}
        <span>
          <NumberEdit
            label="打印层高"
            value={stack?.layerHeightMM ?? initialHeight}
            min={0.01}
            max={1}
            step={0.01}
            disabled={disabled}
            onCommit={(layerHeightMM) =>
              stack
                ? onCommand('print_settings', { layerHeightMM })
                : setInitialHeight(layerHeightMM)
            }
          />{' '}
          mm
        </span>
      </label>
      {!stack ? (
        <>
          <p>用堆叠层安排上下关系，区域厚度以整数打印层数编辑。</p>
          <button
            className="creation-wide"
            disabled={disabled}
            onClick={() => {
              if (
                window.confirm(
                  `启用打印分层？\n现有部件先放入同一个堆叠层，之后可新增层并分配部件。\n旧起始高度和对象依附将由堆叠层接管，厚度按 ${initialHeight} mm 四舍五入为整数打印层（至少 1 层）。颜色和轮廓保留。可用 Ctrl+Z 撤销。`,
                )
              )
                onCommand('print_enable', {
                  layerHeightMM: initialHeight,
                  confirm: true,
                });
            }}
          >
            启用打印分层…
          </button>
        </>
      ) : (
        <>
          <small>
            上层跟随下层最高点。列表从上到下对应实体从高到低；空层不占高度。
          </small>
          <div className="creation-print-layers">
            {[...stack.layers].reverse().map((layer, ri) => {
              const index = stack.layers.length - 1 - ri;
              const level = scene?.printLevels?.find((l) => l.id === layer.id);
              const members = doc.objects.filter(
                (o) => o.printLayerId === layer.id,
              );
              return (
                <div
                  key={layer.id}
                  className={
                    'creation-print-layer ' +
                    (level?.state === 'blocked' ? 'blocked' : '')
                  }
                  data-print-layer={layer.id}
                >
                  <div className="creation-print-layer-title">
                    <span className="creation-print-index">{index + 1}</span>
                    {editing === layer.id ? (
                      <input
                        ref={nameInput}
                        aria-label="堆叠层名称"
                        maxLength={120}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onBlur={rename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                          if (e.key === 'Escape') {
                            cancelRename.current = true;
                            setEditing('');
                          }
                        }}
                      />
                    ) : (
                      <b
                        title="双击重命名"
                        onDoubleClick={() => {
                          setEditing(layer.id);
                          setName(layer.name);
                        }}
                      >
                        {layer.name}
                      </b>
                    )}
                    <div className="creation-print-layer-actions">
                      <button
                        title="上移一层"
                        aria-label={layer.name + ' 上移'}
                        disabled={disabled || index === stack.layers.length - 1}
                        onClick={() =>
                          onCommand('print_layer_move', {
                            layerId: layer.id,
                            direction: 1,
                          })
                        }
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        title="下移一层"
                        aria-label={layer.name + ' 下移'}
                        disabled={disabled || index === 0}
                        onClick={() =>
                          onCommand('print_layer_move', {
                            layerId: layer.id,
                            direction: -1,
                          })
                        }
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        title={
                          members.length ? '先移走部件，再删除空层' : '删除空层'
                        }
                        aria-label={layer.name + ' 删除'}
                        disabled={
                          disabled ||
                          !!members.length ||
                          stack.layers.length === 1
                        }
                        onClick={() =>
                          onCommand('print_layer_remove', { layerId: layer.id })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="creation-print-caption">
                    <span>
                      {level?.state === 'ready'
                        ? `${level.bottomLayers}–${level.topLayers} 打印层`
                        : '等待构造'}
                    </span>
                    <small>
                      {level?.state === 'ready'
                        ? `${level.bottomMM}–${level.topMM} mm`
                        : level?.message}
                    </small>
                  </div>
                  <p
                    className="creation-print-members"
                    title={members.map((o) => o.name).join('、')}
                  >
                    {members.length
                      ? members.map((o) => o.name).join(' · ')
                      : '空层 · 选择部件后移入'}
                  </p>
                  {!!objectIds.length && (
                    <button
                      className="creation-print-assign"
                      disabled={
                        disabled ||
                        objectIds.every((id) =>
                          members.some((o) => o.id === id),
                        )
                      }
                      onClick={() =>
                        onCommand('print_assign', {
                          objectIds,
                          layerId: layer.id,
                        })
                      }
                    >
                      将选中部件移入此层
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <button
            className="creation-wide"
            disabled={disabled || stack.layers.length >= 100}
            onClick={() => onCommand('print_layer_add', {})}
          >
            <Plus size={15} />
            新增堆叠层
          </button>
          <small>
            改变打印层高会保持层数，按比例更新实体厚度。隐藏仅影响显示，“参与成品导出”决定该部件是否占层高。
          </small>
        </>
      )}
    </section>
  );
}
