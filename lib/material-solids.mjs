// All current manufacturing primitives are vertical extrusions. Partition their
// exact height intervals in 2D before extruding material volumes. This avoids an
// exponentially expanding CSG tree of A - (B + (C - B) + ...).
export function partitionMaterialSolids({
  m,
  own,
  adds,
  cuts,
  height,
  crossFor,
}) {
  const ordered = adds
    .map((feature, index) => ({
      feature,
      index,
      range: height.get(feature.id),
    }))
    .sort(
      (a, b) =>
        b.range.top - a.range.top ||
        (b.feature.manufacturing?.order ?? b.index) -
          (a.feature.manufacturing?.order ?? a.index),
    );
  const ranges = ordered.flatMap(({ range }) => [range.bottom, range.top]);
  const min = Math.min(...ranges),
    max = Math.max(...ranges);
  for (const f of cuts.filter((f) => f.mode !== 'through')) {
    const h = height.get(f.id);
    ranges.push(Math.max(min, h.bottom), Math.min(max, h.top));
  }
  const levels = [...new Set(ranges)]
    .filter((z) => z >= min && z <= max)
    .sort((a, b) => a - b);
  const slabs = new Map(adds.map((f) => [f.id, []]));
  for (let i = 0; i < levels.length - 1; i++) {
    const bottom = levels[i],
      top = levels[i + 1],
      mid = (bottom + top) / 2;
    if (top - bottom < 1e-9) continue;
    const cutters = cuts
      .filter(
        (f) =>
          f.mode === 'through' ||
          (height.get(f.id).bottom < mid && height.get(f.id).top > mid),
      )
      .map(crossFor);
    let occupied = cutters.length ? own(m.CrossSection.union(cutters)) : null;
    for (const { feature, range } of ordered) {
      if (range.bottom >= top || range.top <= bottom) continue;
      const source = crossFor(feature),
        section = occupied ? own(source.subtract(occupied)) : source;
      // Claim the full input footprint, not a recursive reference to its own
      // already-subtracted output. CrossSection operations are eager Clipper2.
      occupied = occupied ? own(occupied.add(source)) : source;
      if (section.isEmpty() || section.area() < 1e-9) continue;
      const parts = slabs.get(feature.id),
        key = JSON.stringify(section.toPolygons()),
        previous = parts.at(-1);
      if (previous?.top === bottom && previous.key === key) previous.top = top;
      else parts.push({ bottom, top, section, key });
    }
  }
  return ordered.flatMap(({ feature }) => {
    const ownSlabs = slabs.get(feature.id);
    if (!ownSlabs.length) return [];
    const bodies = ownSlabs.map(({ bottom, top, section }) =>
      own(own(section.extrude(top - bottom)).translate([0, 0, bottom])),
    );
    return [
      {
        feature,
        solid: bodies.length === 1 ? bodies[0] : own(m.Manifold.union(bodies)),
      },
    ];
  });
}
