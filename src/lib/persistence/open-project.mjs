import { decodeDocument } from '../document/codec.mjs';
import { decodeProject } from '../project-format.mjs';
import { importLegacy as importLegacyDocument } from '../document/import/legacy-import.mjs';

/** Both formats enter one V4 session; conversion does not bind the old file. */
export function openProject(
  input,
  {
    decodeV4 = decodeDocument,
    decodeLegacy = decodeProject,
    importLegacy = importLegacyDocument,
  } = {},
) {
  try {
    const decoded = decodeV4(input.bytes);
    return {
      kind: 'v4',
      document: decoded.document,
      assets: decoded.assets,
      target: input.target || null,
      report: null,
    };
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
    return {
      kind: 'legacy',
      document: legacy.documentV4 || legacy.document,
      assets: legacy.assets || {},
      target: input.target || null,
      report: legacy.report,
    };
  }
}
