import { geometryContours } from '../region-engine.mjs';
import { initSolid, solidMesh } from '../solid-engine.mjs';
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
        if (!sections.has(key))
          sections.set(
            key,
            own(new m.CrossSection(geometryContours(item.geometry), 'EvenOdd')),
          );
        return sections.get(key);
      };
      const extrude = (item, bottom = item.zBase, top = item.zTop) => {
        if (!(Number.isFinite(bottom) && Number.isFinite(top) && top > bottom))
          throw Error(`输出 ${item.ref?.key || 'unknown'} 的 Z 范围无效`);
        return own(
          own(crossFor(item).extrude(top - bottom)).translate([0, 0, bottom]),
        );
      };
      let solid = own(m.Manifold.union(adds.map((item) => extrude(item))));
      const minZ = Math.min(...adds.map((item) => item.zBase));
      const maxZ = Math.max(...adds.map((item) => item.zTop));
      const cuts = features.filter((item) => item.mode !== 'add');
      for (const cutter of cuts) {
        const tool =
          cutter.mode === 'through'
            ? extrude(cutter, minZ - 1, maxZ + 1)
            : extrude(cutter);
        solid = own(solid.subtract(tool));
      }
      if (solid.isEmpty()) continue;
      const { mesh, report } = solidMesh(solid, own, meshToleranceMM);
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
        const { mesh: materialMesh, report: materialReport } = solidMesh(
          materialSolid,
          own,
          meshToleranceMM,
        );
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
