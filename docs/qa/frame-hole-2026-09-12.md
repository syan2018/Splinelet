# Object holes and named regions

> Status: historical QA snapshot from 2026-09-12. Referenced local output artifacts are not stored in this repository.

## QA inventory

- Reproduce the ignored `外框镂空` in the latest 74-path Sandrone project, using a frozen copy. Check overlap area before and after, live changes to its nodes, changing its role, undo and reload.
- A hole cuts every surface owned by its object: imported extrusion, imported flat region, ordinary candidate, partitioned candidate and converted painted surface. Other objects, original recipes, per-region identity, names, colours and heights remain unchanged.
- Preview and compiled 3D geometry must agree. Verify no material is added back by the original imported feature during export, and preserve attachment heights.
- Exploratory cases: disjoint hole, complete removal, multiple holes, invalid/open hole, multiple imported surfaces with different colours/heights, local property edits after a cut.
- Outliner region buttons show their actual names (or the same fallback label as the inspector), retain single/multiple selection and framing, and wrap long names within a narrow inspector. Check on the full artwork and compact viewport with real browser inputs and screenshots.

## Findings and changes

The saved `外框镂空` was a valid closed six-span path with the correct role. Candidate surfaces subtracted object holes, while imported feature and flat-region outputs bypassed that stage. The compiled mesh also read the original feature recipe independently. The frame therefore overlapped the hole by 68.43117476 mm².

Hole evaluation/subtraction now has one shared implementation. Imported surfaces preserve their identities and per-surface properties while applying the same live cuts. Compilation overrides only the affected feature's derived geometry; shared source recipes remain intact. Completely removed features are disabled in compilation and their dependent layers retain their resolved world heights.

The audit also removed saved-paint geometry fallbacks after construction errors and clears stale renderer results after worker rejection. Deleted path references are excluded from current object membership. The current fixture had two deleted chest-decoration paths whose orphan style records incorrectly blocked export; unmatched styles are now diagnostics, never geometry or export errors. Source-bound style matching preserves unambiguous boundary styles through large shape changes, while partition overlaps still detect colour/height conflicts.

## Validation — 2026-09-12

- `npm run build` and `npx tsc --noEmit`: passed.
- `test-live-surfaces.mjs`: 21 checks, including imported/flat/new/partitioned/converted faces, multiple holes, outside and complete cuts, live edits, deleting sources, invalid geometry without snapshot fallback, local-property isolation, compiled geometry and mesh volume.
- Existing `test-creation.mjs`, `test-region-isolation.mjs` and `test-swatch-delete.mjs`: passed.
- Final production browser: `test-live-surfaces-browser.cjs` (8), `test-creation-selection.cjs` (21), `test-creation-drag.cjs` (9), `test-selection-scope-browser.cjs` (13): **51 checks passed**. These use real clicks, role buttons, node drags, Delete, undo/redo and browser autosave/reload. The selection-scope suite uses the frozen 73-path fixture; the new suite uses the latest 74-path artwork.
- Latest artwork: frame area changed from 4569.93713051 to 4501.50595575 mm²; overlap with the hole is zero, one actual interior hole, height stays 0.45 mm. Full compiled solid: one component, 19,458 triangles, zero invalid edges/zero-area triangles, valid mesh.
- Visual inspection: full flat artwork, 3D relief and named region controls at 1440 × 1000 and 1100 × 820. At the compact size the region-list width and scroll width both equal 281 px. Region names fit inside the independently scrolling inspector.
- A long-name fixture wraps inside a 279 px region button without overflow; the inspector's action menu keeps a single-line caption. Invalid-hole inspection confirms the frame disappears, the source stays editable and the error describes the unclosed hole directly. The final stylesheet and error wording were rebuilt and visually checked after functional regression.
- Actual browser SVG export contains two contours with the even-odd fill rule for the frame. `Sandrone-live-surfaces.svg` is an exported test artifact.

Test artifacts are in `../../../outputs/frame-hole-repair/`, including a frozen input copy and `frame-hole-flat.png`, `frame-hole-3d.png`, `named-region-compact.png`. Browser tests use an isolated context and never bind the user's project file. The working artwork file is not rewritten by this fix; opening it recomputes the corrected faces.
