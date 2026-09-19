import {
  unzipSync,
  strFromU8,
  strToU8,
} from 'three/addons/libs/fflate.module.js';
import { xmlEscape as esc } from './xml-escape.mjs';
import { filamentOptions } from './bambu-filament-options.mjs';

const settingsPath = 'Metadata/project_settings.config';
const excluded =
  /^(?:print_host|printhost_|host_type|bed_custom_|post_process|printer_notes|filament_notes)/;

export function validateSlicerTemplate(template) {
  const s = template?.settings;
  if (
    template?.version !== 1 ||
    template?.kind !== 'bambu' ||
    !/^BambuStudio-\d+(?:\.\d+){2,3}$/.test(template.application || '') ||
    !s ||
    !Array.isArray(s.nozzle_diameter) ||
    !s.nozzle_diameter.length ||
    !s.nozzle_diameter.every((n) => Number.isFinite(+n) && +n > 0) ||
    (s.nozzle_diameter.length > 1 &&
      s.extruder_type?.length !== s.nozzle_diameter.length) ||
    !s.printer_settings_id ||
    !s.print_settings_id ||
    !Array.isArray(s.filament_settings_id) ||
    !s.filament_settings_id.length ||
    !s.filament_settings_id.every(Boolean) ||
    !Array.isArray(s.filament_colour) ||
    s.filament_colour.length !== s.filament_settings_id.length ||
    !s.filament_colour.every((c) => /^#[a-f\d]{6}([a-f\d]{2})?$/i.test(c)) ||
    !Array.isArray(s.printable_area) ||
    s.printable_area.length < 3
  )
    throw Error('需要包含打印机、工艺和耗材配置的 Bambu Studio 工程 3MF');
  return template;
}

// Read configuration only. No source geometry, thumbnails, accounts, slice
// results, G-code files or network credentials are carried into the new model.
export function readSlicerTemplate(bytes, name = 'Bambu Studio 配置') {
  const entries = unzipSync(new Uint8Array(bytes), {
    filter: (f) =>
      (f.name === settingsPath || f.name === '3D/3dmodel.model') &&
      f.originalSize < 32_000_000,
  });
  if (!entries[settingsPath])
    throw Error(
      '该 3MF 只有模型，未包含 Bambu 切片配置。请在 Bambu Studio 中保存项目后选择该文件。',
    );
  const raw = JSON.parse(strFromU8(entries[settingsPath]));
  const application =
    entries['3D/3dmodel.model'] &&
    strFromU8(entries['3D/3dmodel.model']).match(
      /<metadata\s+name="Application"[^>]*>(BambuStudio-[\d.]+)<\/metadata>/,
    )?.[1];
  if (!application)
    throw Error('请选择由 Bambu Studio 保存的工程 3MF，作为兼容配置模板');
  const settings = Object.fromEntries(
    Object.entries(raw).filter(([k]) => !excluded.test(k)),
  );
  return validateSlicerTemplate({
    version: 1,
    kind: 'bambu',
    name,
    application,
    settings,
  });
}

export function bambuPackage(
  parts,
  materials,
  { name, assemblyId, printStack, slicerTemplate },
) {
  const template = validateSlicerTemplate(slicerTemplate);
  const source = template.settings,
    settings = structuredClone(source);
  const oldCount = source.filament_settings_id.length;
  const palette = (source.filament_colour || []).map((c) =>
    c.slice(0, 7).toUpperCase(),
  );
  // Exact colour matches keep their template filament; new colours inherit
  // the first physical filament recipe, never an invented machine profile.
  const slots = materials.map((m) => Math.max(0, palette.indexOf(m.color)));
  const mapped = new Set([
    ...filamentOptions,
    'filament_settings_id',
    'filament_ids',
    'filament_map',
    'filament_volume_map',
    'filament_nozzle_map',
    'flush_multiplier',
    'flush_multiplier_fast',
  ]);
  for (const key of mapped) {
    const v = source[key];
    if (Array.isArray(v) && v.length === oldCount)
      settings[key] = slots.map((slot) => structuredClone(v[slot]));
  }
  // Clear colour mixing and object/plate-specific sequencing from the template.
  settings.filament_colour = materials.map((m) => m.color);
  settings.filament_multi_colour = materials.map((m) => m.color);
  settings.filament_colour_type = materials.map(() => '0');
  settings.filament_self_index = materials.map((_, i) => String(i + 1));
  for (const key of Object.keys(settings)) {
    if (key.startsWith('filament_mixed_')) delete settings[key];
    if (excluded.test(key)) delete settings[key];
  }
  settings.filament_is_mixed = materials.map(() => '0');
  delete settings.first_layer_print_sequence;
  delete settings.other_layers_print_sequence;
  delete settings.flush_volumes_matrix;
  delete settings.flush_volumes_vector;
  // Let the slicer compute a fresh purge matrix for these colours.
  for (const key of ['inherits_group', 'different_settings_to_system']) {
    const v = source[key];
    if (Array.isArray(v) && v.length === oldCount + 2)
      settings[key] = [v[0], ...slots.map((i) => v[i + 1]), v.at(-1)];
  }
  const h = printStack?.layerHeightMM;
  if (h != null) {
    if (!(h > 0 && Number.isFinite(h))) throw Error('工程打印层高无效');
    settings.layer_height = String(h);
    settings.initial_layer_print_height = String(h);
    // A distinct process name prevents Bambu from replacing the changed layer
    // height with the installed preset that has the template's original name.
    settings.print_settings_id = `${source.print_settings_id} · Bezier ${h}mm`;
  }
  const meta = (key, value) => `<metadata key="${key}" value="${esc(value)}"/>`;
  const modelSettings = `<?xml version="1.0" encoding="UTF-8"?><config>
<object id="${assemblyId}">${meta('name', name)}${meta('extruder', 1)}
${parts.map((p, i) => `<part id="${i + 2}" subtype="normal_part">${meta('name', p.exportName || p.name)}${meta('extruder', materials.findIndex((m) => m.color === p.color.toUpperCase()) + 1)}${meta('matrix', '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1')}</part>`).join('')}
</object></config>`;
  const bed = settings.printable_area.map((p) => p.split('x').map(Number));
  if (bed.some((p) => p.length !== 2 || !p.every(Number.isFinite)))
    throw Error('切片模板的打印平台边界无效');
  const bounds = [
    [Infinity, Infinity, Infinity],
    [-Infinity, -Infinity, -Infinity],
  ];
  for (const part of parts) {
    const report = part.report;
    if (!report?.bounds) throw Error('导出部件缺少尺寸检查结果');
    for (let axis = 0; axis < 3; axis++) {
      bounds[0][axis] = Math.min(bounds[0][axis], report.bounds[0][axis]);
      bounds[1][axis] = Math.max(bounds[1][axis], report.bounds[1][axis]);
    }
  }
  const offset = [0, 1].map(
    (axis) =>
      (Math.min(...bed.map((p) => p[axis])) +
        Math.max(...bed.map((p) => p[axis])) -
        bounds[0][axis] -
        bounds[1][axis]) /
      2,
  );
  return {
    transform: `1 0 0 0 1 0 0 0 1 ${offset[0]} ${offset[1]} ${-bounds[0][2]}`,
    entries: {
      [settingsPath]: strToU8(JSON.stringify(settings)),
      'Metadata/model_settings.config': strToU8(modelSettings),
    },
    info: {
      kind: 'bambu',
      templateName: template.name,
      printer: settings.printer_settings_id,
      layerHeightMM: +settings.layer_height,
      materials: materials.map((m, i) => ({
        ...m,
        extruder: i + 1,
        profile: settings.filament_settings_id[i],
      })),
    },
  };
}
