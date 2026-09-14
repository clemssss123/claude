# Keyframe Studio

A browser-based 2D motion graphics compositor modeled on Adobe After Effects.
TypeScript + React, no 3D. Built in phases; this repository is at **phase 2**.

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

**Composition viewer** — Canvas2D render of solids and text with per-layer blend
modes, resolution (full/half/quarter), transparency grid, selection box with
scale handles, anchor-point marker, motion path for animated position, and
direct manipulation: move, scale from handles, rotate (W), pan-behind (Y), hand
(H), zoom (Z). Shift constrains.

**Timeline** — layer stack with label colours, eye/solo/lock/shy/motion-blur
switches, blend mode and parent pickers, twirl-down property rows with
scrubbable values, stopwatches, keyframe navigators, and a separate-dimensions
toggle on Position. The track area is
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
(`src/input/shortcuts.ts`). 77 of 91 bindings are live; the rest are registered
against their real AE chord and shown greyed out with the phase that implements
them. Press **F1** for the list. Double-tap chords (UU/MM/EE) are handled.

## What is not built yet

Phases 3–7 from the plan: masks and shape layers, text animators (text bounds
are currently estimated from font metrics rather than measured), track mattes,
adjustment-layer rendering, the effect engine and its 50–100 effects, motion
blur rendering (settings are stored and editable now), expressions, precomps,
time remapping, and WebCodecs export. Anything in the UI that is not yet real
says so rather than pretending.

## Layout

```
src/core/     document model, interpolation, easings, motion paths — no React
src/render/   Canvas2D compositor, blend modes, hit testing
src/state/    zustand store, undo history, playback transport
src/input/    After Effects keymap and the global key handler
src/ui/       panels, dialogs and shared controls
```

The renderer is deliberately behind a small surface (`renderComposition`) so
phase 4 can swap in the WebGL2 pass pipeline that effects and motion blur need
without the document model or UI changing.
