import { pack3MF } from '../three-mf.mjs';
import { sameDocument } from '../editing/history.mjs';

/** Adapt a canonical BodySet to the established output panel's result DTO. */
export function creationOutput(document, snapshot, action, args) {
  if (!['solid', '3mf'].includes(action)) throw Error('未知成品操作');
  if (
    Object.keys(args).some((key) => !['partId', 'slicerTemplate'].includes(key))
  )
    throw Error('成品参数无效');
  const partId = args.partId ?? document.manufacturing.defaultPartId;
  const part = document.manufacturing.parts[partId];
  if (!part) throw Error('所选制造零件不存在');
  const stage = snapshot.bodies;
  if (stage?.status !== 'ready')
    throw Error(
      stage?.diagnostics?.map((item) => item.message).join('；') ||
        '当前没有可输出实体',
    );
  const body = stage.value.bodies.find((item) => item.partId === partId);
  if (!body) throw Error('所选零件没有可输出实体');
  const result = {
    partId,
    mesh: body.mesh,
    report: body.report,
    warnings: (stage.diagnostics || []).map((item) => item.message),
  };
  if (action === 'solid') return structuredClone(result);
  if (
    args.slicerTemplate != null &&
    !sameDocument(args.slicerTemplate, document.manufacturing.slicerTemplate)
  )
    throw Error('切片模板不属于当前工程');
  const materials = body.materialParts.map((material, index) => ({
    id: `${partId}:${index}`,
    name: material.ref.key,
    color: material.color,
    swatchName: material.swatchId || material.color,
    report: structuredClone(material.report),
    mesh: material.mesh,
  }));
  const packed = pack3MF(materials, {
    name: part.name,
    slicerTemplate: args.slicerTemplate ?? undefined,
  });
  return {
    ...packed,
    filename: `${part.name}.3mf`,
    mimeType: 'model/3mf',
    report: structuredClone(body.report),
    warnings: result.warnings,
    parts: materials.map(({ mesh: _mesh, ...item }) => item),
  };
}
