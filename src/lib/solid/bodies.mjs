import { describe, geometryContours, readGeometry } from '../region-engine.mjs';
import {
  cleanMesh,
  initSolid,
  inspectMesh,
  solidMesh,
} from '../solid-engine.mjs';
import { partitionMaterialSolids } from '../material-solids.mjs';

const clone = (value) => structuredClone(value);
const unique = (values) => [...new Set(values)];
const stage = (status, value, diagnostics = [], dependencies = []) => ({
  domain: 'bodies',
  status,
  ...(value === undefined ? {} : { value }),
  diagnostics,
  dependencies: unique(dependencies),
});
const passthrough = (input) =>
  stage(
    input.status,
    undefined,
    clone(input.diagnostics || []),
    input.dependencies || [],
  );

/** Converts a PlacedReliefSet directly into cloneable meshes; no legacy Project is built. */
export async function buildBodies(
  placedResult,
  options,
  meshToleranceMM = 0.005,
  cleanupRadiusMM = 0,
) {
  if (!placedResult || placedResult.domain !== 'placed-relief')
    return stage('blocked', undefined, [
      { code: 'invalid-input', message: '需要 PlacedReliefSet' },
    ]);
  if (['absent', 'blocked'].includes(placedResult.status))
    return passthrough(placedResult);
  if (placedResult.status === 'empty')
    return stage(
      'empty',
      { bodies: [], provenance: [] },
      placedResult.diagnostics,
      placedResult.dependencies,
    );
  const reliefs = placedResult.value?.reliefs;
  if (!Array.isArray(reliefs))
    return stage(
      'blocked',
      undefined,
      [{ code: 'invalid-input', message: 'PlacedReliefSet DTO 无效' }],
      placedResult.dependencies,
    );
  const owned = new Set();
  const own = (value) => {
    owned.add(value);
    return value;
  };
  try {
    if (!Number.isFinite(cleanupRadiusMM) || cleanupRadiusMM < 0)
      throw Error('制造清理半径必须是非负有限数');
    const m = await initSolid(options);
    const bodies = [];
    for (const [partId, members] of Object.entries(
      Object.groupBy(
        reliefs.filter((item) => item.enabled),
        (item) => item.partId,
      ),
    )) {
      const features = members.map((item, index) => ({
        ...item,
        id: `${item.ref.ownerNodeId}:${item.ref.operatorId}:${item.ref.port}:${item.ref.key}:${index}`,
      }));
      const adds = features.filter((item) => item.mode === 'add');
      if (!adds.length) continue;
      const sections = new Map();
      const crossFor = (item) => {
        const key = JSON.stringify(item.ref);
        if (!sections.has(key)) {
          let geometry = item.geometry;
          if (cleanupRadiusMM > 0) {
            const cleaned = readGeometry(geometry)
              .buffer(cleanupRadiusMM, 4)
              .buffer(-cleanupRadiusMM, 4);
            if (cleaned.isEmpty())
              throw Error(
                `输出 ${item.ref?.key || 'unknown'} 在制造清理后为空，请减小清理半径`,
              );
            geometry = describe(cleaned).geometry;
          }
          let section = own(
            new m.CrossSection(geometryContours(geometry), 'EvenOdd'),
          );
          if (cleanupRadiusMM > 0)
            section = own(section.simplify(meshToleranceMM));
          sections.set(key, section);
        }
        return sections.get(key);
      };
      const minZ = Math.min(...adds.map((item) => item.zBase));
      const maxZ = Math.max(...adds.map((item) => item.zTop));
      const cuts = features.filter((item) => item.mode !== 'add');
      for (const item of [
        ...adds,
        ...cuts.filter((item) => item.mode !== 'through'),
      ])
        if (
          !(
            Number.isFinite(item.zBase) &&
            Number.isFinite(item.zTop) &&
            item.zTop > item.zBase
          )
        )
          throw Error(`输出 ${item.ref?.key || 'unknown'} 的 Z 范围无效`);
      const simplifyCleanup = (section) =>
        cleanupRadiusMM > 0 ? own(section.simplify(meshToleranceMM)) : section;
      const unionSections = (sections) =>
        simplifyCleanup(
          sections.length === 1
            ? sections[0]
            : own(m.CrossSection.union(sections)),
        );
      const levels = [
        ...adds.flatMap((item) => [item.zBase, item.zTop]),
        ...cuts
          .filter((item) => item.mode !== 'through')
          .flatMap((item) => [item.zBase, item.zTop]),
      ]
        .filter((z) => z >= minZ && z <= maxZ)
        .sort((a, b) => a - b)
        .filter((z, index, values) => !index || z !== values[index - 1]);
      const slabs = [];
      for (let index = 0; index < levels.length - 1; index++) {
        const bottom = levels[index],
          top = levels[index + 1],
          mid = (bottom + top) / 2,
          activeAdds = adds.filter(
            (item) => item.zBase < mid && item.zTop > mid,
          );
        if (!activeAdds.length) continue;
        let section = unionSections(activeAdds.map(crossFor));
        const activeCuts = cuts
          .filter(
            (item) =>
              item.mode === 'through' || (item.zBase < mid && item.zTop > mid),
          )
          .map(crossFor);
        if (activeCuts.length)
          section = simplifyCleanup(
            own(section.subtract(unionSections(activeCuts))),
          );
        if (section.isEmpty() || section.area() < 1e-9) continue;
        slabs.push(
          own(own(section.extrude(top - bottom)).translate([0, 0, bottom])),
        );
      }
      const solid = slabs.length
        ? slabs.length === 1
          ? slabs[0]
          : own(m.Manifold.union(slabs))
        : own(new m.Manifold());
      if (solid.isEmpty()) continue;
      let mesh = cleanMesh(solid.getMesh(), true),
        report = inspectMesh(mesh);
      // `asOriginal().setTolerance()` is valuable for an invalid raw result,
      // but can turn a valid closed cleanup mesh with many shared source faces
      // into an unbounded simplification job. Keep its precision-repair path
      // for invalid meshes only.
      if (!report.valid)
        ({ mesh, report } = solidMesh(solid, own, meshToleranceMM));
      if (!report.valid)
        throw Error(
          `Part ${partId} 生成了无效实体：${report.invalidEdges} 条异常边，${report.zeroArea} 个零面积面，体积 ${report.volumeMM3} mm³`,
        );
      const byId = new Map(features.map((item) => [item.id, item]));
      const height = {
        get: (id) => {
          const relief = byId.get(id);
          return { bottom: relief.zBase, top: relief.zTop };
        },
      };
      const materialParts = [];
      for (const { feature, solid: materialSolid } of partitionMaterialSolids({
        m,
        own,
        adds,
        cuts,
        height,
        crossFor,
      })) {
        let materialMesh = cleanMesh(materialSolid.getMesh(), true),
          materialReport = inspectMesh(materialMesh);
        if (!materialReport.valid)
          ({ mesh: materialMesh, report: materialReport } = solidMesh(
            materialSolid,
            own,
            meshToleranceMM,
          ));
        if (!materialReport.valid)
          throw Error(`输出 ${feature.ref.key} 的材料实体无效`);
        materialParts.push({
          ref: clone(feature.ref),
          color: feature.color,
          swatchId: feature.swatchId,
          mesh: materialMesh,
          report: materialReport,
          volumeMM3: materialReport.volumeMM3,
        });
      }
      const materialVolume = materialParts.reduce(
        (sum, item) => sum + item.volumeMM3,
        0,
      );
      if (
        Math.abs(materialVolume - report.volumeMM3) >
        Math.max(0.001, report.volumeMM3 * 1e-5)
      )
        throw Error(`Part ${partId} 的材料体积与实体不一致`);
      bodies.push({
        partId,
        mesh,
        report,
        materialParts,
        sources: members.map((item) => clone(item.ref)),
      });
    }
    return stage(
      bodies.length ? 'ready' : 'empty',
      {
        bodies,
        provenance: bodies.flatMap((body) => body.sources),
      },
      [],
      placedResult.dependencies,
    );
  } catch (error) {
    return stage(
      'blocked',
      undefined,
      [{ code: 'body-build-failed', message: error.message }],
      placedResult.dependencies,
    );
  } finally {
    for (const object of [...owned].reverse()) object.delete();
  }
}
