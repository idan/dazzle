# web/ — pixel64 cloud + scene editor

SvelteKit (Svelte 5) on Cloudflare, tooled with Bun. Currently this is a **spike**
of the **procedural scene editor / simulator** described in [`/docs/scenes`](../docs/scenes).

**Authoring a scene?** See the [authoring guide](../docs/scenes/authoring.md) — the
language reference and how it diverges from GLSL.

## Run

```sh
bun install
bun run dev        # http://localhost:5173
```

Other scripts: `bun run check` (svelte-check + types), `bun run build`, `bun run preview`.

## What's here (the scene-editor spike)

A text buffer next to a live 64×64 simulator: edit a GLSL-flavored shader, see it
render and animate on a simulated panel.

```
src/lib/scene/        the engine
  lexer.ts            tokenizer
  parser.ts           recursive-descent parser → AST
  ast.ts              AST node types
  interpreter.ts      tree-walking evaluator — TS reference renderer / parity check
  builtins.ts         prelude: math, trig, geometry, IQ palette, value noise, fbm
  renderer.ts         TS frame loop → premultiplied RGBA buffer
  emit.ts             bytecode compiler: AST → VM bytecode (vectors → scalar ops)
  opcodes.ts          opcode numbering (mirrors renderer/src/vm.rs)
  wasm-renderer.ts    binding to the Rust→WASM renderer (the real renderer)
  examples.ts         starter scenes
  index.ts            public API: compile(src), renderFrame(...)
  editor-lang.ts      CodeMirror language: syntax highlighting + inline error linter
  cost.ts             static opcode/pixel estimator vs. the device budget
src/lib/components/
  CodeEditor.svelte   CodeMirror 6 editor (highlighting, line numbers, lint markers)
  Preview.svelte      canvas + animation clock (nearest-neighbor upscale)
  UniformControls.svelte  type-driven controls for uniforms
  CostBadge.svelte    "≈ N ops/px" budget badge with breakdown tooltip
  ui/                 bits-ui wrappers (Select, Slider, Checkbox) styled with Tailwind
src/routes/+page.svelte   editor + simulator + transport UI

**Styling:** Tailwind CSS v4 (`@tailwindcss/vite`, theme in `src/app.css`).
**Components:** [bits-ui](https://bits-ui.com) headless primitives, wrapped in `lib/components/ui`.
**Renderer:** the Rust crate in [`../renderer`](../renderer) compiled to WASM. The editor's
`renderer` toggle picks **WASM** (the real renderer) or **TS** (the reference interpreter), and
shows their live per-frame max diff — currently **Δ0/255** on all examples. Build the wasm with
`bun run build:wasm` (needs Rust + `wasm-pack`).
```

### How it maps to the architecture docs

This honors the parts of the design that matter for **authoring**:

- the language surface of [`shader-language.md`](../docs/scenes/shader-language.md)
  (`frame {}` / `pixel {}` blocks, `float`/`vec2..4`/`bool`, swizzles, the prelude builtins),
- the **per-frame / per-pixel split** and built-in variables `t`/`frame`/`res`/`uv`/`st`/`xy`
  and premultiplied `vec4 color` output ([`shader-vm.md`](../docs/scenes/shader-vm.md)),
- per-layer `eval_res` with nearest-neighbor upscale, composite-over-black
  ([`layers-and-compositing.md`](../docs/scenes/layers-and-compositing.md)),
- uniforms as the live-input surface ([`inputs-and-binding.md`](../docs/scenes/inputs-and-binding.md)),
  exercised by the editor's input sliders.

### Deliberate shortcuts (so we could iterate fast)

These diverge from the locked design and are the obvious next steps:

- **The TS path is now a *reference*, not the renderer.** The real renderer is the shared
  Rust crate compiled to WASM ([`../renderer`](../renderer)); the bytecode compiler
  (`emit.ts`) feeds it. The TS tree-walking interpreter remains as the parity oracle and
  as a fallback for any construct the bytecode path doesn't support yet.
- **The TS interpreter is dynamically typed** (vectors are JS arrays); only `emit.ts` does
  real vector→scalar lowering. The editor's `cost.ts` opcode/pixel estimate is still a
  heuristic, not derived from the emitted bytecode.
- **Noise now uses the spec'd integer bit-mix hash** in both Rust and TS — parity-faithful
  (Δ0 across examples).
- **`sin`/`cos` use `libm`, not yet the device LUT**; no gamma/quantization at output
  (preview shows authored 0..1 directly).
- **Single shader layer only** — no multi-layer compositor, blend modes, image/animation/text
  layers, scene manifest/bundle, or transport. This is just the procedural-layer authoring loop.
- **wasm artifacts aren't committed** (wasm-pack gitignores its output) — run
  `bun run build:wasm` after checkout.

## Cloudflare

Scaffolded with `@sveltejs/adapter-cloudflare` (Workers). `wrangler.jsonc` is present;
nothing is deployed yet. Run `bun run gen` after editing `wrangler.jsonc` to refresh types.
