# Endpoint continuation and spline inspectors

> Status: historical QA snapshot from 2026-09-12. Referenced local output artifacts are not stored in this repository.

QA inventory:

- Continue an existing open path from either end without changing old cubics, handles, node modes, identity, group or creation role; exactly one new cubic and one new node per click.
- Switching endpoints or starting/cancelling continuation changes no project data or undo history. Preview, Alt direct connection, Shift no-snap, L fallback, opposite-endpoint closure and C follow the active endpoint.
- One-step undo/redo, close → undo → continue, cancelling before a click, one-node paths, closed paths, hidden paths, switching tools and switching selected paths remain coherent.
- Path inspector: selected path identity/count, primary node edit and two continuation actions, secondary grouping, deletion and confirmed refitting. Node inspector: endpoint-only resume/merge, internal continuity, explicit adjacent-segment operations, multi-node operations, handle selection and deselection.
- Real clicks, endpoint double-click, E shortcut, canvas endpoint controls, menu expansion/collapse and 320 px sidebar visual inspection. Check high zoom and boundaries near viewport edges.
- Agent API exposes continuation direction and uses the same geometry operations as the UI.

## Project colours

- Delete an unused palette entry directly; deleting a referenced entry requires a replacement colour. Cancel and Escape leave the document unchanged.
- Replace object defaults, painted cells and legacy feature colours together in one undo step, preserving source curves, region geometry and heights.
- Keep at least one colour. New paths use the first remaining palette entry, including after deleting the original `cream` colour.
- Verify real browser autosave and reload after replacement, plus undo and redo.

## Results — 2026-09-12

Production build and TypeScript checks passed. The following browser suites passed against the final production build (54 checks total):

| Suite                              | Checks | Coverage                                                                                                                             |
| ---------------------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------ |
| `test-spline-endpoints.cjs`        |      8 | Head/tail extension, switching ends, closure, undo/redo, double-click and E, adjacent-span actions, real image fitting and agent API |
| `test-swatch-delete-browser.cjs`   |      3 | Unused deletion, replacement dialog cancellation, used replacement with undo/redo and autosave/reload                                |
| `test-creation-selection.cjs`      |     21 | Existing source/region selection interactions                                                                                        |
| `test-creation-drag.cjs`           |      9 | Existing path/node dragging interactions                                                                                             |
| `test-selection-scope-browser.cjs` |     13 | Full 73-path Sandrone fixture, node multiselection and dragging, local shoulder isolation, autosave/reload and valid solid           |

Pure geometry/command suites passed: `test-extend.mjs`, `test-swatch-delete.mjs`, `test-node-edit.mjs` (18 checks), `test-connect.mjs`, `test-creation.mjs` and `test-region-isolation.mjs`.

Additional real-input check on the full artwork: opened Path actions → Refit, verified the confirmation changed no geometry, cancelled, deleted the selected hair divider through the menu and restored the entire document with one undo. No browser page errors were recorded.

Visual inspection used the user's full 73-path artwork in an isolated browser at 1440 × 1000 and 1100 × 820, with a 320 px inspector and enlarged canvas. The primary endpoint actions remain visible above construction settings; secondary menus scroll. The replacement-colour dialog fits the compact viewport. Screenshots are in `../../../outputs/spline-endpoint-qa/`:

- `path-endpoints.png`
- `endpoint-node-actions.png`
- `endpoint-node-compact.png`
- `head-continuation.png`
- `delete-used-color.png`

The original project files were not modified. After the final full-artwork interactions, the 73 source paths were identical to the frozen input fixture.
