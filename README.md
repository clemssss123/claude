# Keyframe Studio

A 2D motion graphics compositor modeled on Adobe After Effects, running either
as a desktop application or in a browser. TypeScript + React, no 3D. Built in
phases; this repository is at **phase 7**, the last one.

```bash
npm install
npm run dev        # browser:  http://localhost:5173
npm run desktop    # desktop:  build, then open the app in its own window
npm test           # core unit tests
npm run typecheck
npm run build
```

## The desktop app

The editor is the same code in both places; the desktop build wraps it in an
Electron window with no browser around it, and gives it native file dialogs —
Save writes back to the file it opened, and an export asks where to put itself
instead of landing in the downloads folder.

```bash
npm run dev:desktop   # dev server + desktop window, with hot reload
npm run dist:win      # Windows installer and portable .exe, into release/
npm run dist:linux    # AppImage
npm run dist:mac      # dmg
```

Each `dist:*` builds only for the platform it names and must run on that
platform. The **Desktop build** workflow in `.github/workflows/desktop.yml`
builds the Windows installers on GitHub's runners, so a Windows binary can be
downloaded from the Actions tab without a Windows machine to build it.

The window has no application menu on purpose: After Effects binds Ctrl+N,
Ctrl+O, Ctrl+W and Ctrl+M to editing commands, and a menu would take them
away from the editor. F12 opens developer tools, F5 reloads.

## What works today

**Document model** — `Project → Composition → Layer → Property → Keyframe`,
plain serializable data with no framework types in it (`src/core/`). Time is in
seconds throughout; frames exist only at the UI boundary.

**Keyframes and interpolation** — linear, bezier and hold using After Effects'
influence/speed handle model, plus Auto Bezier and Continuous Bezier tangent
linking and roving keyframes that redistribute their own time for constant
speed. Easy Ease (F9) produces AE's exact `(0.333, 0) / (0.667, 1)` curve.
Vectors share one normalized speed curve until you **separate dimensions**,
which splits Position into X and Y losslessly and merges back. Keyframes copy
and paste across properties and layers, shape-checked.

**Graph editor** (Shift+F3) — value and speed graphs with per-property
normalization so mixed units share one view, auto-zoom, fit, frame snapping,
box select, and draggable keyframes and bezier handles with a live
influence/speed readout. A vector's value graph is a dashed reference graph,
because its dimensions share one easing curve; its handles live on the speed
graph until the dimensions are separated — the same division AE makes.

**Easing library** — a Flow-style preset strip: 34 curves as clickable
thumbnails (Linear, the three Easy Eases, and In/Out/InOut for Sine, Quad,
Cubic, Quart, Quint, Expo, Circ and Back), plus a live cubic-bezier editor with
two draggable control points and numeric `x1,y1,x2,y2` fields. Applying a
preset solves for the influence/speed handles that reproduce that exact curve
on the selected segment. Elastic and Bounce cannot be one cubic bezier, so they
are marked *baked* and applied by sampling real keyframes across the segment
rather than faking it. Your own curves save to a named, reorderable preset
library kept in local storage.

**Transforms and motion paths** — anchor point, position, scale, rotation,
opacity; parenting composes transforms up the chain (opacity and blend modes
deliberately do not inherit) with cycle detection. Positional keyframes carry
spatial interpolation independently of their timing: auto-bezier tangents by
default, with handles you can drag on the path in the viewer. Progress along a
curved path is reparameterized by arc length, so an eased path still moves at
the speed the speed graph says it does.

**Masks** — bezier mask paths with all seven modes (none, add, subtract,
intersect, lighten, darken, difference), per-mask inversion, opacity, expansion
and separate horizontal/vertical feather. Draw one by dragging the rectangle or
ellipse tool over a selected layer, or click a path out with the pen (G);
vertices and their tangent handles are editable directly on the outline in the
viewer, and the path keyframes like any other property.

**Shape layers** — rectangle, ellipse, star and polygon paths plus free pen
paths, with fills, strokes (width, caps, joins, dashes) and the modifiers that
make shape layers worth having: Trim Paths, Repeater and Offset Paths, each
animatable. Groups nest and carry their own transform, including skew.

**Text** — real glyph measurement, and per-character animators with range
selectors: start/end/offset in percent or character index, six falloff shapes,
ease high/low, add and subtract modes, driving position, scale, rotation,
opacity, tracking and fill colour.

**Track mattes** — alpha, alpha inverted, luma and luma inverted, taking the
layer directly above as the matte and hiding it from the frame, as in AE.

**Motion blur** — per-layer and per-composition switches, shutter angle and
phase, samples per frame and an adaptive limit. Sub-frame samples across the
open shutter are accumulated and averaged, so a fast layer smears rather than
stepping. Content that cannot change within a frame is rendered once and only
its transform re-sampled, which keeps the common case affordable.

**Expressions** — JavaScript on any property, with After Effects' scope: bare
`time`, `value`, `index`, `thisComp`, `thisLayer`, `effect("…")("…")`,
`linear`/`ease`/`easeIn`/`easeOut`, `clamp`, `length`, `random`, `seedRandom`,
`noise`, `wiggle`, `loopIn`/`loopOut` (cycle, pingpong, offset, continue),
`valueAtTime`, `velocityAtTime`, and `toComp`/`fromComp`. Alt-click a stopwatch
to add one; it gets its own editable row in the timeline, and **EE** reveals
every expression on a layer.

Three guarantees hold: a property that refers to itself is caught rather than
hanging, the same property at the same time is evaluated once per frame, and a
broken expression reports its error in place and falls back to the keyframed
value — one bad line never blanks the composition.

**Pre-compositions** — nest a composition as a layer. **Ctrl+Shift+C**
pre-composes the selected layers into a new composition and leaves a pre-comp
layer in their place, pixel for pixel; double-click the layer to open its
source. Nesting is depth-guarded, and each nesting level gets its own render
buffers so an inner composition cannot disturb its parent.

**Time remapping** — **Ctrl+Alt+T** on a pre-comp layer creates a Time Remap
property mapping composition time to source time: keyframe it to hold, reverse
or re-time the nested composition.

**Adjustment layers** apply their effects to everything drawn beneath them,
confined by their own masks and composited at their own opacity and blend mode.
**Null objects** are invisible parenting controls that draw their own outline
and centre cross in the viewer and hit-test against their real box.

### Effects

An engine plus **82 effects** across twelve categories. An effect is a
definition — a name, a parameter schema and a render function — so adding one
means adding a file, not touching the engine (`src/render/effects/`).
Parameters become ordinary animatable properties, so every effect keyframes,
graphs, undoes and saves like anything else.

Effects run in the layer's own space, before the transform, exactly as in After
Effects: a blur is a blur of the source, not of the scaled result, and Motion
Tile tiles the layer rather than the frame. Effects that paint outside the
layer — blurs, glows, drop shadows — declare how much headroom they need and
the pipeline gives them a larger working buffer. Time effects re-render the
layer at other times through that same pipeline.

| Category | Effects |
| --- | --- |
| Blur & Sharpen (9) | Gaussian Blur, Fast Box Blur, Directional Blur, Radial Blur, Channel Blur, Camera Lens Blur, Bilateral Blur, Sharpen, Unsharp Mask |
| Color Correction (14) | Curves, Levels, Brightness & Contrast, Hue/Saturation, Exposure, Vibrance, Color Balance (HLS), Tint, Tritone, Photo Filter, Change to Color, Black & White, Colorama, Auto Contrast |
| Stylize (13) | Deep Glow, Twitch, Glow, Motion Tile, Mosaic, Find Edges, Vignette, Posterize, Threshold, Roughen Edges, Scatter, Cartoon, CC Kaleida |
| Distort (12) | Shake, Transform, Offset, Polar Coordinates, Wave Warp, Bulge, Twirl, Turbulent Displace, Displacement Map, Ripple, Corner Pin, Optics Compensation |
| Generate (9) | Fill, Gradient Ramp, 4-Color Gradient, Checkerboard, Grid, Cell Pattern, Lens Flare, Beam, Circle |
| Noise & Grain (6) | Fractal Noise, Noise, Noise HLS, Add Grain, Median, Dust & Scratches |
| Transition (5) | Linear Wipe, Radial Wipe, Venetian Blinds, Block Dissolve, Gradient Wipe |
| Keying (4) | Chroma Key (with spill suppression), Color Key, Luma Key, Extract |
| Channel (4) | Invert, Channel Mixer, Shift Channels, Minimax |
| Matte (2) | Simple Choker, Matte Choker |
| Perspective (2) | Drop Shadow, Bevel Alpha |
| Time (2) | Echo, Posterize Time |

Effect Controls lists them with their parameters, enable, reorder and delete;
**Ctrl+5** opens a searchable Effects & Presets browser. Curves gets an
interactive control: drag its five points and the plotted spline is the same
one the pixels are sampled through.

**Shake** drives the whole layer from layered noise — magnitude, frequency,
octaves, smoothness, separate position/rotation/scale amounts, per-axis locks
and a seed — for camera shake you did not have to keyframe. **Twitch** chops
the timeline into blocks and glitches each one differently: torn bands, a
whole-frame jolt, blur and an RGB split, held for a beat rather than
flickering every frame.

### Export and files

**Export** (Ctrl+M) renders the work area or the whole composition through the
same pipeline the viewer uses, at full, half or quarter size. Frames go to a
WebCodecs `VideoEncoder` and a muxer wraps them in **MP4** or **WebM**; a
**PNG sequence** in a zip is always available and needs no encoder at all. The
dialog names the codec it will actually use, because H.264 is a licensed codec
that some browsers ship without — where it is missing the MP4 falls back to
AV1 and says so, rather than silently producing something different from what
you asked for. Progress is shown per frame and the export can be cancelled.

**Files** — Save (Ctrl+S) writes back to the file you opened, Save As
(Ctrl+Shift+S) picks a new one. The desktop app does this through native
dialogs and a real path; in a browser it goes through the File System Access
API, and browsers without that API fall back to a download and a file picker. Separately the project is
snapshotted into IndexedDB every fifteen seconds, and a new session offers that
snapshot back rather than loading over your work.

**Footage import** (Ctrl+I, the Import button, or drop files on the Project
panel) brings in images and video. The Project panel lists what you imported
with a thumbnail, size and duration; double-click an item, or press its **+**,
to add it to the composition as a layer that starts at the composition's centre
and ends where the clip does. A still runs the whole composition.

The project file records what each item *is* — name, size, duration, format —
and the bytes live in the browser's storage beside the autosave, so project
files stay small and reopen with their media intact. Open a project on a
machine that does not hold those bytes and the item shows as **missing**, with
a Relink button that points it at the file again, the way After Effects does;
the layers using it keep their keyframes throughout.

Video seeking is asynchronous, so the two consumers treat it differently: the
viewer draws whichever frame is decoded and repaints when the seek lands, which
keeps scrubbing responsive, while export takes sole control of the videos and
waits for every seek before encoding its frame. Time Remapping works on footage
as well as pre-comps.

### Editor

**Composition viewer** — Canvas2D render with per-layer blend modes, masks,
effects and track mattes, resolution (full/half/quarter), transparency grid,
selection box with scale handles, anchor-point marker, motion path, and direct
manipulation: move, scale from handles, rotate (W), pan-behind (Y), hand (H),
zoom (Z), pen (G), rectangle and ellipse (Q). Shift constrains.

Layers that need no masking, effects or matting composite straight onto the
frame; anything else is built in a scratch buffer first, because a mask, an
effect or a matte has to change the layer's pixels before they meet the frame.

**Timeline** — layer stack with label colours, eye/solo/lock/shy/motion-blur
switches, blend mode, track matte and parent pickers, twirl-down property rows
with scrubbable values, stopwatches, keyframe navigators and a
separate-dimensions toggle on Position. The property tree nests properly: Text
animators, shape Contents, Masks, Effects, Time Remap and Transform, each with
the controls that belong to it. The track area is canvas-drawn: ruler with
timecode, work area bar with draggable ends, layer bars you can slide and trim
from either edge, keyframes you can click, shift-click, marquee-select, drag
(frame-snapped) and right-click for interpolation. Keyframe glyphs differ by
interpolation type, as in AE.

**Transport** — real-time playback looping the work area, frame stepping,
keyframe navigation (J/K).

**Undo/redo** — every document edit is named and undoable; drags collapse into
a single history step.

**Dialogs** — Composition Settings, Keyframe Velocity (Ctrl+Shift+K), Keyframe
Interpolation (Ctrl+Alt+K), Effects & Presets (Ctrl+5) and the keymap (F1).

**Keyboard** — the After Effects keymap lives in one table
(`src/input/shortcuts.ts`). 100 of 101 bindings are live; the one that is not is
Reveal Audio Levels, because audio layers are not part of this build; it is
still registered against its real AE chord and shown as unavailable. Press
**F1** for the list. Double-tap chords (UU/MM/EE) are handled.

## What is not built yet

Audio: there are no audio layers, so Reveal Audio Levels and the audio-driven
effects (Audio Spectrum, Audio Waveform) do not exist.

Effects that read a *second layer* in After Effects — Displacement Map,
Gradient Wipe, Set Matte, Compound Blur — read the layer's own channels here
instead, which is how they are most often used; the layer picker they would
need is not built.

Collapse Transformations is stored on pre-comp layers so projects round-trip,
but the renderer still composites a nested composition as its own frame rather
than passing the inner layers through.

Imported video plays no sound: there are no audio layers, and a footage layer
is decoded for its frames only. Frame rate is not exposed to a browser, so an
imported clip is described at 30 fps; this affects the label, not the frames
that are drawn, which always come from the clip's own timeline.

Also unbuilt: variable-width mask feather (per-point feather geometry), Merge
Paths on shape layers, and keyframing of a text layer's source string. Offset
Paths uses a flattened-polyline offset rather than a true Minkowski offset,
which is accurate for the gentle offsets shape layers usually want but does not
remove self-intersections.

In expressions, a property reference evaluates to its value: vectors carry
`valueAtTime`, `velocityAtTime` and `numKeys`, but scalars come back as plain
numbers, so for those use the bare `valueAtTime(t)` of the property the
expression is on.

Anything in the UI that is not yet real says so rather than pretending.

## Layout

```
src/core/            document model, paths, shapes, text, interpolation,
                     easings, motion paths, expressions — no React, no DOM
src/render/          Canvas2D compositor: buffers, masks, mattes, hit testing
src/render/effects/  the effect registry and every built-in effect
src/state/           zustand store, undo history, playback transport
src/input/           After Effects keymap and the global key handler
src/ui/              panels, dialogs and shared controls
```

The renderer sits behind one surface (`renderComposition`), so a WebGL2 pass
pipeline could replace the Canvas2D one without the document model or the UI
changing.
