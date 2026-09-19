# Selection and local region editing

> Status: historical QA snapshot from 2026-09-12. Referenced local output artifacts are not stored in this repository.

QA inventory (2026-09-12):

- Reproduce the latest `右肩内` boundary and chest region 8. A local height/colour edit must preserve the seven sibling geometries, keys, colours, thicknesses, actual elevations and legacy model recipes; repeat and reload.
- A selected path is never an object property target. Inspector tab switches do not change selection. Transition from a closed path to its enclosed region is explicit and selects exactly that region; outliner face selection exits node editing.
- Plain clicks select one path, face or node. Ctrl/Shift multi-selection survives a drag but collapses to the clicked member on an unmoved plain click. Drag cancellation, Escape and blank-space clicks remain predictable.
- Active inspector identifies the line/region/object by name and states the scope. Object-only stacking controls never appear for local region or line selection. Bulk selection actions live in a menu, not a second pair of selection modes.
- Unpainted candidate status is explained; a selected candidate uses the same solid selection highlight as any other face. Enabling it by colour/thickness must not rebuild sibling regions.
- Explore repeated local edits, focus change with unfinished numeric input, node → face → line transitions, 2D/3D round-trips, undo and actual export. Verify desktop and 320 px sidebar appearance in a real browser.

## Root causes and changes

The new closed `右肩内` path produces chest region 8, but the old inspector treated path selection as whole-object scope. Separately, the first paint stored on a legacy object implicitly switched its construction mode: the seven existing feature regions were replaced and the new shoulder's `cell:0` key then referred to a different region. Either route could make a local action appear to change the whole chest.

- Property commands now require an explicit cell or object selection. Source paths projected for dragging are never property targets. The inspector distinguishes line, region and object scope; bulk selection is in a menu. Local regions have no whole-object position controls.
- Node and source gestures defer narrowing a selected multi-selection until an unmoved pointer release. An actual drag retains all selected members. Selecting a face in the outliner exits node mode; editing a face's source resolves its own boundaries.
- Partition construction has explicit persisted state. A local colour or thickness paint cannot trigger legacy conversion. Existing saved divider operations retain their construction state after their roles change.
- The candidate face is named after its closed boundary. Dashed status means pending activation, with an explanation and a direct activation button. Its default start plane follows the common physical bottom of the existing chest regions (2 mm), so it does not start inside the base plate. Existing placements and recipes are preserved.
- Numeric drafts and height gestures are scoped to the current semantic selection. Changing selection cannot apply an old draft to the newly selected region.

## Completed verification

Root performed the implementation, review and browser interaction checks. Testing used a separate Chromium context at `127.0.0.1:4173` against a production build. The user's `localhost:3000` browser and bound project file were not used for test mutations.

Production browser suites passed (89 checks in this turn):

| Suite                              | Checks |
| ---------------------------------- | -----: |
| `test-selection-scope-browser.cjs` |     13 |
| `test-creation-selection.cjs`      |     21 |
| `test-creation-drag.cjs`           |      9 |
| `test-region-properties.cjs`       |      7 |
| `test-creation-pick-browser.cjs`   |      9 |
| `test-creation-camera.cjs`         |     17 |
| `test-hair-partition-browser.cjs`  |      8 |
| `test-partition-feedback.cjs`      |      5 |

The final scope suite includes actual mouse/keyboard editing, one-step undo, browser autosave followed by a real page reload, and a real export-worker solid check. After adding the default support plane and activation button, the scope and hair suites were rerun. The camera test now compares pixels instead of PNG bytes: an idle WebGL edge was observed to alternate one antialiased pixel; the test tolerates at most four pixels or 0.001% of the canvas, while actual motion must change more than 20 pixels.

Pure regression scripts passed: `test-region-isolation.mjs`, `test-model.mjs`, `test-creation.mjs`, `test-node-edit.mjs` (18 checks), `test-selection.mjs`, `test-persistence.mjs`, `test-canvas-gestures.mjs`, and `test-creation-pick.mjs`. TypeScript and the production build passed.

The compact shoulder fixture retains the exact new boundary and legacy chest recipes. Repeated local height/colour edits assert deep equality for every sibling's geometry, identity, colour, thickness and physical placement, and for all source paths and model recipes. Comparing the full source against the previous Git engine also confirmed every other object's geometry, style and placement stayed identical (excluding newly added descriptive boundary metadata).

At 1440 × 1000 and 1100 × 820, the inspector identifies `右肩内 / 单个区域`; the 320 px sidebar has no horizontal overflow and its properties remain reachable by scrolling. Screenshots and export diagnostics are in `../../outputs/shoulder-region-repair/` relative to the repository. `single-region-selection.png` shows the candidate and activation action; `single-region-compact.png` shows the enabled local inspector. SVG and Blender Python exports were generated; Blender itself was not launched.

A separate local edit to 2.65 mm survived actual browser reload, with every sibling unchanged. Its export check reported one connected valid solid, 18,984 triangles, zero invalid edges and zero zero-area triangles. Existing export cleanup reported removal of two floating-point collapsed faces and 0.02 mm manufacturing cleanup; it did not alter source curves.

The source `../../outputs/Sandrone-unified-creation/Sandrone-new.bezier.json` remains unchanged: 73 paths, 553 cubics, SHA-256 `b3fd206b0716c701aadde6934577ddd58085718a1f2aa13b7bfce2faba8c8e81`. Tests use a frozen copy and do not replace this file with their temporary heights or colours.
