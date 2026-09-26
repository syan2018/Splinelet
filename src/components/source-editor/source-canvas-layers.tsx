import type React from 'react';
import { d, type Point } from '@/lib/project';
import type { StudioDisplayPath } from '@/lib/editor/studio-display-types';
import {
  nodeSelection,
  pathNodes,
  selectedNode,
} from '@/lib/source-editor/node-edit.mjs';
import { nodeModes } from '@/lib/source-editor/continuity.mjs';

type SourcePathLayersProps = {
  paths: readonly StudioDisplayPath[];
  scale: number;
  tool: string;
  selectedPaths: string[];
  highlightSourceSelection: boolean;
  fill: boolean;
  onSelectPath: (event: React.PointerEvent, pathId: string) => void;
  onEditPath: (pathId: string) => void;
  onSplitAt: (event: React.MouseEvent, pathId: string) => void;
};

export function SourcePathLayers({
  paths,
  scale,
  tool,
  selectedPaths,
  highlightSourceSelection,
  fill,
  onSelectPath,
  onEditPath,
  onSplitAt,
}: SourcePathLayersProps) {
  return paths.map((path) => (
    <g
      key={path.id}
      data-source-id={path.id}
      className={
        'source-path-layer' +
        (highlightSourceSelection && selectedPaths.includes(path.id)
          ? ' selected'
          : '')
      }
    >
      {!path.curves.length && (
        <circle
          cx={path.start.x}
          cy={path.start.y}
          r={5 / scale}
          fill={path.color}
          onPointerDown={(e) => onSelectPath(e, path.id)}
          onDoubleClick={() => onEditPath(path.id)}
        />
      )}
      <path
        d={d(path.curves) + (path.closed ? ' Z' : '')}
        fill={fill && path.closed ? path.color + '24' : 'none'}
        stroke={path.color}
        strokeWidth={
          (highlightSourceSelection && selectedPaths.includes(path.id)
            ? 2.8
            : 1.5) / scale
        }
        opacity={
          highlightSourceSelection &&
          selectedPaths.length &&
          !selectedPaths.includes(path.id)
            ? 0.55
            : 1
        }
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        aria-label={path.name}
        d={d(path.curves) + (path.closed ? ' Z' : '')}
        fill="none"
        stroke="transparent"
        strokeWidth={(tool === 'select' ? 3 : 14) / scale}
        style={{
          pointerEvents: ['edit', 'select', 'move'].includes(tool)
            ? 'stroke'
            : 'none',
        }}
        onPointerDown={(e) => onSelectPath(e, path.id)}
        onDoubleClick={(e) => onSplitAt(e, path.id)}
      />
    </g>
  ));
}

type SourceNodeHandlesProps = {
  path: StudioDisplayPath;
  scale: number;
  selectedNodes: number[];
  selection: { curve: number; point: number } | null;
  onPointPointerDown: (
    event: React.PointerEvent,
    curve: number,
    point: number,
  ) => void;
};

export function SourceNodeHandles({
  path,
  scale,
  selectedNodes,
  selection,
  onPointPointerDown,
}: SourceNodeHandlesProps) {
  return (
    <>
      {' '}
      {path.curves.map((c, i) => (
        <g key={i}>
          {[1, 2]
            .filter((k) => {
              const node =
                selectedNodes.length === 1
                  ? selectedNode(path, selection)
                  : null;
              return node !== null
                ? (k === 1
                    ? i
                    : path.closed
                      ? (i + 1) % path.curves.length
                      : i + 1) === node
                : !selectedNodes.length && selection?.curve === i;
            })
            .map((k) => (
              <g
                key={k}
                data-control-handle={i + ':' + k}
                onPointerDown={(e) => onPointPointerDown(e, i, k)}
                style={{ cursor: 'grab' }}
              >
                <line
                  x1={c[k === 1 ? 0 : 3].x}
                  y1={c[k === 1 ? 0 : 3].y}
                  x2={c[k].x}
                  y2={c[k].y}
                  stroke={path.color}
                  opacity=".6"
                  strokeWidth={1 / scale}
                />
                <circle
                  cx={c[k].x}
                  cy={c[k].y}
                  r={9 / scale}
                  fill="transparent"
                />
                <circle
                  cx={c[k].x}
                  cy={c[k].y}
                  r={4 / scale}
                  stroke={path.color}
                  strokeWidth={1 / scale}
                  fill={
                    selection?.curve === i && selection.point === k
                      ? path.color
                      : '#20272c'
                  }
                  pointerEvents="none"
                />
              </g>
            ))}
        </g>
      ))}
      {pathNodes(path).map((p: Point, index: number) => {
        const selected = selectedNodes.includes(index);
        const item = nodeSelection(path, index);
        return (
          <a
            key={'node-' + index}
            href={'#node-' + index}
            aria-label={'节点 ' + (index + 1)}
            data-node-index={index}
            data-node-mode={nodeModes(path)[index]}
            onPointerDown={(e) => onPointPointerDown(e, item.curve, item.point)}
            style={{ cursor: 'move' }}
          >
            <circle cx={p.x} cy={p.y} r={11 / scale} fill="transparent" />
            {selected && (
              <circle
                cx={p.x}
                cy={p.y}
                r={9 / scale}
                fill="#ffbe5530"
                stroke="#ffbe55"
                strokeWidth={1 / scale}
                pointerEvents="none"
              />
            )}
            <rect
              x={p.x - (selected ? 5 : 4) / scale}
              y={p.y - (selected ? 5 : 4) / scale}
              rx={nodeModes(path)[index] === 'corner' ? 0 : 3 / scale}
              width={(selected ? 10 : 8) / scale}
              height={(selected ? 10 : 8) / scale}
              fill={selected ? '#ffbe55' : path.color}
              stroke={selected ? '#fff5db' : '#102015'}
              strokeWidth={1.5 / scale}
              pointerEvents="none"
            />
            {!path.closed && [0, path.curves.length].includes(index) && (
              <text
                x={p.x + 10 / scale}
                y={p.y - 12 / scale}
                fontSize={11 / scale}
                fill="#e5ffc5"
                paintOrder="stroke"
                stroke="#162321"
                strokeWidth={3 / scale}
                pointerEvents="none"
              >
                {index === 0 ? '头' : '尾'}
              </text>
            )}
          </a>
        );
      })}
    </>
  );
}
