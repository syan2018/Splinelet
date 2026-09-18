import { zipSync, strToU8 } from 'three/addons/libs/fflate.module.js';
import { buildSolid } from './solid-engine.mjs';
import { inspectMesh } from './mesh-format.mjs';
import { bambuPackage } from './bambu-3mf.mjs';
import { xmlEscape as esc } from './xml-escape.mjs';

const core = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const rels = 'http://schemas.openxmlformats.org/package/2006/relationships';
const metadata = (name, value) =>
  `<metadata name="bs:${name}" preserve="true">${esc(JSON.stringify(value))}</metadata>`;

export function pack3MF(
  parts,
  { name = '作品', printStack, slicerTemplate } = {},
) {
  if (!Array.isArray(parts) || !parts.length)
    throw Error('没有可导出的分色实体');
  const colors = [...new Set(parts.map((p) => p.color.toUpperCase()))];
  if (colors.some((color) => !/^#[0-9A-F]{6}$/.test(color)))
    throw Error('3MF 材料颜色无效');
  const materials = colors.map((color) => ({
    color,
    name:
      (parts.find((p) => p.color.toUpperCase() === color).swatchName || color) +
      ' · ' +
      color,
  }));
  const objects = parts.map((part, index) => {
    if (!inspectMesh(part.mesh).valid)
      throw Error(`「${part.name}」不是有效闭合网格`);
    const { positions, triangles } = part.mesh;
    const vertices = [],
      faces = [];
    for (let i = 0; i < positions.length; i += 3) {
      if (
        ![positions[i], positions[i + 1], positions[i + 2]].every(
          Number.isFinite,
        )
      )
        throw Error('网格坐标无效');
      // Preserve the actual float32 geometry exactly, without decimal rounding.
      vertices.push(
        `<vertex x="${positions[i]}" y="${positions[i + 1]}" z="${positions[i + 2]}"/>`,
      );
    }
    for (let i = 0; i < triangles.length; i += 3)
      faces.push(
        `<triangle v1="${triangles[i]}" v2="${triangles[i + 1]}" v3="${triangles[i + 2]}"/>`,
      );
    const label = [
      part.printLayerName,
      part.objectName,
      part.name,
      part.swatchName,
    ]
      .filter((n, i, list) => n && list.indexOf(n) === i)
      .join(' · ');
    return `<object id="${index + 2}" type="model" name="${esc(label || part.name)}" pid="1" pindex="${colors.indexOf(part.color.toUpperCase())}">
<metadatagroup>${metadata('Source', { objectId: part.objectId, cellKey: part.cellKey, featureId: part.id, printLayerId: part.printLayerId })}</metadatagroup>
<mesh><vertices>${vertices.join('')}</vertices><triangles>${faces.join('')}</triangles></mesh></object>`;
  });
  const assemblyId = parts.length + 2;
  const compatibility = slicerTemplate
    ? bambuPackage(
        parts.map((p) => ({ ...p, report: inspectMesh(p.mesh) })),
        materials,
        {
          name,
          assemblyId,
          printStack,
          slicerTemplate,
        },
      )
    : null;
  // Bambu gates config loading on the template's application/version marker.
  // Record our actual generator separately instead of claiming this is a
  // sliced file. Only enable this adapter with a validated real configuration.
  const application = compatibility
    ? slicerTemplate.application
    : 'Bezier Studio';
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="zh-CN" xmlns="${core}" xmlns:bs="https://bezier.studio/3mf/metadata/1"${compatibility ? ' xmlns:bamboo_slicer="http://schemas.bambulab.com/package/2021"' : ''}>
<metadata name="Application">${esc(application)}</metadata><metadata name="Title">${esc(name)}</metadata>
${compatibility ? '<metadata name="bamboo_slicer:Version3mf">1</metadata>' + metadata('Generator', 'Bezier Studio · Bambu template adapter') : ''}
${printStack ? metadata('PrintStack', printStack) : ''}
<resources><basematerials id="1">${materials.map((m) => `<base name="${esc(m.name)}" displaycolor="${m.color}FF"/>`).join('')}</basematerials>
${objects.join('\n')}
<object id="${assemblyId}" type="model" name="${esc(name)}"><components>${parts.map((_, i) => `<component objectid="${i + 2}"/>`).join('')}</components></object>
</resources><build><item objectid="${assemblyId}"${compatibility ? ` transform="${compatibility.transform}"` : ''}/></build></model>`;
  const bytes = zipSync(
    {
      '[Content_Types].xml': strToU8(
        `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>${compatibility ? '<Default Extension="config" ContentType="application/octet-stream"/>' : ''}</Types>`,
      ),
      '_rels/.rels': strToU8(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rels}"><Relationship Id="rel0" Target="/3D/3dmodel.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
      ),
      '3D/3dmodel.model': strToU8(model),
      ...compatibility?.entries,
    },
    { level: 6 },
  );
  return {
    bytes: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ),
    materials,
    slicer: compatibility?.info || null,
  };
}

export async function export3MF(
  project,
  partId = 'main',
  options,
  { slicerTemplate = null } = {},
) {
  const result = await buildSolid(project, partId, options, {
    materials: true,
  });
  const name =
    project.model?.parts.find((p) => p.id === partId)?.name || '作品';
  const packed = pack3MF(result.materialParts, {
    name,
    printStack: project.creation?.printStack,
    slicerTemplate,
  });
  return {
    ...packed,
    filename: name + '.3mf',
    mimeType: 'model/3mf',
    report: result.report,
    warnings: result.warnings,
    parts: result.materialParts.map(({ mesh: _mesh, ...part }) => part),
  };
}
