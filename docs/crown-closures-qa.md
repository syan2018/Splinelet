# Crown closure repair — 2026-09-12

## QA inventory

- Reproduce the reported clipped-coordinate intersection with a new divider identity, so passing does not depend on detecting a redundant band edge.
- Switch 头饰环5下 to 分区 in the UI: preserve the existing 14 crown surfaces and their local properties; explain that this edge already belongs to a band.
- Locate 头饰嵌线 61, inspect both diagonal caps, choose 沿头饰大形, and inspect the projected cap routes at high zoom.
- Switch the mode back and use Ctrl+Z: recover the exact prior geometry in one history entry.
- Disable and restore this band: source paths and all other features remain available.
- Reject distant or unrelated parent contours without saving a failed construction; the distant outer frame option is disabled in the UI.
- Reload the project and edit a source control handle: calculate caps, preview and compiled geometry from the current sources.
- Inspect the repaired whole crown in colour and 3D; check a connected, watertight printable solid.
- Check closure selector layout at the normal and narrower inspector sizes, including the long contour label.

## Construction rules

The noder now applies its precision grid to input vertices as well as newly
computed intersections. This removes the mixed-precision T-junction reported
at (12.088153783…, 30.140659037…). Geometry validation remains enabled.

An active `between` recipe already provides two band edges. Marking one of
these edges as a divider does not implicitly flatten the overlapping legacy
extrusions into a single new colour graph. A separate new divider continues
through the normal partition evaluator.

Closure choices are derived from the actual clipping recipe ancestry. The user
explicitly chooses straight caps or an existing parent contour. The UI limits
the endpoint gap to 0.15 mm, with the current gap displayed; the API accepts an
explicit bounded `joinMM`. The command evaluates the complete clipped feature
before creating a history entry. Neither source anchors nor handles are moved.
Only the recipe reference is stored; the boundary route is calculated afresh.

## Fixture and repair

Input: `outputs/crown-closure-repair/Sandrone-new.source.bezier.json`, frozen
from the workspace copy. `scripts/repair-crown-closures.mjs` repairs the four
remaining straight bands after checking an unambiguous nearby parent contour.
It preserves paths, creation metadata, feature colours/heights and every
unrelated surface, and validates the complete printable mesh before writing.
`--write` creates a backup and checks for concurrent file changes before an
atomic replacement. The central band's existing contour recipe is retained.

## Checks

Pure regressions: `test-crown-closures.mjs`, `test-model.mjs`,
`test-creation.mjs`, `test-live-surfaces.mjs`, `test-region-isolation.mjs`.
Browser checks and screenshots are recorded in the workspace output folder.

Results: all five pure regression scripts passed, including six new numerical
and closure checks; production build and TypeScript checks passed. Nine real
browser checks passed. Visual inspection covered the enlarged reference,
colour-only band, full 3D model, close-up crown and a 260 px sidebar (232 px
selector, no horizontal overflow). Right-button panning and zoom worked in 3D.
The complete repaired model has 19,462 triangles, one connected component,
zero invalid edges and zero zero-area triangles. No browser page errors.

Visual QA also exposed SVG's default black fill on the open diagnostic path;
the cap overlay now explicitly uses `fill="none"`. Keyboard QA exposed document
undo being swallowed when a select menu retained focus. Selects now allow
Ctrl/Cmd+Z and redo, while text fields keep their native editing shortcuts.

Workspace file updated with four contour references; the pre-existing central
contour reference remains unchanged. A before-repair copy is in the adjacent
`backups` directory. The user's original source paths remain byte-for-byte
equivalent as JSON data, with all 559 cubic segments retained.
