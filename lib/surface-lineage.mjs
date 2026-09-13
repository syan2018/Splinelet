// The geometry kernel reports contours. This module names them from their
// directed source edges, independently of coordinates, area, colour or height.
export function contourSignatures(cells, sources) {
  const segments = [];
  const visit = (g, id) => {
    if (['LineString', 'LinearRing'].includes(g.getGeometryType())) {
      const q = g.getCoordinates();
      for (let i = 1; i < q.length; i++) {
        const a = q[i - 1],
          b = q[i],
          dx = b.x - a.x,
          dy = b.y - a.y,
          l2 = dx * dx + dy * dy;
        if (l2 > 1e-16) segments.push({ id, a, b, dx, dy, l2 });
      }
    } else
      for (let i = 0; i < g.getNumGeometries(); i++)
        visit(g.getGeometryN(i), id);
  };
  sources.forEach((s) => visit(s.geometry, s.id));
  const ringSignature = (ring) => {
    let q = ring.getCoordinates();
    const area = q
      .slice(1)
      .reduce((n, p, i) => n + q[i].x * p.y - p.x * q[i].y, 0);
    if (area < 0) q = q.slice().reverse();
    const labels = [];
    for (let i = 1; i < q.length; i++) {
      const a = q[i - 1],
        b = q[i],
        dx = b.x - a.x,
        dy = b.y - a.y;
      if (Math.hypot(dx, dy) < 2e-6) continue;
      const x = (a.x + b.x) / 2,
        y = (a.y + b.y) / 2;
      const hits = [];
      for (const s of segments) {
        const tolerance = 2e-5;
        if (
          x < Math.min(s.a.x, s.b.x) - tolerance ||
          x > Math.max(s.a.x, s.b.x) + tolerance ||
          y < Math.min(s.a.y, s.b.y) - tolerance ||
          y > Math.max(s.a.y, s.b.y) + tolerance
        )
          continue;
        const t = Math.max(
          0,
          Math.min(1, ((x - s.a.x) * s.dx + (y - s.a.y) * s.dy) / s.l2),
        );
        const distance = Math.hypot(x - s.a.x - t * s.dx, y - s.a.y - t * s.dy);
        if (distance <= tolerance)
          hits.push(s.id + (dx * s.dx + dy * s.dy > 0 ? '+' : '-'));
      }
      // The composite base is a fallback for generated offset boundaries.
      const specific = hits.filter((id) => !id.startsWith('base'));
      const label = [...new Set(specific.length ? specific : hits)]
        .sort()
        .join('&');
      if (!label) throw Error('有一段输出边界无法追溯到来源，分区链路已停止');
      if (label !== labels.at(-1)) labels.push(label);
    }
    if (labels.length > 1 && labels[0] === labels.at(-1)) labels.pop();
    return (
      labels
        .map((_, i) =>
          JSON.stringify([...labels.slice(i), ...labels.slice(0, i)]),
        )
        .sort()[0] || '[]'
    );
  };
  return cells.map((g) =>
    JSON.stringify([
      ringSignature(g.getExteriorRing()),
      Array.from({ length: g.getNumInteriorRing() }, (_, i) =>
        ringSignature(g.getInteriorRingN(i)),
      ).sort(),
    ]),
  );
}

export function pipelineError(stage, message, details = {}) {
  return Object.assign(new Error(message), {
    pipeline: { kind: 'pipeline', stage, state: 'blocked', ...details },
  });
}

// A contract contains references and appearance only. No polygon is persisted
// or used as a fallback surface when an upstream operation stops working.
export function resolveSurfaceGraph(object, signatures, importedStyles) {
  if (new Set(signatures).size !== signatures.length)
    throw pipelineError(
      'partition',
      '分区产物的来源关系不唯一，请拆成独立的分区步骤',
    );
  const previous = object.surfaceGraph;
  if (previous) {
    const lost = previous.outputs.filter(
      (output) => !signatures.includes(output.signature),
    );
    if (lost.length)
      throw pipelineError(
        'partition',
        `分区关系已改变，${lost.length} 个下游轮廓失去来源。请修复源线，或确认重建分区输出`,
        {
          lostKeys: lost.map((o) => o.key),
          expected: previous.outputs.length,
          actual: signatures.length,
        },
      );
  }
  const used = new Set(previous?.outputs.map((o) => o.key) || []);
  let next = 0;
  const outputs = signatures.map((signature, i) => {
    const existing = previous?.outputs.find((o) => o.signature === signature);
    if (existing) return existing;
    let key;
    if (previous) {
      let a = 2166136261,
        b = 5381;
      for (const c of signature) {
        a = Math.imul(a ^ c.charCodeAt(0), 16777619);
        b = Math.imul(b, 33) ^ c.charCodeAt(0);
      }
      key =
        object.id +
        ':surface:' +
        (a >>> 0).toString(36) +
        (b >>> 0).toString(36);
      if (used.has(key))
        throw pipelineError('partition', '输出标识重复，请检查分区来源');
    } else
      do {
        key = object.id + ':cell:' + next++;
      } while (used.has(key));
    used.add(key);
    return {
      key,
      signature,
      ...(!previous && importedStyles?.[i] ? { style: importedStyles[i] } : {}),
    };
  });
  return { version: 1, outputs };
}

export function bindSurfaceGraphs(project, scene) {
  let next;
  for (const [id, graph] of Object.entries(scene.surfaceGraphs || {})) {
    if (scene.errors?.some((e) => e.objectId === id)) continue;
    if (
      JSON.stringify(
        project.creation?.objects.find((o) => o.id === id)?.surfaceGraph,
      ) === JSON.stringify(graph)
    )
      continue;
    next ||= {
      ...project,
      version: 3,
      creation: structuredClone(scene.creation),
    };
    const object = next.creation.objects.find((o) => o.id === id);
    object.surfaceGraph = structuredClone(graph);
    // Retire spatial appearance matching after a successful one-time import.
    object.paints = [];
  }
  for (const o of scene.creation?.objects || [])
    for (const modifier of [
      ...(o.modifiers || []),
      ...Object.values(o.sources || {}).flatMap((s) => s.modifiers),
    ]) {
      const contract = scene.modifierContracts?.[modifier.id];
      if (!contract || modifier.outputContract) continue;
      next ||= {
        ...project,
        version: 3,
        creation: structuredClone(scene.creation),
      };
      const owner = next.creation.objects.find((x) => x.id === o.id);
      const target = [
        ...owner.modifiers,
        ...Object.values(owner.sources || {}).flatMap((s) => s.modifiers),
      ].find((m) => m.id === modifier.id);
      target.outputContract = structuredClone(contract);
      if (scene.modifierBindings?.[modifier.id])
        target.targets = structuredClone(scene.modifierBindings[modifier.id]);
    }
  for (const [id, signature] of Object.entries(scene.regionBindings || {})) {
    if (
      project.model.regions.find((r) => r.id === id)?.contourSignature ===
      signature
    )
      continue;
    next ||= {
      ...project,
      version: 3,
      creation: structuredClone(scene.creation),
    };
    if (next.model === project.model)
      next.model = structuredClone(project.model);
    next.model.regions.find((r) => r.id === id).contourSignature = signature;
  }
  return next || project;
}

export function validateSurfaceGraph(graph, swatches) {
  if (graph === undefined) return;
  if (
    graph?.version !== 1 ||
    !Array.isArray(graph.outputs) ||
    graph.outputs.length > 2000
  )
    throw Error('构造链输出无效');
  const keys = new Set(),
    signatures = new Set();
  for (const o of graph.outputs) {
    if (
      typeof o.key !== 'string' ||
      !o.key ||
      o.key.length > 500 ||
      keys.has(o.key) ||
      typeof o.signature !== 'string' ||
      o.signature.length > 200000 ||
      signatures.has(o.signature)
    )
      throw Error('构造链输出引用无效');
    keys.add(o.key);
    signatures.add(o.signature);
    if (
      o.style &&
      (!swatches.has(o.style.swatchId) ||
        !Number.isFinite(o.style.heightMM) ||
        o.style.heightMM < 0.01 ||
        o.style.heightMM > 1000 ||
        !Number.isFinite(o.style.zOffsetMM) ||
        Math.abs(o.style.zOffsetMM) > 1000)
    )
      throw Error('面片颜色或厚度无效');
  }
}
