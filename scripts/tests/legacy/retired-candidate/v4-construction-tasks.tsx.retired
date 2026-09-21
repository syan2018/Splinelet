'use client';

import { useState, type SyntheticEvent } from 'react';
import type {
  DocumentV4,
  EdgeEndRef,
  Operator,
  OutputRef,
  PortRef,
} from '@/lib/document/types';
import { ADVANCED_ACTIONS } from '@/lib/editing/commands/advanced.mjs';

type Props = {
  document: DocumentV4;
  ownerNodeId?: string;
  target: OutputRef | null;
  onAction: (action: Record<string, unknown>) => void;
};

type EndpointOption = {
  key: string;
  label: string;
  edgeEnd: EdgeEndRef;
};

type EndpointDraft = {
  endpointKey: string;
  copy: 'this' | 'next';
  branch: 'original' | 'mirror';
};

type ConnectionDraft = { a: EndpointDraft; b: EndpointDraft };
type ReferenceMode =
  | 'reference-local'
  | 'reference-world'
  | 'cut-world'
  | 'cut-local';

const degrees = (radians: number) => (radians * 180) / Math.PI;
const radians = (value: number) => (value * Math.PI) / 180;

const newEndpoint = (copy: EndpointDraft['copy']): EndpointDraft => ({
  endpointKey: '',
  copy,
  branch: 'original',
});

const newConnection = (): ConnectionDraft => ({
  a: newEndpoint('this'),
  b: newEndpoint('next'),
});

const inputStyle = { width: '6rem' } as const;
const fieldsetStyle = {
  border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
  borderRadius: '0.5rem',
  display: 'grid',
  gap: '0.5rem',
  margin: '0.5rem 0',
  padding: '0.65rem',
} as const;

const pathEndpoints = (
  document: DocumentV4,
  ownerNodeId: string | undefined,
): EndpointOption[] => {
  if (!ownerNodeId) return [];
  const result: EndpointOption[] = [];
  for (const sketch of Object.values(document.sketches)) {
    if (sketch.ownerNodeId !== ownerNodeId) continue;
    for (const path of Object.values(sketch.paths)) {
      const first = path.edges[0];
      const last = path.edges.at(-1);
      if (!first || !last) continue;
      result.push(
        {
          key: `${sketch.id}:${path.id}:head`,
          label: `${path.name || '未命名路径'} · 首端`,
          edgeEnd: {
            kind: 'edge-end',
            sketchId: sketch.id,
            edgeId: first.edgeId,
            end: first.reversed ? 'end' : 'start',
          },
        },
        {
          key: `${sketch.id}:${path.id}:tail`,
          label: `${path.name || '未命名路径'} · 尾端`,
          edgeEnd: {
            kind: 'edge-end',
            sketchId: sketch.id,
            edgeId: last.edgeId,
            end: last.reversed ? 'start' : 'end',
          },
        },
      );
    }
  }
  const totals = new Map<string, number>();
  for (const option of result)
    totals.set(option.label, (totals.get(option.label) ?? 0) + 1);
  const occurrences = new Map<string, number>();
  return result.map((option) => {
    const occurrence = (occurrences.get(option.label) ?? 0) + 1;
    occurrences.set(option.label, occurrence);
    return totals.get(option.label) === 1
      ? option
      : {
          ...option,
          label: `${option.label}（${occurrence}）`,
        };
  });
};

const publishedSource = (
  document: DocumentV4,
  nodeId: string,
  regionsOnly: boolean,
): PortRef | null => {
  const node = document.nodes[nodeId];
  if (!node || node.kind !== 'shape') return null;
  const outputs = document.programs[node.programId]?.outputs;
  if (!outputs) return null;
  return outputs.regions ?? (regionsOnly ? null : (outputs.curves ?? null));
};

function EndpointFields({
  label,
  value,
  options,
  mirror,
  onChange,
}: {
  label: string;
  value: EndpointDraft;
  options: EndpointOption[];
  mirror: boolean;
  onChange: (next: EndpointDraft) => void;
}) {
  return (
    <fieldset style={fieldsetStyle}>
      <legend>{label}</legend>
      <label>
        路径端点
        <select
          value={value.endpointKey}
          onChange={(event) =>
            onChange({ ...value, endpointKey: event.target.value })
          }
        >
          <option value="">请选择</option>
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        所属份
        <select
          value={value.copy}
          onChange={(event) =>
            onChange({
              ...value,
              copy: event.target.value as EndpointDraft['copy'],
            })
          }
        >
          <option value="this">本份</option>
          <option value="next">下一份</option>
        </select>
      </label>
      {mirror && (
        <label>
          所属线条
          <select
            value={value.branch}
            onChange={(event) =>
              onChange({
                ...value,
                branch: event.target.value as EndpointDraft['branch'],
              })
            }
          >
            <option value="original">原线</option>
            <option value="mirror">镜像线</option>
          </select>
        </label>
      )}
    </fieldset>
  );
}

function RepeatPatternTask({
  document,
  ownerNodeId,
  onAction,
}: Pick<Props, 'document' | 'ownerNodeId' | 'onAction'>) {
  const [centerX, setCenterX] = useState('0');
  const [centerY, setCenterY] = useState('0');
  const [count, setCount] = useState('4');
  const [stepDegrees, setStepDegrees] = useState('90');
  const [mirror, setMirror] = useState(false);
  const [mirrorDegrees, setMirrorDegrees] = useState('0');
  const [connections, setConnections] = useState<ConnectionDraft[]>([
    newConnection(),
  ]);
  const [issue, setIssue] = useState('');
  const options = pathEndpoints(document, ownerNodeId);

  const updateEndpoint = (
    index: number,
    side: keyof ConnectionDraft,
    endpoint: EndpointDraft,
  ) =>
    setConnections((current) =>
      current.map((connection, connectionIndex) =>
        connectionIndex === index
          ? { ...connection, [side]: endpoint }
          : connection,
      ),
    );

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const x = Number(centerX);
    const y = Number(centerY);
    const copies = Number(count);
    const step = Number(stepDegrees);
    const axis = Number(mirrorDegrees);
    if (!ownerNodeId) {
      setIssue('请先选择一个部件。');
      return;
    }
    if (
      ![x, y, copies, step].every(Number.isFinite) ||
      !Number.isInteger(copies) ||
      copies < 1 ||
      (mirror && !Number.isFinite(axis))
    ) {
      setIssue('中心、数量和角度需要填写有效数值，数量至少为 1。');
      return;
    }
    const endpoints = new Map(options.map((option) => [option.key, option]));
    const resolvedConnections = connections.map((connection) => {
      const resolve = (endpoint: EndpointDraft) => {
        const option = endpoints.get(endpoint.endpointKey);
        if (!option) return null;
        return {
          edgeEnd: option.edgeEnd,
          index: endpoint.copy === 'this' ? 'each' : 'next',
          wrap: true,
          ...(mirror
            ? { mirrorIndex: endpoint.branch === 'original' ? 0 : 1 }
            : {}),
        };
      };
      const a = resolve(connection.a);
      const b = resolve(connection.b);
      return a && b ? { a, b } : null;
    });
    if (resolvedConnections.some((connection) => !connection)) {
      setIssue('请为每条连接明确选择两个路径端点。');
      return;
    }
    setIssue('');
    onAction({
      kind: ADVANCED_ACTIONS.repeatPattern,
      ownerNodeId,
      center: [x, y],
      count: copies,
      angleRad: radians(step),
      mirror: mirror ? { angleRad: radians(axis) } : false,
      connections: resolvedConnections,
    });
  };

  return (
    <form onSubmit={submit}>
      <p>围绕中心复制线条，连接相邻份并填充为区域。</p>
      <div>
        <label>
          中心 X
          <input
            type="number"
            step="any"
            value={centerX}
            onChange={(event) => setCenterX(event.target.value)}
            style={inputStyle}
          />
        </label>
        <label>
          中心 Y
          <input
            type="number"
            step="any"
            value={centerY}
            onChange={(event) => setCenterY(event.target.value)}
            style={inputStyle}
          />
        </label>
      </div>
      <div>
        <label>
          数量
          <input
            type="number"
            min="1"
            step="1"
            value={count}
            onChange={(event) => setCount(event.target.value)}
            style={inputStyle}
          />
        </label>
        <label>
          步进角
          <input
            type="number"
            step="any"
            value={stepDegrees}
            onChange={(event) => setStepDegrees(event.target.value)}
            style={inputStyle}
          />
          °
        </label>
      </div>
      <label>
        <input
          type="checkbox"
          checked={mirror}
          onChange={(event) => setMirror(event.target.checked)}
        />
        复制前先镜像
      </label>
      {mirror && (
        <label>
          镜像轴角度
          <input
            type="number"
            step="any"
            value={mirrorDegrees}
            onChange={(event) => setMirrorDegrees(event.target.value)}
            style={inputStyle}
          />
          °
        </label>
      )}
      <h4>端点连接</h4>
      {options.length === 0 && <p>此部件还没有可连接的路径。</p>}
      {connections.map((connection, index) => (
        <div key={index} style={fieldsetStyle}>
          <strong>连接 {index + 1}</strong>
          <EndpointFields
            label="起点"
            value={connection.a}
            options={options}
            mirror={mirror}
            onChange={(next) => updateEndpoint(index, 'a', next)}
          />
          <EndpointFields
            label="终点"
            value={connection.b}
            options={options}
            mirror={mirror}
            onChange={(next) => updateEndpoint(index, 'b', next)}
          />
          <button
            type="button"
            onClick={() =>
              setConnections((current) =>
                current.filter((_, itemIndex) => itemIndex !== index),
              )
            }
          >
            移除此连接
          </button>
        </div>
      ))}
      {connections.length === 0 && <p>各份保持独立，不连接端点。</p>}
      <button
        type="button"
        onClick={() =>
          setConnections((current) => [...current, newConnection()])
        }
      >
        添加连接
      </button>
      {issue && <p role="alert">{issue}</p>}
      <button type="submit" disabled={!ownerNodeId || options.length === 0}>
        创建重复纹样
      </button>
    </form>
  );
}

function ReferenceTask({ document, ownerNodeId, target, onAction }: Props) {
  const [mode, setMode] = useState<ReferenceMode>('reference-local');
  const [sourceNodeId, setSourceNodeId] = useState('');
  const [issue, setIssue] = useState('');
  const isCut = mode.startsWith('cut-');
  const activeOwnerId = ownerNodeId ?? target?.ownerNodeId;
  const sourceNodes = Object.values(document.nodes).filter(
    (node) =>
      node.kind === 'shape' &&
      node.id !== activeOwnerId &&
      publishedSource(document, node.id, isCut) !== null,
  );
  const selectedSource = sourceNodes.some((node) => node.id === sourceNodeId)
    ? sourceNodeId
    : '';

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const source = publishedSource(document, selectedSource, isCut);
    const sourceNode = document.nodes[selectedSource];
    if (!source || !sourceNode || sourceNode.kind !== 'shape') {
      setIssue('请选择一个可用的来源部件。');
      return;
    }
    if (isCut) {
      if (!target) {
        setIssue('请先选择要切割的区域。');
        return;
      }
      setIssue('');
      onAction({
        kind: ADVANCED_ACTIONS.cutReferenceRegions,
        targets: [target],
        sourceRegionPort: source,
        space: mode === 'cut-world' ? 'world-result' : 'local-result',
      });
      return;
    }
    setIssue('');
    onAction({
      kind: ADVANCED_ACTIONS.referenceSource,
      source,
      space: mode === 'reference-world' ? 'world-result' : 'local-result',
      name: `${sourceNode.name} 引用`,
    });
  };

  return (
    <form onSubmit={submit}>
      <p>从另一个部件引用可见结果，或用它切割当前区域。</p>
      <label>
        任务
        <select
          value={mode}
          onChange={(event) => setMode(event.target.value as ReferenceMode)}
        >
          <option value="reference-local">引用为可独立摆放的新部件</option>
          <option value="reference-world">按当前摆放位置引用为新部件</option>
          <option value="cut-world">按摆放位置切割</option>
          <option value="cut-local">只取形状切割</option>
        </select>
      </label>
      <label>
        来源部件
        <select
          value={selectedSource}
          onChange={(event) => setSourceNodeId(event.target.value)}
        >
          <option value="">请选择</option>
          {sourceNodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.name}
            </option>
          ))}
        </select>
      </label>
      {sourceNodes.length === 0 && <p>没有其他可用部件。</p>}
      {isCut && !target && <p>切割前请选择一个区域。</p>}
      {issue && <p role="alert">{issue}</p>}
      <button type="submit" disabled={!selectedSource || (isCut && !target)}>
        {isCut ? '执行切割' : '创建引用部件'}
      </button>
    </form>
  );
}

const numericPair = (value: unknown): [number, number] | null =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((item) => typeof item === 'number' && Number.isFinite(item))
    ? [value[0] as number, value[1] as number]
    : null;

function ExistingOperatorEditor({
  ownerNodeId,
  operator,
  onAction,
}: {
  ownerNodeId: string;
  operator: Operator;
  onAction: Props['onAction'];
}) {
  const center = numericPair(operator.params.center);
  const angle = operator.params.angleRad;
  const count = operator.params.count;
  const editable =
    center &&
    typeof angle === 'number' &&
    Number.isFinite(angle) &&
    (operator.type !== 'curve-array' ||
      (typeof count === 'number' && Number.isFinite(count)));

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editable) return;
    const data = new FormData(event.currentTarget);
    const x = Number(data.get('centerX'));
    const y = Number(data.get('centerY'));
    const angleDegrees = Number(data.get('angle'));
    const copies = Number(data.get('count'));
    if (
      ![x, y, angleDegrees].every(Number.isFinite) ||
      (operator.type === 'curve-array' &&
        (!Number.isInteger(copies) || copies < 1))
    )
      return;
    onAction({
      kind: ADVANCED_ACTIONS.setOperator,
      ownerNodeId,
      operatorId: operator.id,
      params: {
        ...operator.params,
        center: [x, y],
        angleRad: radians(angleDegrees),
        ...(operator.type === 'curve-array' ? { count: copies } : {}),
      },
    });
  };

  return (
    <form style={fieldsetStyle} onSubmit={submit}>
      <strong>
        {operator.name || (operator.type === 'curve-array' ? '重复' : '镜像')}
      </strong>
      <label>
        <input
          type="checkbox"
          checked={operator.enabled}
          onChange={(event) =>
            onAction({
              kind: ADVANCED_ACTIONS.setOperator,
              ownerNodeId,
              operatorId: operator.id,
              enabled: event.target.checked,
            })
          }
        />
        启用
      </label>
      {editable ? (
        <>
          <label>
            中心 X
            <input
              name="centerX"
              type="number"
              step="any"
              defaultValue={center[0]}
              style={inputStyle}
            />
          </label>
          <label>
            中心 Y
            <input
              name="centerY"
              type="number"
              step="any"
              defaultValue={center[1]}
              style={inputStyle}
            />
          </label>
          <label>
            角度
            <input
              name="angle"
              type="number"
              step="any"
              defaultValue={degrees(angle)}
              style={inputStyle}
            />
            °
          </label>
          {operator.type === 'curve-array' && (
            <label>
              数量
              <input
                name="count"
                type="number"
                min="1"
                step="1"
                defaultValue={count as number}
                style={inputStyle}
              />
            </label>
          )}
          <button type="submit">应用参数</button>
        </>
      ) : (
        <p>参数由关系或表达式控制；可在这里启停。</p>
      )}
    </form>
  );
}

function ExistingOperatorsTask({
  document,
  ownerNodeId,
  onAction,
}: Pick<Props, 'document' | 'ownerNodeId' | 'onAction'>) {
  const node = ownerNodeId ? document.nodes[ownerNodeId] : null;
  const program =
    node?.kind === 'shape' ? document.programs[node.programId] : null;
  const operators = program
    ? Object.values(program.operators).filter((operator) =>
        ['curve-array', 'curve-mirror'].includes(operator.type),
      )
    : [];
  if (!ownerNodeId) return <p>请先选择一个部件。</p>;
  if (!operators.length) return <p>此部件还没有重复或镜像步骤。</p>;
  return operators.map((operator) => (
    <ExistingOperatorEditor
      key={`${operator.id}:${JSON.stringify(operator.params)}`}
      ownerNodeId={ownerNodeId}
      operator={operator}
      onAction={onAction}
    />
  ));
}

export function V4ConstructionTasks(props: Props) {
  const ownerNodeId = props.ownerNodeId ?? props.target?.ownerNodeId;
  return (
    <section aria-label="构造任务">
      <h2>构造任务</h2>
      <details>
        <summary>重复纹样</summary>
        <RepeatPatternTask
          document={props.document}
          ownerNodeId={ownerNodeId}
          onAction={props.onAction}
        />
      </details>
      <details>
        <summary>引用与切割其他部件</summary>
        <ReferenceTask {...props} ownerNodeId={ownerNodeId} />
      </details>
      <details>
        <summary>调整重复与镜像</summary>
        <ExistingOperatorsTask
          document={props.document}
          ownerNodeId={ownerNodeId}
          onAction={props.onAction}
        />
      </details>
    </section>
  );
}
