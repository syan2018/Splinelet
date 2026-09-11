# Unified creation acceptance

Functional and visual checks use an isolated Playwright context. Original Sandrone files are read only.

Camera regression inventory: real right-drag pan, left-drag orbit, middle-drag and wheel zoom, Space-drag pan, release outside the canvas, repeated gestures after remount, palette clicks and region selection. Check rendered pixel changes, stationary frames after release, and unchanged source project / flat view. Visually inspect Sandrone at desktop and narrow widths.

Camera fix: reproduced unchanged rendered pixels on right drag; the canvas received pointer movement but document did not. Removed the wrapper's move/up propagation stop so Three's document listeners receive both dragging and release. `scripts/test-creation-camera.cjs` passes 17 rendered-view and interaction checks on the Sandrone copy, including project and flat-view nonmutation.

| User workflow                             | Check / evidence                                                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draw a closed source and click to fill    | Real pointer drawing, source anchor count unchanged, candidate hover, filled state                                                                       |
| One object contains several colour blocks | Draw/select divider, local paint, object tree remains one item, local height                                                                             |
| Shared project colours                    | Palette selects brush, colour edit updates references, local override stays local                                                                        |
| Editing and topology                      | Split inherits; merge of different styles shows stripe conflict; local resolution leaves other regions intact                                            |
| Undo and cancel                           | Swept paint is one undo; height drag commit once; Esc/blur restores draft; gap preview cancel                                                            |
| Selection and tree                        | Plain/Ctrl/Shift, empty deselection, arrows alone expand, double-click rename, multi drag reorder, path ownership drag                                   |
| Same object in flat and 3D                | Selection and palette preserved; exact height input, preview visible, no extra creation step                                                             |
| Source editor                             | Existing node drag, modifiers, continuity and source properties remain accessible                                                                        |
| Persistence                               | New project schema restores objects, swatches, painted footprints and dependencies after reload                                                          |
| Manufacturing                             | Real JSTS/Manifold calculation, same result as legacy Sandrone before changes, SVG and Blender export include expected content, STL closed and connected |
| Layout and motion                         | Desktop dense Sandrone, 760 px narrow window, small screen, reduce-motion; no clipping of canvas, tree, palette or primary tools                         |
| Exploration                               | Quick tool changes mid gesture; source edit during candidate refresh rejects stale action; imported missing references are visible errors                |

Automation: `node scripts/test-creation.mjs` and browser acceptance. Existing geometry and persistence regression remains required.

## Completed 2026-09-11

- Real pointer drawing produced four cubic sides, then a two-anchor divider. Filled regions remained inside one named object.
- Browser acceptance passed 17 assertions including real three-format downloads and IDB reload. The script now creates its own fixture; run only in an isolated context.
- Additional UI checks passed: name click does not expand, double-click rename, source-less base in Ctrl selection, multiple object reorder, multiple source path ownership drag and one undo, sidebar resize/reset, number Escape, blank deselection, shared palette edit/undo, stale API revision rejection.
- Visual QA: 1440 × 1000, 760 × 900 and 390 × 844, plus reduced motion. Fixed inherited double height subtraction in small windows, an invisible save button, coplanar preview flicker, and 3D framing when aspect ratio changes.
- Real Sandrone copy: 71 source paths / 547 cubic spans unchanged. 11 hair split regions converted to live internal partitioning; one strand recoloured and set to 1.5 mm. Final 18,466 triangles, one connected component, zero invalid edges / degenerate faces, approximately 16,237.0 mm³.
- Blender 4.5.3 opened the actual downloaded Python script; saved `.blend`. Source Bézier coordinate error below 0.000003 mm. Blender and actual STL both have 18,466 triangles, no non-manifold edges, no degenerate faces.
- Original desktop Sandrone SHA-256: `53567FFB65485A32ADB0872A17D268A97880FDD8FCDDBD8509E854165EBE28D7`.
- Production build: loaded Sandrone, actual Worker/WASM solid check returned the same 18,466-triangle valid result; no browser page errors. A delayed startup-example response exposed an import race; guarded restoration against intervening edits and verified with `scripts/test-restore-race.cjs` in a fresh browser context.

Known scope: source anchors are exact; derived faces are sampled at configured precision. Coloured 3D view shows independent extrusions, while export performs actual solid booleans. STL has no colours, Blender final solid has one material, multicolour 3MF is not implemented. Existing advanced constructions with incompatible heights/dependencies remain in advanced tools. Strict repository lint was already dirty and is not claimed as passing.
