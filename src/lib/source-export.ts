export type SourceExportPoint = Readonly<{ x: number; y: number }>;
export type SourceExportCubic = readonly [
  SourceExportPoint,
  SourceExportPoint,
  SourceExportPoint,
  SourceExportPoint,
];
export type SourceExportPath = Readonly<{
  id: string;
  name: string;
  color: string;
  curves: readonly SourceExportCubic[];
  closed: boolean;
  visible: boolean;
  quality: number;
  groupId?: string;
  nodeModes?: readonly ('corner' | 'smooth' | 'symmetric')[];
}>;
export type SourceExportGroup = Readonly<{ id: string; name: string }>;

/** The smallest immutable projection needed by source-curve exports. */
export type SourceExportDocument = Readonly<{
  width: number;
  height: number;
  widthMM: number;
  depthMM: number;
  groups?: readonly SourceExportGroup[];
  paths: readonly SourceExportPath[];
}>;

const escapeXml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (character) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[character]!,
  );

const format = (value: number) => +value.toFixed(4);

export function sourcePathData(
  curves: readonly (readonly SourceExportPoint[])[],
) {
  return curves.length
    ? `M ${format(curves[0][0].x)} ${format(curves[0][0].y)} ` +
        curves
          .map(
            (curve) =>
              `C ${curve
                .slice(1)
                .map((point) => `${format(point.x)} ${format(point.y)}`)
                .join(' ')}`,
          )
          .join(' ')
    : '';
}

export function exportSourceSvg(project: SourceExportDocument) {
  const paths = project.paths.filter(
    (path) => path.visible && path.curves.length,
  );
  const content = [...(project.groups || []), { id: '', name: '未分组' }]
    .map((group) => {
      const body = paths
        .filter((path) => (path.groupId || '') === group.id)
        .map(
          (path) =>
            `<path id="${escapeXml(path.id)}" data-name="${escapeXml(path.name)}" d="${sourcePathData(path.curves)}${path.closed ? ' Z' : ''}" fill="none" stroke="${path.color}" stroke-width="1"/>`,
        )
        .join('\n');
      return !body
        ? ''
        : group.id
          ? `<g id="group-${escapeXml(group.id)}" data-name="${escapeXml(group.name)}">\n${body}\n</g>`
          : body;
    })
    .filter(Boolean)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${project.widthMM}mm" height="${format((project.widthMM * project.height) / project.width)}mm" viewBox="0 0 ${project.width} ${project.height}"><title>描迹 · 可编辑贝塞尔曲线</title>\n${content}\n</svg>`;
}

export function exportSourceBlender(project: SourceExportDocument) {
  const data = {
    width: project.width,
    height: project.height,
    widthMM: project.widthMM,
    depthMM: project.depthMM,
    groups: project.groups || [],
    paths: project.paths.filter((path) => path.visible && path.curves.length),
  };
  return `# 描迹 / Blender 4.x and 5.x\n# Scripting > New > paste or open this file > Run Script.\n# Imports into a NEW collection; existing objects remain intact.\n# Closed curves are filled and extruded; open strokes remain editable curves.\nimport bpy, json\nDATA = json.loads(${JSON.stringify(JSON.stringify(data))})\nscale = DATA['widthMM'] / DATA['width'] / 1000.0\ncollection = bpy.data.collections.new('描迹 · Imported curves')\nbpy.context.scene.collection.children.link(collection)\ngroup_collections = {}\nfor group in DATA.get('groups', []):\n    child = bpy.data.collections.new(group['name'])\n    collection.children.link(child)\n    group_collections[group['id']] = child\nbpy.context.scene.unit_settings.system = 'METRIC'\nbpy.context.scene.unit_settings.scale_length = 1.0\nbpy.context.scene.unit_settings.length_unit = 'MILLIMETERS'\ndef point(p):\n    return ((p['x']-DATA['width']/2)*scale, (DATA['height']/2-p['y'])*scale, 0)\nfor item in DATA['paths']:\n    spans = item['curves']\n    curve = bpy.data.curves.new(item['name'], 'CURVE')\n    curve.dimensions = '2D'\n    curve.resolution_u = 24\n    curve.render_resolution_u = 32\n    curve.fill_mode = 'BOTH' if item['closed'] else 'NONE'\n    curve.extrude = DATA['depthMM']/2000.0 if item['closed'] else 0\n    spline = curve.splines.new('BEZIER')\n    count = len(spans) if item['closed'] else len(spans)+1\n    spline.bezier_points.add(count-1)\n    spline.use_cyclic_u = item['closed']\n    for i, bp in enumerate(spline.bezier_points):\n        anchor = spans[i][0] if i < len(spans) else spans[-1][3]\n        bp.co = point(anchor)\n        bp.handle_left_type = 'FREE'\n        bp.handle_right_type = 'FREE'\n        bp.handle_left = point(spans[i-1][2]) if i > 0 else (point(spans[-1][2]) if item['closed'] else point(anchor))\n        bp.handle_right = point(spans[i][1]) if i < len(spans) else point(anchor)\n    obj = bpy.data.objects.new(item['name'], curve)\n    group_collections.get(item.get('groupId'), collection).objects.link(obj)\n    obj['node_modes'] = json.dumps(item.get('nodeModes', []))\n    obj['source'] = 'Bezier Studio'\n    obj['source_id'] = item['id']\n    obj['closed'] = item['closed']\n    obj['trace_quality'] = item['quality']\nprint('Imported', len(DATA['paths']), 'editable Bezier paths. Closed regions may overlap; review and combine before meshing or printing.')\n`;
}
