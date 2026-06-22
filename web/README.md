# web/ — pixel64 cloud + scene editor

The cloud backend + web UI: a **SvelteKit** app (Svelte 5) on **Cloudflare** (Workers adapter,
D1 + Drizzle), tooled with **Bun**, ESLint/Prettier, and Vitest. The main feature today is a
**spike of the procedural scene editor / simulator** described in [`/docs/scenes`](../docs/scenes);
it also hosts `improv-test/`, a zero-build Web Bluetooth provisioning client for the firmware.

**Authoring a scene?** See the [authoring guide](../docs/scenes/authoring.md) — the
language reference and how it diverges from GLSL.

## Run

```sh
bun install
bun run dev        # http://localhost:5173
```

Other scripts: `bun run check` (svelte-check + types), `bun run lint`, `bun run test`,
`bun run build`, `bun run preview`, `bun run build:wasm` (compile the Rust renderer to WASM —
needs Rust + `wasm-pack`), and `bun run db:*` (Drizzle/D1).

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
```

**Styling:** Tailwind CSS v4 (`@tailwindcss/vite`, theme in `src/app.css`).
**Components:** [bits-ui](https://bits-ui.com) headless primitives, wrapped in `lib/components/ui`.
**Renderer:** the Rust crate in [`../renderer`](../renderer) compiled to WASM. The editor's
`renderer` toggle picks **WASM** (the real renderer) or **TS** (the reference interpreter), and
shows their live per-frame max diff — currently **Δ0/255** on all examples. Build the wasm with
`bun run build:wasm`.

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
- **Noise uses the spec'd integer bit-mix hash** in both Rust and TS — parity-faithful
  (Δ0 across examples).
- **`sin`/`cos` use `libm`, not yet the device LUT**; no gamma/quantization at output
  (preview shows authored 0..1 directly).
- **Single shader layer only** — no multi-layer compositor, blend modes, image/animation/text
  layers, scene manifest/bundle, or transport. This is just the procedural-layer authoring loop.
- **wasm artifacts aren't committed** (wasm-pack gitignores its output) — run
  `bun run build:wasm` after checkout.

## `improv-test/` — Improv-over-BLE provisioning test client

A zero-build, self-contained Web Bluetooth page for exercising the firmware's Improv provisioning
without depending on `improv-wifi.com` (whose hosted SDK version/cache we don't control). It also
**A/B-tests the macOS write bug**: a checkbox switches the credential write between
`writeValueWithResponse()` (works everywhere) and `writeValueWithoutResponse()` (silently dropped by
Chrome on macOS — [improv-wifi/sdk-ble-js#213](https://github.com/improv-wifi/sdk-ble-js/issues/213),
fixed upstream in PR #217). See `firmware/docs/pico-port.md` for the full diagnosis.

### Run it

Web Bluetooth only works in a **secure context** — `http://localhost` or HTTPS — and only in
**Chrome/Edge** (desktop or Android; not Safari/iOS). Serve the folder over localhost:

```sh
bunx serve web/improv-test
# …or anything else that serves static files on localhost:
cd web/improv-test && python3 -m http.server 8000
```

Then open the printed `http://localhost:<port>` in Chrome, **Connect to pixel64…**, enter Wi-Fi
credentials, and **Send**. Watch `current_state` advance Provisioning → Provisioned and a device URL
appear. The on-page log shows every notification and the exact bytes written.

## Cloudflare

Scaffolded with `@sveltejs/adapter-cloudflare` (Workers). `wrangler.jsonc` is present; nothing is
deployed yet. Run `bun run gen` after editing `wrangler.jsonc` to refresh types.
