# renderer/ — shared scene renderer (Rust)

The **shared** scene renderer: a small stack VM that executes shader **bytecode**
into a 64×64 premultiplied-RGBA framebuffer. This is the "one renderer, two build
targets" the architecture calls for ([docs/scenes/preview-and-parity.md](../docs/scenes/preview-and-parity.md)):

- **`wasm32-unknown-unknown`** → the `web/` editor preview (live now).
- **the device target** → firmware, above the framebuffer seam (future).

Because the same Rust runs both places, the preview matches the device *by
construction* — not by maintaining a parallel reimplementation.

## Layout

```
src/vm.rs    the f32 stack VM: opcode dispatch + value noise (integer hash)
src/lib.rs   wasm-bindgen `Program`: owns bytecode, runs per-frame/per-pixel, returns RGBA
```

## The bytecode contract

The web compiler ([web/src/lib/scene/emit.ts](../web/src/lib/scene/emit.ts)) lowers
shader source → bytecode; this VM executes it. The contract is two flat
`(opcode, arg)` u32 streams (a per-frame block + a per-pixel block), an `f32`
constants pool, and a slot count. **Vectors are lowered to scalar ops by the
compiler** — the VM only knows `f32`.

- **Opcodes** are numbered in [`src/vm.rs` `mod op`](src/vm.rs), mirrored in
  [web/src/lib/scene/opcodes.ts](../web/src/lib/scene/opcodes.ts). The two **must
  stay in sync**.
- **Uniform layout** (`f32` slots): `0:t 1:frame 2:res.x 3:res.y 4:x 5:y 6:uv.x
  7:uv.y 8:st.x 9:st.y`, then bound scene inputs from index 10. The host fills
  `0..3` and `10..` each frame; the VM fills `4..9` per pixel.
- **`color`** output lives in slots `0..3`; the compiler appends a `STORE_OUT`
  epilogue to the pixel block.

### Noise is bit-portable

`hash`/`noise`/`fbm` use an **integer bit-mix hash** (lowbias32) over integer
lattice coords, not a sine-based hash. Rust `u32` wrapping ops and JS `Math.imul`
produce identical bits, so noise agrees across Rust and the JS reference. (A
sine-based hash diverged badly under `f32` — the exact failure the docs predicted.)

## Build

From `web/`: `bun run build:wasm` (wraps `wasm-pack build … --target web`). Output
lands in `web/src/lib/renderer-wasm/` (gitignored build artifact). Requires the
`wasm32-unknown-unknown` target and `wasm-pack`.

## Parity

The editor renders each frame with both this WASM VM and the TS interpreter and
reports the max per-channel diff. All current example scenes are **bit-identical**
(Δ0/255). A proper conformance-vector CI suite (WASM vs. a native-Rust reference)
is the next step ([docs/scenes/preview-and-parity.md](../docs/scenes/preview-and-parity.md)).

## Status / shortcuts

- Uses `std` (via wasm-bindgen) for now; structured to go `no_std` + `alloc` for
  the device. Transcendentals use `libm` (no system libm on `wasm32`).
- `sin`/`cos` use `libm`, not yet the **LUT** the device spec locks — promote when
  wiring the device target.
- Single shader layer only — no multi-layer compositor / blend modes yet.
