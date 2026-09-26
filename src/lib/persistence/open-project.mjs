import { decodeDocument } from '../document/codec.mjs';
import { decodeProject } from '../project-format.mjs';
import { importLegacy as importLegacyDocument } from '../document/import/legacy-import.mjs';
import { migrateRegionDefinitions } from '../document/import/region-definitions.mjs';

/** Conversion is atomic at the file boundary and never binds the old file. */
export function openProject(
  input,
  {
    decodeV4 = decodeDocument,
    decodeLegacy = decodeProject,
    importLegacy = importLegacyDocument,
    migrate = migrateRegionDefinitions,
  } = {},
) {
  let decoded;
  try {
    decoded = decodeV4(input.bytes);
  } catch (v4Error) {
    if (typeof importLegacy !== 'function') throw v4Error;
    let source = input.legacy;
    if (!source) {
      try {
        source = decodeLegacy(input.bytes);
      } catch {
        throw v4Error;
      }
    }
    const legacy = importLegacy(source);
    const converted = migrate(legacy.documentV4 || legacy.document);
    return {
      kind: 'migrated',
      document: converted.document,
      assets: legacy.assets || {},
      target: null,
      dirty: true,
      report: { ...legacy.report, regionMigration: converted.report },
    };
  }
  if (decoded.document.version === 5)
    return {
      kind: 'v5',
      document: decoded.document,
      assets: decoded.assets,
      target: input.target || null,
      report: null,
    };
  // Migration errors propagate as such; they must not trigger a legacy decoder
  // or replace the currently open editor with a partially converted document.
  const converted = migrate(decoded.document);
  return {
    kind: 'migrated',
    document: converted.document,
    assets: decoded.assets,
    target: null,
    dirty: true,
    report: converted.report,
  };
}
