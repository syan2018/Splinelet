# Region selection and crown repair QA

> Status: historical QA snapshot from 2026-09-12. Referenced local output artifacts are not stored in this repository.

Coverage before signoff:

- Real Sandrone cup: select its smallest left/right rim regions at fit zoom. Verify exactly one active region, corresponding outliner entry, current colour in details. Select all, then click one; dragging preserves the multi-selection instead.
- Region details: choose a project colour, apply a custom HEX/picker colour, undo once. Inspect both flat and 3D output; compare every other region and all source curves. Draft cancellation, invalid input, mixed colours and changing selection before applying are negative cases.
- 3D: coplanar overlapping regions follow the displayed surface, holes reveal the lower surface, actual height wins over drawing order. Rotation, right-drag, Space/pan clicks and dragging away then returning must not select accidentally.
- Crown: central gold band follows its two existing source splines and the outer crown's curved lower boundary; retain the diamond hole. Review the enlarged 2D/3D result, update a source endpoint and verify live recomputation. No source anchors or cubics added.
- Preservation: cup remains seven regions; all other saved colours/heights and source paths remain intact. Validate compiled manifold, one connected component, save/reload; keep an exact original backup.
- Regression: source/node selection, outliner range, clearing, zoomed source/face dragging and existing 3D camera tests. Inspect 1440×1000 and 1120×800 layouts.

## Verified 2026-09-12

- Browser: 7 real-project region-property checks, 9 overlapping-surface/gesture checks, 21 selection checks, 9 drag checks, 17 camera checks and 14 reference/trace checks passed. Production region-property and overlapping-surface suites passed with no page errors. Native colour input was separately exercised; only `body-band-64` changed and one undo restored it.
- Real crown apex dragged in the browser: area changed from 30.503966891 to 29.833058824 mm², with no geometry errors; one undo restored the complete project. Both the enlarged 3D crown and the colour editor at 1120×800 were visually inspected. Single-region highlighting does not project all owner source lines as selected; object/source-only selection still reveals its lines.
- Model, creation, selection, node-edit, continuity, connection, gesture-coordinate and persistence suites passed; TypeScript and production build passed. Existing bundle-size and Manifold node-module externalization warnings remain.
- Saved file: `outputs/Sandrone-unified-creation/Sandrone-new.bezier.json` (outside the repository), SHA-256 `ba4f85300b435660807b58c32a279601ff1bf1d936a3f0aad8e70016ab13fcac`. Backup: `backups/Sandrone-new.before-crown-repair-2026-09-12T02-10-11-977Z.bezier.json`.
- File repair changes only the central band's parent-boundary recipe and removes its disabled-closure flag. All other evaluated regions, feature settings and all 71 source paths / 547 cubics are unchanged. Cup still has seven regions. Solid: 18,494 triangles, one component, zero invalid edges and zero degenerate faces; volume 16,003.866341 mm³.
- Boundary-following closure currently requires a single parent polygon without holes and endpoints within the explicit join limit. It keeps its source curves and the requested diamond subtraction; it does not refit or insert source nodes.
