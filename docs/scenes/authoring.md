# Authoring scenes (shader guide)

A hands-on guide to writing procedural scenes in the **web editor**. This is the
practical companion to the [shader-language.md](shader-language.md) *spec* and the
[shader-vm.md](shader-vm.md) *execution model* — read those for the "why"; read this
to actually write a scene.

> **Scope:** this documents the language **as implemented in the `web/` editor spike**
> (`web/src/lib/scene/`). The spike is dynamically typed and interpreted; the eventual
> device path adds static type-checking and bytecode. Where the spike differs from the
> spec, it's called out below.

## The mental model

A procedural scene is **one pixel shader** that the editor evaluates across a 64×64
grid, every frame. You write two blocks:

```glsl
frame {              // runs ONCE per frame — cheap setup shared by all pixels
    // ...
}

pixel {              // runs ONCE per pixel — must assign `color`
    color = vec4(uv.x, uv.y, 0.0, 1.0);
}
```

- `frame {}` is **optional**. Put anything that doesn't depend on the pixel here
  (oscillators, a palette phase, a rotation angle). Values you declare at the top of
  `frame` are visible inside `pixel` — they're "frame-globals."
- `pixel {}` is **required** and must assign the built-in `color` (a `vec4`) by the time
  it finishes. Whatever it leaves in `color` is that pixel's output.

This split is the whole performance story: work done in `frame` happens 1× per frame;
work in `pixel` happens 4096× per frame. Hoist everything you can up into `frame`.

## A worked example

```glsl
uniform float speed = 0.4;            // an input you can drive from a slider
uniform vec3  tint  = vec3(1.0, 0.9, 0.8);

frame {
    float phase = t * speed;          // computed once; reused by every pixel
}

pixel {
    float d = length(st);             // distance from center, 0 at middle
    vec3  c = palette(phase + d) * tint;
    float a = smoothstep(1.0, 0.0, d);// 1 in the center, fading to 0 at the edge
    color = vec4(c * a, a);           // premultiplied (see "Output" below)
}
```

## Coordinates

Every pixel gets three views of its position (all `vec2`):

| Name | Range | Origin | Use |
|---|---|---|---|
| `uv` | `0..1` | top-left | texture-style sampling, gradients |
| `st` | `-1..1` | center | radial/symmetric effects (`length(st)` = distance from center) |
| `xy` | `0..63` | top-left | integer pixel coords as float |

`uv = (pixel + 0.5) / res`, `st = (uv − 0.5) * 2`. The panel is square, so `st` is not
stretched; the aspect correction exists for generality.

## Time

| Name | Type | Meaning |
|---|---|---|
| `t` | `float` | seconds since the scene started (driven by the transport / scrubber) |
| `frame` | `float` | integer frame counter |
| `res` | `vec2` | the eval resolution, e.g. `vec2(64, 64)` |

All three are available in both blocks.

## Types

`float`, `vec2`, `vec3`, `vec4`, `bool`. **There is no `int`.**

```glsl
vec3 a = vec3(1.0);          // splat → (1, 1, 1)
vec3 b = vec3(0.2, 0.4, 0.6);
vec4 c = vec4(b, 1.0);       // concat a vec3 + a float
vec2 d = c.xy;               // swizzle (read-only)
float r = c.r;               // .rgba and .xyzw and .stpq all work
vec2 e = d.yx;               // reorder
```

- **Swizzles are read-only** — `color.rgb = ...` is **not** supported. Build the whole
  vector and assign it: `color = vec4(rgb, a);`.
- Arithmetic (`+ - * / %`) is **component-wise**, and a scalar broadcasts against a
  vector: `c * a` multiplies every component of `c` by the scalar `a`.

## Operators

`+ - * / %`, unary `-` and `!`, comparisons `< <= > >= == !=` (scalars only, yielding
`1.0`/`0.0`), `&& ||`, and the ternary `cond ? a : b`.

## Built-in functions

Math (component-wise on vectors):
`abs floor ceil fract sign sqrt exp log radians degrees min max mod pow step clamp mix smoothstep`

Trig: `sin cos tan atan` — `atan(x)` and `atan(y, x)` both work.

Geometry: `length distance dot normalize cross`.

Color:
- `palette(t) → vec3` — the IQ cosine palette; great default for procedural color.
  Also `palette(t, a, b, c, d)` with `vec3` coefficients for custom palettes.
- `hsv(h, s, v) → vec3`.

Noise:
- `hash(x) → float` — deterministic pseudo-random in `0..1`.
- `noise(vec2) → float`, `noise(vec3) → float` — value noise in `0..1`. Feed `t` as the
  third axis for free animated noise: `noise(vec3(uv * 4.0, t))`.
- `fbm(p, octaves) → float` — fractal sum of noise; `octaves` is a small constant.

Cast: `float(x)` (useful to turn a loop counter into a float in arithmetic).

## Control flow

```glsl
if (d < 0.5) {
    color = vec4(1.0);
} else {
    color = vec4(0.0);
}

float acc = 0.0;
for (i in 0..8) {            // 8 iterations: i = 0,1,…,7  (upper bound exclusive)
    acc += noise(uv * float(i + 1));
}
```

- `for` bounds must be **compile-time integer literals**; the loop variable `i` is a
  **float**. No `while`, no data-dependent bounds.

## Inputs (uniforms)

Declare a `uniform` to expose a knob. In the editor it becomes a slider / color picker;
on the device it's bound to a scene input (static, live, or device-provided — see
[inputs-and-binding.md](inputs-and-binding.md)).

```glsl
uniform float speed = 0.4;     // float  → slider
uniform vec3  tint  = vec3(1); // vec3   → color picker
uniform bool  invert = false;  // bool   → checkbox
```

The `= value` is the **default**. In the editor, an untouched slider follows that
default as you edit the code; once you move it, it shows as "modified" with a reset.

## Output: premultiplied color

`color` is a **premultiplied** `vec4`: the RGB you assign should already be multiplied by
the alpha. For an opaque pixel that's a no-op (`a = 1`). For a fading edge:

```glsl
float a = smoothstep(1.0, 0.0, length(st));
color = vec4(rgb * a, a);      // note rgb * a
```

Layers are composited premultiplied, and the final image sits over **opaque black**
(the panel can't show transparency). See
[layers-and-compositing.md](layers-and-compositing.md).

---

## Is this GLSL? Where does it diverge?

It's **GLSL-flavored, not GLSL** — closer in spirit to a Shadertoy fragment shader, but
with a different program shape. If you know GLSL you'll be productive immediately; here's
what's different.

**Different by design (the important ones):**

1. **No `void main()`.** A program is two blocks — `frame {}` (per-frame) and `pixel {}`
   (per-pixel) — instead of one `main`. This exposes the per-frame/per-pixel cost split
   that GLSL/Shadertoy hide.
2. **Output by assigning `color`.** No `gl_FragColor` / `out vec4 fragColor`. You assign
   the built-in `color`, and it's **premultiplied alpha** (Shadertoy's `fragColor` is
   straight alpha and usually ignored).
3. **Built-in coordinates & time are provided and named differently:** `uv`, `st`, `xy`,
   `t`, `frame`, `res` — not `gl_FragCoord`, and not Shadertoy's `iTime`/`iResolution`.
4. **`for` uses a range form** — `for (i in 0..8)`, not `for (int i = 0; i < 8; i++)` —
   with **constant bounds only** and a **float** loop variable. No `while`.
5. **No `int` type.** Floats only (plus `bool`).
6. **Swizzles are read-only.** `v.xy = ...` is not allowed.
7. **`uniform`s take an inline default** (`uniform float speed = 0.4;`). Real GLSL
   forbids uniform initializers. (Numeric `min`/`max` will live in the scene manifest,
   not the shader source — not wired up yet.)

**Batteries included that you'd hand-roll in GLSL:** `palette` (IQ cosine), `hsv`,
`noise`/`fbm`/`hash` are built in.

**Not supported (v1):** textures / `sampler2D`, matrices (`mat2/3/4`), `struct`s, arrays,
user-defined functions, the preprocessor (`#define`, `#ifdef`), `discard`, and the big
GLSL builtin tail (`reflect`, `refract`, `inverse`, `dFdx`, …).

**Spike-only caveats (will tighten up):** the editor interpreter is **dynamically typed**
— a vec-size mismatch surfaces as a *runtime* error mid-frame, not a compile error, and
there's no opcode/gas budget estimate yet. `noise` uses a sine-based hash rather than the
device's spec'd integer hash, so it's visually representative but not bit-faithful (see
[preview-and-parity.md](preview-and-parity.md)).

## Cheatsheet

```glsl
uniform float speed = 1.0;        // knob → editor slider

frame {                           // 1×/frame
    float ph = t * speed;
}

pixel {                           // 1×/pixel, must set `color`
    // coords:  uv 0..1 (top-left) · st -1..1 (center) · xy 0..63
    float d = length(st);
    vec3  c = palette(ph + d);    // iq palette
    color   = vec4(c, 1.0);       // premultiplied rgba
}
```
