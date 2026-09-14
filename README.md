# Keyframe Studio

A browser-based 2D motion graphics compositor modeled on Adobe After Effects.
TypeScript + React, no 3D. Built in phases; this repository is at **phase 4**.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # core maths unit tests
npm run typecheck
npm run build
```

## What works today

**Document model** — `Project → Composition → Layer → Property → Keyframe`,
plain serializable data with no framework types in it (`src/core/`). Time is in
seconds throughout; frames exist only at the UI boundary.

**Keyframes and interpolation** — linear, bezier and hold, with After Effects'
influence/speed handle model. Easy Ease (F9) produces the exact
`(0.333, 0) / (0.667, 1)` curve AE does. Multi-dimensional properties share one
normalized speed curve, as AE does before dimensions are separated.

**Transforms** — anchor point, position, scale, rotation, opacity; parenting
composes transforms up the chain (opacity and blend modes deliberately do not
inherit) with cycle detection.

**Composition viewer** — Canvas2D render of solids, text and shape layers with
per-layer blend modes, masks and track mattes, resolution (full/half/quarter),
transparency grid, selection box with scale handles, anchor-point marker,
motion path for animated position, and direct manipulation: move, scale from
handles, rotate (W), pan-behind (Y), hand (H), zoom (Z), pen (G), rectangle and
ellipse (Q). Shift constrains.

Layers that need no masking or matting composite straight onto the frame;
anything else goes through a scratch buffer first, because a mask or a matte
has to change the layer's alpha before it meets the frame.

**Timeline** — layer stack with label colours, eye/solo/lock/shy/motion-blur
switches, blend mode and parent pickers, twirl-down property rows with
scrubbable values, stopwatches, keyframe navigators, a track-matte column, and
a separate-dimensions toggle on Position. The property tree nests properly:
Text animators, shape Contents, Masks and Transform, each with the controls
that belong to it — mask mode and inversion, animator property and selector
menus, shape item add and delete. The track area is
canvas-drawn: ruler with timecode, work area bar with draggable ends, layer
bars you can slide and trim from either edge, keyframes you can click,
shift-click, marquee-select, drag (frame-snapped) and right-click for
interpolation. Keyframe glyphs differ by interpolation type, as in AE.

**Transport** — real-time playback looping the work area, frame stepping,
keyframe navigation (J/K).

**Undo/redo** — every document edit is named and undoable; drags collapse into a
single history step.

Keyframe Velocity (Ctrl+Shift+K) and Keyframe Interpolation (Ctrl+Alt+K)
dialogs edit the same handles numerically.

**Keyboard** — the After Effects keymap lives in one table
(`src/input/shortcuts.ts`). 92 of 97 bindings are live; the rest are registered
against their real AE chord and shown greyed out with the phase that implements
them. Press **F1** for the list. Double-tap chords (UU/MM/EE) are handled.

## What is not built yet

Phases 5–7 from the plan: the remaining effects on the way to 50–100, motion
blur rendering (settings are stored and editable now), expressions, precomps,
time remapping, and WebCodecs export.

Within phase 3's areas, three things are deliberately not built: variable-width
mask feather (per-point feather geometry), Merge Paths on shape layers, and
keyframing of a text layer's source string. Offset Paths uses a flattened
polyline offset rather than a true Minkowski offset, which is accurate for the
gentle offsets shape layers usually want but does not remove
self-intersections. Anything in the UI that is not yet real says so rather than
pretending.

## Layout

```
src/core/     document model, paths, shapes, text, interpolation, easings,
              motion paths — no React, no DOM
src/render/   Canvas2D compositor: buffers, masks, mattes, hit testing
src/render/effects/  the effect registry and every built-in effect
src/state/    zustand store, undo history, playback transport
src/input/    After Effects keymap and the global key handler
src/ui/       panels, dialogs and shared controls
```

The renderer is deliberately behind a small surface (`renderComposition`) so
phase 4 can swap in the WebGL2 pass pipeline that effects and motion blur need
without the document model or UI changing.
