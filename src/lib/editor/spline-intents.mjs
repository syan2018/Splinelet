import { prepareSplineEdits } from '../source-editor/spline-proposal.mjs';
import { createAuthoringCommand } from '../editing/commands/authoring.mjs';
import { createPathIntent } from './path-intents.mjs';
import { sourceViewToWorld } from './source-view.mjs';
import { evaluateProgram } from '../construction/document-evaluation.mjs';

/** Compile the original exact-spline batch from readonly source facts. Each
 * entry becomes canonical authoring commands within one Editor transaction.
 */
export function createSplineIntent(request, displayed, document) {
  const view = structuredClone(displayed);
  const args = structuredClone(request);
  if (
    !view?.source ||
    view.previewId != null ||
    typeof view.epoch !== 'string' ||
    !Number.isInteger(view.revision)
  )
    throw Error('样条编辑需要已提交的源视图');
  const proposals = prepareSplineEdits(
    {
      frame: view.source.frame,
      paths: view.source.paths,
      objects: Object.values(document.nodes)
        .filter((node) => node.kind === 'shape')
        .map((node) => ({
          id: node.id,
          pathIds: view.source.paths
            .filter((path) => path.ownerNodeId === node.id)
            .map((path) => path.id),
        })),
    },
    args,
  );
  const plans = proposals.map((proposal, index) => {
    const entry = args.splines[index];
    const source = view.source.paths.find(
      (path) => path.id === proposal.pathId,
    );
    if (
      proposal.pathId === null ||
      (entry.nodes == null &&
        entry.matrix == null &&
        proposal.closed === source.closed)
    )
      return null;
    return createPathIntent(
      {
        kind: 'replace-path-geometry',
        pathId: proposal.pathId,
        pixelCubics: proposal.curves,
        closed: proposal.closed,
        ...(proposal.nodeModes === undefined
          ? {}
          : { handleModes: proposal.nodeModes }),
      },
      view,
    );
  });
  return (initial, context) => {
    if (context.epoch !== view.epoch || context.revision !== view.revision)
      throw Error('样条视图已失效');
    let current = initial;
    const changedRefs = [],
      paths = [];
    const run = (command) => {
      const result = command(current, context);
      current = result.document;
      changedRefs.push(...(result.changedRefs || []));
      return result;
    };
    proposals.forEach((proposal, index) => {
      let path;
      if (proposal.pathId !== null) {
        if (plans[index]) run(plans[index]);
        path = view.source.identities.byId[proposal.pathId];
      } else {
        const cubics = proposal.curves.map((c) =>
          c.map((p) => sourceViewToWorld(view.source.frame, p)),
        );
        const points = [
          ...cubics.map((c) => c[0]),
          ...(proposal.closed ? [] : [cubics.at(-1)[3]]),
        ];
        const action = {
          kind: proposal.role === 'guide' ? 'draw-guide' : 'draw-path',
          cubics,
          points,
          closed: proposal.closed,
          name: proposal.name,
          ...(proposal.ownerId === null
            ? {}
            : { ownerNodeId: proposal.ownerId }),
        };
        if (proposal.role === 'hole') {
          const regions = evaluateProgram(current, proposal.ownerId).regions;
          if (regions.status !== 'ready' || !regions.value.regions.length)
            throw Error('挖洞需要部件内可用的区域');
          action.kind = 'draw-hole';
          action.targets = regions.value.regions.map((region) => region.ref);
        }
        const result = run(createAuthoringCommand(action));
        path = result.changedRefs.find((ref) => ref.kind === 'path');
        if (!path) throw Error('新样条命令未返回路径身份');
      }
      run(
        createAuthoringCommand({
          kind: 'set-paths',
          pathRefs: [path],
          value: { name: proposal.name },
        }),
      );
      paths.push(path);
    });
    return {
      document: current,
      changedRefs,
      selectionIntent: {
        scope: 'paths',
        entityRefs: paths,
        activeRef: paths.at(-1) || null,
      },
    };
  };
}
