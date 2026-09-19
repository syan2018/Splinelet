'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { pickSelection } from '@/lib/source-editor/selection.mjs';

export type CreationSelection = {
  kind: 'object' | 'path' | 'cell';
  ids: string[];
};
type Modifiers = { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };
type CreationObject = { id: string; pathIds: string[] };
type CreationDocument = { objects: CreationObject[] };
type CreationCell = { key: string; objectId: string };
type CreationScene = { cells: CreationCell[] };
const signature = (ids: string[]) => JSON.stringify(ids);

// One semantic selection. Source-editor paths are its projection, never a second
// independent object/cell selection. Explicit source clicks use selectPaths.
export function useCreationSelection(p: {
  doc: CreationDocument;
  scene: CreationScene | null;
  selectedPaths: string[];
  onSelectPaths: (ids: string[]) => void;
  root: RefObject<HTMLElement | null>;
  onTab: (tab: string) => void;
  onChoose: (selection: CreationSelection) => void;
}) {
  const { doc, scene, selectedPaths, onSelectPaths, root, onTab, onChoose } = p;
  const [selection, setSelection] = useState<CreationSelection>({
    kind: 'object',
    ids: [],
  });
  const latest = useRef(selection);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [expandedCells, setExpandedCells] = useState<string[]>([]);
  const [reveal, setReveal] = useState<CreationSelection | null>(null);
  const sourceSignature = useRef(signature(selectedPaths));
  const observedSourceSignature = useRef(signature(selectedPaths));
  const ownerSignature = useRef('[]');
  const anchors = useRef<Partial<Record<CreationSelection['kind'], string>>>(
    {},
  );
  const derive = useCallback(
    (s: CreationSelection) => {
      const cells =
        s.kind === 'cell'
          ? s.ids
              .map((key) => scene?.cells.find((c) => c.key === key))
              .filter((cell): cell is CreationCell => cell !== undefined)
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
                          doc.objects.find((o) => o.pathIds.includes(id))?.id,
                      )
                      .filter((id): id is string => id !== undefined)
                  : cells.map((c) => c.objectId),
              ),
            ];
      const paths: string[] =
        s.kind === 'path'
          ? s.ids
          : [
              ...new Set<string>(
                objects.flatMap(
                  (id) => doc.objects.find((o) => o.id === id)?.pathIds || [],
                ),
              ),
            ];
      return {
        objects,
        paths,
        cellKeys: cells.map((c) => c.key),
      };
    },
    [doc, scene],
  );
  const commit = useCallback(
    (next: CreationSelection, revealInTree = true) => {
      next = { ...next, ids: [...new Set(next.ids)] };
      latest.current = next;
      setSelection(next);
      onChoose(next);
      const d = derive(next);
      ownerSignature.current = signature(d.objects);
      sourceSignature.current = signature(d.paths);
      onSelectPaths(d.paths);
      if (next.ids.length) onTab(next.kind === 'path' ? 'lines' : 'object');
      if (revealInTree && next.ids.length) {
        if (next.kind !== 'object')
          setExpanded((ids) => [...new Set([...ids, ...d.objects])]);
        if (next.kind === 'cell')
          setExpandedCells((ids) => [...new Set([...ids, ...d.objects])]);
        setReveal(next);
      }
      return d;
    },
    [derive, onChoose, onSelectPaths, onTab],
  );
  const choose = useCallback(
    (kind: CreationSelection['kind'], id: string, e: Modifiers = {}) => {
      const order =
        kind === 'object'
          ? doc.objects.map((o) => o.id)
          : kind === 'path'
            ? doc.objects.flatMap((o) => o.pathIds)
            : (scene?.cells || []).map((c) => c.key);
      const ids = pickSelection(
        latest.current.kind === kind ? latest.current.ids : [],
        id,
        order,
        {
          toggle: !!(e.ctrlKey || e.metaKey),
          range: !!e.shiftKey,
          anchor: anchors.current[kind] ?? null,
        },
      );
      if (!e.shiftKey) anchors.current[kind] = id;
      return commit({ kind, ids });
    },
    [commit, doc, scene],
  );
  useEffect(() => {
    const incoming = signature(selectedPaths);
    // A local selection updates sourceSignature before the parent projection
    // reaches our props. A passive effect from the previous render must not
    // mistake those unchanged, older props for a new external selection.
    if (observedSourceSignature.current === incoming) return;
    observedSourceSignature.current = incoming;
    if (sourceSignature.current === incoming) return;
    sourceSignature.current = incoming;
    commit({ kind: 'path', ids: selectedPaths });
  }, [commit, selectedPaths]);
  useEffect(() => {
    const current = latest.current;
    if (current.kind !== 'path' || !current.ids.length) return;
    const owners = derive(current).objects;
    const incoming = signature(owners);
    if (incoming === ownerSignature.current) return;
    ownerSignature.current = incoming;
    // A reparent (including undo/redo) keeps the same path selection IDs.
    // Reveal their new owners without turning a drag into object selection.
    setExpanded((ids) => [...new Set([...ids, ...owners])]);
    setReveal(current);
  }, [derive, doc]);
  useEffect(() => {
    if (!scene) return;
    const current = latest.current;
    const valid =
      current.kind === 'object'
        ? doc.objects.map((o) => o.id)
        : current.kind === 'path'
          ? doc.objects.flatMap((o) => o.pathIds)
          : scene.cells.map((c) => c.key);
    const ids = current.ids.filter((id) => valid.includes(id));
    if (ids.length !== current.ids.length) commit({ ...current, ids }, false);
  }, [commit, doc, scene]);
  useEffect(() => {
    if (!reveal?.ids.length) return;
    const element = Array.from(
      root.current?.querySelectorAll<HTMLElement>(
        `[data-tree-${reveal.kind}]`,
      ) || [],
    ).find(
      (e) =>
        e.dataset[
          `tree${reveal.kind[0].toUpperCase()}${reveal.kind.slice(1)}`
        ] === reveal.ids.at(-1),
    );
    const tree = root.current?.querySelector('.creation-tree');
    if (element && tree) {
      // Scroll only the outliner, never the document or drawing viewport.
      const r = element.getBoundingClientRect(),
        t = tree.getBoundingClientRect();
      if (r.top < t.top) tree.scrollTop -= t.top - r.top + 4;
      else if (r.bottom > t.bottom) tree.scrollTop += r.bottom - t.bottom + 4;
    }
  }, [reveal, expanded, expandedCells, root]);
  const derived = derive(selection);
  return {
    selection,
    ...derived,
    expanded,
    setExpanded,
    expandedCells,
    setExpandedCells,
    scope:
      selection.kind === 'cell'
        ? 'local'
        : selection.kind === 'object'
          ? 'object'
          : 'source',
    choose,
    commit,
    selectPaths: (ids: string[]) => commit({ kind: 'path', ids }),
    clear: () => commit({ kind: 'object', ids: [] }, false),
  };
}
