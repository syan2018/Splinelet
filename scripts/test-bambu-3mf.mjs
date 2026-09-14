import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';
import {
  readSlicerTemplate,
  bambuPackage,
  validateSlicerTemplate,
} from '../lib/bambu-3mf.mjs';
import { export3MF } from '../lib/three-mf.mjs';
import { liveSurfaces } from './fixtures/live-surfaces.mjs';

// Synthetic settings exercise mapping without bundling a user's printer setup.
const template = {
  version: 1,
  kind: 'bambu',
  application: 'BambuStudio-02.08.02.61',
  name: 'test',
  settings: {
    printer_settings_id: 'Test printer',
    printer_model: 'Test',
    print_settings_id: 'Test process',
    nozzle_diameter: ['0.4', '0.6'],
    extruder_type: ['Direct Drive', 'Direct Drive'],
    filament_settings_id: ['PLA', 'PETG'],
    filament_colour: ['#123456', '#ABCDEF'],
    nozzle_temperature: ['210', '240'],
    filament_density: ['1.24', '1.27'],
    machine_max_speed_x: ['500', '200'],
    printable_area: ['0x0', '180x0', '180x180', '0x180'],
    layer_height: '0.12',
    initial_layer_print_height: '0.2',
    filament_mixed_gradient: ['0', '0'],
    flush_volumes_matrix: ['0', '100', '100', '0'],
    printhost_apikey: 'must-not-be-exported',
    post_process: ['not carried'],
  },
};
const original = structuredClone(template);
const parts = ['#ABCDEF', '#123456', '#987654'].map((color, i) => ({
  name: '区域<&' + i,
  color,
  report: {
    bounds: [
      [-40, -50, 1],
      [40, 50, 3],
    ],
  },
}));
const a = bambuPackage(
  parts,
  parts.map((p) => ({ color: p.color, name: p.name })),
  {
    name: 'test',
    assemblyId: 5,
    printStack: { layerHeightMM: 0.16 },
    slicerTemplate: template,
  },
);
const s = JSON.parse(strFromU8(a.entries['Metadata/project_settings.config']));
assert.deepEqual(s.filament_settings_id, ['PETG', 'PLA', 'PLA']);
assert.deepEqual(s.nozzle_temperature, ['240', '210', '210']);
assert.deepEqual(s.nozzle_diameter, ['0.4', '0.6']);
assert.deepEqual(s.machine_max_speed_x, ['500', '200']);
assert.equal(s.layer_height, '0.16');
assert.equal(s.initial_layer_print_height, '0.16');
assert.notEqual(s.print_settings_id, template.settings.print_settings_id);
assert(
  !s.printhost_apikey &&
    !s.post_process &&
    !s.filament_mixed_gradient &&
    !s.flush_volumes_matrix,
);
assert.equal(a.transform, '1 0 0 0 1 0 0 0 1 90 90 -1');
const xml = strFromU8(a.entries['Metadata/model_settings.config']);
assert.equal((xml.match(/<part /g) || []).length, 3);
assert(xml.includes('区域&lt;&amp;'));
assert.deepEqual(template, original);
assert.throws(() =>
  validateSlicerTemplate({
    ...template,
    settings: { ...template.settings, extruder_type: ['Direct Drive'] },
  }),
);
assert.throws(
  () =>
    readSlicerTemplate(fs.readFileSync('../../outputs/3mf/two-materials.3mf')),
  /只有模型/,
);
const project = liveSurfaces();
project.model.slicerTemplate = template;
const result = await export3MF(project);
const zip = unzipSync(new Uint8Array(result.bytes));
assert(
  zip['Metadata/project_settings.config'] &&
    zip['Metadata/model_settings.config'],
);
assert(strFromU8(zip['3D/3dmodel.model']).includes('bs:Generator'));
assert.equal(result.slicer.kind, 'bambu');
const generic = await export3MF(project, 'main', undefined, {
  slicerTemplate: null,
});
assert(
  !unzipSync(new Uint8Array(generic.bytes))['Metadata/project_settings.config'],
);
console.log(
  'PASS: native config, profile/color mapping, multi-nozzle isolation, layer height, placement, stale config cleanup, immutable template and explicit generic export',
);
