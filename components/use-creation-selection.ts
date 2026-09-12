'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { pickSelection } from '@/public/selection.mjs';

export type CreationSelection = {
  kind: 'object' | 'path' | 'cell';
  ids: string[];
};
type Modifiers = { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };
const signature = (ids: string[]) => JSON.stringify(ids);

// One semantic selection. Source-editor paths are its projection, never a second
// independent object/cell selection. Explicit source clicks use selectPaths.
export function useCreationSelection(p: {
  doc: any;
  scene: any;
  selectedPaths: string[];
  onSelectPaths: (ids: string[]) => void;
  root: RefObject<HTMLElement | null>;
  onTab: (tab: string) => void;
}) {
  const [selection, setSelection] = useState<CreationSelection>({
    kind: 'object',
    ids: [],
  });
  const latest = useRef(selection);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [expandedCells, setExpandedCells] = useState<string[]>([]);
  const [reveal, setReveal] = useState<CreationSelection | null>(null);
  const sourceSignature = useRef(signature(p.selectedPaths));
  const anchors = useRef<Partial<Record<CreationSelection['kind'], string>>>(
    {},
  );
  const derive = (s: CreationSelection) => {
    const cells =
      s.kind === 'cell'
        ? s.ids
            .map((key) => p.scene?.cells.find((c: any) => c.key === key))
            .filter(Boolean)
        : [];
    const objects: string[] =
      s.kind === 'object'
        ? s.ids
        : [
            ...new Set<string>(
              s.kind === 'path'
                ? s.ids
                    .map(
                      (id) =>
                        p.doc.objects.find((o: any) => o.pathIds.includes(id))
                          ?.id,
                    )
                    .filter(Boolean)
                : cells.map((c: any) => c.objectId),
            ),
          ];
    const paths: string[] =
      s.kind === 'path'
        ? s.ids
        : [
            ...new Set<string>(
              objects.flatMap(
                (id) =>
                  p.doc.objects.find((o: any) => o.id === id)?.pathIds || [],
              ),
            ),
          ];
    return {
      objects,
      paths,
      cellKeys: cells.map((c: any) => c.key) as string[],
    };
  };
  const commit = (next: CreationSelection, revealInTree = true) => {
    next = { ...next, ids: [...new Set(next.ids)] };
    latest.current = next;
    setSelection(next);
    const d = derive(next);
    sourceSignature.current = signature(d.paths);
    p.onSelectPaths(d.paths);
    if (next.ids.length) p.onTab(next.kind === 'path' ? 'lines' : 'object');
    if (revealInTree && next.ids.length) {
      if (next.kind !== 'object')
        setExpanded((ids) => [...new Set([...ids, ...d.objects])]);
      if (next.kind === 'cell')
        setExpandedCells((ids) => [...new Set([...ids, ...d.objects])]);
      setReveal(next);
    }
    return d;
  };
  const choose = (
    kind: CreationSelection['kind'],
    id: string,
    e: Modifiers = {},
  ) => {
    const order =
      kind === 'object'
        ? p.doc.objects.map((o: any) => o.id)
        : kind === 'path'
          ? p.doc.objects.flatMap((o: any) => o.pathIds)
          : (p.scene?.cells || []).map((c: any) => c.key);
    const ids = pickSelection(
      latest.current.kind === kind ? latest.current.ids : [],
      id,
      order,
      {
        toggle: !!(e.ctrlKey || e.metaKey),
        range: !!e.shiftKey,
        anchor: anchors.current[kind] as any,
      },
    );
    if (!e.shiftKey) anchors.current[kind] = id;
    return commit({ kind, ids });
  };
  useEffect(() => {
    const incoming = signature(p.selectedPaths);
    if (sourceSignature.current === incoming) return;
    sourceSignature.current = incoming;
    commit({ kind: 'path', ids: p.selectedPaths });
  }, [p.selectedPaths]);
  useEffect(() => {
    if (!p.scene) return;
    const current = latest.current;
    const valid =
      current.kind === 'object'
        ? p.doc.objects.map((o: any) => o.id)
        : current.kind === 'path'
          ? p.doc.objects.flatMap((o: any) => o.pathIds)
          : p.scene.cells.map((c: any) => c.key);
    const ids = current.ids.filter((id) => valid.includes(id));
    if (ids.length !== current.ids.length) commit({ ...current, ids }, false);
  }, [p.scene]);
  useEffect(() => {
    if (!reveal?.ids.length) return;
    const element = Array.from(
      p.root.current?.querySelectorAll<HTMLElement>(
        `[data-tree-${reveal.kind}]`,
      ) || [],
    ).find(
      (e) =>
        e.dataset[
          `tree${reveal.kind[0].toUpperCase()}${reveal.kind.slice(1)}`
        ] === reveal.ids.at(-1),
    );
    const tree = p.root.current?.querySelector('.creation-tree');
    if (element && tree) {
      // Scroll only the outliner, never the document or drawing viewport.
      const r = element.getBoundingClientRect(),
        t = tree.getBoundingClientRect();
      if (r.top < t.top) tree.scrollTop -= t.top - r.top + 4;
      else if (r.bottom > t.bottom) tree.scrollTop += r.bottom - t.bottom + 4;
    }
  }, [reveal, expanded, expandedCells]);
  const derived = derive(selection);
  return {
    selection,
    ...derived,
    expanded,
    setExpanded,
    expandedCells,
    setExpandedCells,
    scope: selection.kind === 'cell' ? 'local' : 'object',
    choose,
    commit,
    selectPaths: (ids: string[]) => commit({ kind: 'path', ids }),
    clear: () => commit({ kind: 'object', ids: [] }, false),
  };
}
