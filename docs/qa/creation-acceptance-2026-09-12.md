# Unified creation acceptance

> Status: historical QA snapshot from 2026-09-12. Current behavior is documented in [统一创作](../../CREATION.md); local `outputs/` evidence mentioned below is not stored in this repository.

Functional and visual checks use an isolated Playwright context. Original Sandrone files are read only.

September 12 repair inventory: reference/overlay/colour all allow face selection in V; source clicks and face clicks retain their distinct semantic selection; object/path/cell selection reveals the corresponding tree row; names never expand on click; source and object Ctrl/Shift selection; blank/Escape clears; outliner offscreen targets are framed, F explicitly frames; high-zoom path/face/node dragging, Space/middle panning and release outside; paint and 3D gestures remain intact. Geometry checks use the frozen `outputs/interaction-repair/Sandrone-new.source.bezier.json`: cup's existing divider roles must affect legacy recipes, missing joins have actionable diagnostics, ornament synthetic closures are identifiable and removable without rewriting source anchors. Preview cancel, applied connection removal/undo, changed topology, read-only selection and persistence are regression cases. Capture the real cup and head ornament as visual evidence; use a fresh isolated browser fixture for repeated selection tests.

Reference display inventory: default reference image without region fills; trace/node tools return to reference; explicit overlay/full colour controls; selected source remains visible when other lines are hidden; reference mode does not intercept source editing; palette/selection alone never paint. Verify Path 69 (3 anchors, 2 open cubic spans at the upper-right ornament), unchanged project across display switches, and drawing over a filled part with only explicit new anchors. Explore return from 3D to source editing and compact-window display controls.

Reference fix verified by `scripts/tests/browser/test-creation-reference.cjs`: explicit three-mode display, original image visible during source editing, selected open Path 69 visible even with other lines hidden, no incidental painting on palette/selection, two real Alt-clicks over the cup produce exactly one cubic, full undo restores original project. Path 69 remains the original upper-right ornament inner edge, not deleted or converted to a face.

Camera regression inventory: real right-drag pan, left-drag orbit, middle-drag and wheel zoom, Space-drag pan, release outside the canvas, repeated gestures after remount, palette clicks and region selection. Check rendered pixel changes, stationary frames after release, and unchanged source project / flat view. Visually inspect Sandrone at desktop and narrow widths.

Camera fix: reproduced unchanged rendered pixels on right drag; the canvas received pointer movement but document did not. Removed the wrapper's move/up propagation stop so Three's document listeners receive both dragging and release. `scripts/tests/browser/test-creation-camera.cjs` passes 17 rendered-view and interaction checks on the Sandrone copy, including project and flat-view nonmutation.

| User workflow                             | Check / evidence                                                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draw a closed source and click to fill    | Real pointer drawing, source anchor count unchanged, candidate hover, filled state                                                                       |
| One object contains several colour blocks | Draw/select divider, local paint, object tree remains one item, local height                                                                             |
| Shared project colours                    | Palette selects brush, colour edit updates references, local override stays local                                                                        |
| Editing and topology                      | At this snapshot, split inherited styles and mixed-style merges showed a stripe conflict; current builds no longer generate that conflict stripe         |
| Undo and cancel                           | Swept paint is one undo; height drag commit once; Esc/blur restores draft; gap preview cancel                                                            |
| Selection and tree                        | Plain/Ctrl/Shift, empty deselection, arrows alone expand, double-click rename, multi drag reorder, path ownership drag                                   |
| Same object in flat and 3D                | Selection and palette preserved; exact height input, preview visible, no extra creation step                                                             |
| Source editor                             | Existing node drag, modifiers, continuity and source properties remain accessible                                                                        |
| Persistence                               | New project schema restores objects, swatches, painted footprints and dependencies after reload                                                          |
| Manufacturing                             | Real JSTS/Manifold calculation, same result as legacy Sandrone before changes, SVG and Blender export include expected content, STL closed and connected |
| Layout and motion                         | Desktop dense Sandrone, 760 px narrow window, small screen, reduce-motion; no clipping of canvas, tree, palette or primary tools                         |
| Exploration                               | Quick tool changes mid gesture; source edit during candidate refresh rejects stale action; imported missing references are visible errors                |

Automation: `node scripts/tests/unit/test-creation.mjs` and browser acceptance. Existing geometry and persistence regression remains required.

## Completed 2026-09-11

- Real pointer drawing produced four cubic sides, then a two-anchor divider. Filled regions remained inside one named object.
- Browser acceptance passed 17 assertions including real three-format downloads and IDB reload. The script now creates its own fixture; run only in an isolated context.
- Additional UI checks passed: name click does not expand, double-click rename, source-less base in Ctrl selection, multiple object reorder, multiple source path ownership drag and one undo, sidebar resize/reset, number Escape, blank deselection, shared palette edit/undo, stale API revision rejection.
- Visual QA: 1440 × 1000, 760 × 900 and 390 × 844, plus reduced motion. Fixed inherited double height subtraction in small windows, an invisible save button, coplanar preview flicker, and 3D framing when aspect ratio changes.
- Real Sandrone copy: 71 source paths / 547 cubic spans unchanged. 11 hair split regions converted to live internal partitioning; one strand recoloured and set to 1.5 mm. Final 18,466 triangles, one connected component, zero invalid edges / degenerate faces, approximately 16,237.0 mm³.
- Blender 4.5.3 opened the actual downloaded Python script; saved `.blend`. Source Bézier coordinate error below 0.000003 mm. Blender and actual STL both have 18,466 triangles, no non-manifold edges, no degenerate faces.
- Original desktop Sandrone SHA-256: `53567FFB65485A32ADB0872A17D268A97880FDD8FCDDBD8509E854165EBE28D7`.
- Production build: loaded Sandrone, actual Worker/WASM solid check returned the same 18,466-triangle valid result; no browser page errors. A delayed startup-example response exposed an import race; guarded restoration against intervening edits and verified with `scripts/tests/browser/test-restore-race.cjs` in a fresh browser context.

Known scope at the time: source anchors are exact; derived faces are sampled at configured precision. Coloured 3D view shows independent extrusions, while export performs actual solid booleans. STL has no colours and the Blender final solid has one material. Multicolour 3MF was not implemented in this snapshot; current builds support it. Existing advanced constructions with incompatible heights/dependencies remain in advanced tools. Strict repository lint was already dirty and is not claimed as passing.

## Completed 2026-09-12

- `test-creation-selection.cjs`: 21 checks of face/source/object selection, reference mode hit testing, tree disclosure/reveal, Ctrl/Shift ranges and clear. The fixture imports through the file input and selections leave the project unchanged.
- `test-creation-drag.cjs`: source and face dragging at about 381%, exact pixel-to-document displacement, one-step undo, Escape rollback, and Space/middle pan over portal faces with release into the sidebar. Additional real-input checks verified node movement at 626%, multi-object reorder and two source paths moved together into another object, with full undo.
- Previous browser suites passed again: 17 creation/manufacturing checks, 17 rendered 3D camera checks, 14 reference/source tracing checks. No page errors. `tsc`, geometry/model regressions and `npm run build` pass. The Sites build helper still hits its Windows npm path issue; the app's normal build succeeds.
- Frozen new-project input: `outputs/interaction-repair/Sandrone-new.source.bezier.json`, SHA-256 `EB4069333EF8FC832AF6A4099EB1682A919977DA63450146C74300A23E071778`. Only experiment copies were changed. Both output variants preserve all 71 source paths / 547 cubic spans.
- Cup: four endpoint gaps of 0.020–0.075 mm; preview/cancel are read-only; applying 0.08–0.1 mm gap closure yields 7 painted cells from 5. Original union area is preserved. Painting the automatically partitioned cells retains their 2 mm base height after JSON reload; removed dividers retain saved styles or expose an explicit merge conflict.
- Ornament: the two screenshot diagonals belong to the legacy `between` feature `body-band-64` (display name 头饰嵌线 65), not source Béziers. Locate shows both closures; cancel disables the corresponding face while keeping both source paths, restore and Ctrl+Z work. The default repaired copy keeps this face; a separate cancellation experiment disables it.
- Production Wrangler preview loaded the actual cancellation experiment and evaluated 7 cup cells / 2 disabled closure edges, no geometry or browser errors. Actual solid: 18,156 triangles, 1 component, 0 invalid edges, 0 degenerate faces, volume 15,995.203 mm³. Verified desktop and 820 px layout. Stopped only the temporary production server; the user's port 3000 dev server remains running.
