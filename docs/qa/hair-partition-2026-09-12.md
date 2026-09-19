# Hair partition repair

> Status: historical QA snapshot from 2026-09-12. Referenced local output artifacts are not stored in this repository.

Coverage before signoff:

- Latest Sandrone copy with the new `头发分割线`: no non-noded intersection; new regions exist, remain individually selectable and inherit their parent colour, height and bottom. Adding a divider must not accidentally join previously separate regions.
- Every source anchor, handle and cubic stays exactly unchanged. Test save/reload and the actual printable solid; preserve the seven cup regions and repaired central crown.
- Role selection computes first. A failed boundary/hole operation must leave the document and undo history untouched and explain the failure beside the selected line.
- A saved project with invalid partitioning retains its saved colour footprints for display, clearly marked as needing attention. It cannot be painted or exported as if calculation succeeded. Locate, guide-role recovery and retry stay in the unified workspace.
- Real pointer selection on both sides of the new divider, local colour/height, undo, node move/recompute, zoom and 3D camera regression.
- Visual checks: full artwork and zoomed hair region; error panel and successful partition feedback at desktop and compact sidebar sizes. Raw geometry diagnostics are collapsed by default.

## Result — 2026-09-12

Reproduced against `outputs/Sandrone-unified-creation/Sandrone-new.bezier.json`, SHA-256 `24cc1661406a93e701ce8244159e995cb7b40cba48b556727b7dfdff7eb7fcde`. That file is unchanged. It contains 72 paths / 548 cubic spans, including `头发分割线` (`c80a7c16-7975-4cd7-b966-9cc6e18a55d4`). The compact, raster-free `scripts/tests/fixtures/hair-partition.json` retains the relevant exact source coordinates and previous paints so the numerical regression runs on clean checkouts.

Two causes were verified: machine-epsilon segments left by floating-point intersection calculation, and an old divider switching its nearest target to the new divider. Graph construction now nodes intersections on a fixed derived grid before polygonizing. Ordered `dividerGraphCohorts` preserve which earlier divider networks each endpoint may attach to. Existing documents infer the first cohort from their saved paint topology; role changes, drawing, path transfer and painting retain this metadata. Source anchors and handles are untouched.

The previous 154.168012416 mm² region splits into 25.291256204 and 128.876756212 mm² children. Both inherit its colour and 2.55 mm thickness. The complete hair object has 16 regions (12 partitioned cells and four retained legacy features); cup and crown retain seven and fourteen regions respectively. Colour and height changes do not change these geometries. A second, closer divider also leaves the first divider's endpoint connections intact.

Validation passed:

- `npm run build`, `npx tsc --noEmit`.
- `test-model.mjs`, `test-creation.mjs`, `test-persistence.mjs`, `test-creation-pick.mjs`, `test-node-edit.mjs`.
- 76 real browser checks on the production build in an isolated Chrome context: `test-hair-partition-browser.cjs` (8), `test-partition-feedback.cjs` (5), `test-creation-selection.cjs` (21), `test-creation-drag.cjs` (9), `test-region-properties.cjs` (7), `test-creation-pick-browser.cjs` (9), `test-creation-camera.cjs` (17). No page errors. The user's browser and port 3000 process were left intact.
- Real worker export for the complete original project: one connected valid solid, 18,724 triangles, zero invalid edges, zero zero-area triangles. Existing manufacturing cleanup removes two collapsed triangles and revalidates the result; it does not alter source curves.
- SVG and Blender Python export generated from the complete project. Blender was not launched as part of this check.
- Visual review at 1440×1000 and 1100×820; the 320 px properties panel has no horizontal overflow. New region selection, local colour/height, actual control-handle dragging, undo, reload and 3D camera gestures all work. Error details stay collapsed and recovery remains in the unified editor.

Screenshots and export samples are in `outputs/hair-partition-repair/`, outside the source repository. The original project file did not need repair or replacement; reopening it with the fixed application recomputes the regions.
