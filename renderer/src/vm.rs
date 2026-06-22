//! The scalar `f32` stack VM that executes shader bytecode, plus value-noise.
//!
//! Mirrors the opcode set in docs/scenes/shader-vm.md. The same bytecode runs
//! here (wasm preview) and is intended to run on-device, so this stays small and
//! `std`-light. Vectors are lowered to scalars by the web compiler before they
//! reach this VM — the VM only knows `f32`.

// ---- opcodes (kept numerically in sync with web/src/lib/scene/opcodes.ts) ----

pub mod op {
    pub const END: u32 = 0;
    pub const PUSH_CONST: u32 = 1;
    pub const LOAD_UNIFORM: u32 = 2;
    pub const LOAD_SLOT: u32 = 3;
    pub const STORE_SLOT: u32 = 4;
    pub const DUP: u32 = 5;
    pub const POP: u32 = 6;
    pub const SWAP: u32 = 7;
    pub const ADD: u32 = 8;
    pub const SUB: u32 = 9;
    pub const MUL: u32 = 10;
    pub const DIV: u32 = 11;
    pub const NEG: u32 = 12;
    pub const MOD: u32 = 13;
    pub const ABS: u32 = 14;
    pub const FLOOR: u32 = 15;
    pub const CEIL: u32 = 16;
    pub const FRACT: u32 = 17;
    pub const SIGN: u32 = 18;
    pub const SQRT: u32 = 19;
    pub const MIN: u32 = 20;
    pub const MAX: u32 = 21;
    pub const CLAMP: u32 = 22;
    pub const MIX: u32 = 23;
    pub const STEP: u32 = 24;
    pub const SMOOTHSTEP: u32 = 25;
    pub const SIN: u32 = 26;
    pub const COS: u32 = 27;
    pub const TAN: u32 = 28;
    pub const ATAN2: u32 = 29;
    pub const EXP: u32 = 30;
    pub const LOG: u32 = 31;
    pub const POW: u32 = 32;
    pub const HASH: u32 = 33;
    pub const NOISE2: u32 = 34;
    pub const NOISE3: u32 = 35;
    pub const LT: u32 = 36;
    pub const GT: u32 = 37;
    pub const LE: u32 = 38;
    pub const GE: u32 = 39;
    pub const EQ: u32 = 40;
    pub const NE: u32 = 41;
    pub const AND: u32 = 42;
    pub const OR: u32 = 43;
    pub const NOT: u32 = 44;
    pub const SELECT: u32 = 45;
    pub const JMP: u32 = 46;
    pub const JMP_IF_ZERO: u32 = 47;
    pub const STORE_OUT: u32 = 48;
}

// ---- value noise (matches web/src/lib/scene/builtins.ts) ----
//
// Integer bit-mix hash (lowbias32 finalizer) over integer lattice coords. Unlike
// a sine-based hash this is bit-portable: the *same* integer ops in Rust (u32)
// and JS (Math.imul) yield the same value, so noise agrees across the device and
// the web preview (docs/scenes/shader-vm.md).

const P1: i32 = 0x8da6b343u32 as i32;
const P2: i32 = 0xd8163841u32 as i32;
const P3: i32 = 0xcb1ab31fu32 as i32;

#[inline]
fn fract(x: f32) -> f32 {
    x - libm::floorf(x)
}
#[inline]
fn imix(mut h: u32) -> u32 {
    h ^= h >> 16;
    h = h.wrapping_mul(0x7feb352d);
    h ^= h >> 15;
    h = h.wrapping_mul(0x846ca68b);
    h ^= h >> 16;
    h
}
#[inline]
fn to_unit(u: u32) -> f32 {
    // top 24 bits → [0,1); exactly representable in f32 *and* f64 (so JS agrees)
    (u >> 8) as f32 / 16_777_216.0
}
#[inline]
fn hash1(x: f32) -> f32 {
    to_unit(imix(x.to_bits()))
}
#[inline]
fn hash2(x: f32, y: f32) -> f32 {
    let ix = libm::floorf(x) as i32;
    let iy = libm::floorf(y) as i32;
    to_unit(imix((ix.wrapping_mul(P1) ^ iy.wrapping_mul(P2)) as u32))
}
#[inline]
fn hash3(x: f32, y: f32, z: f32) -> f32 {
    let ix = libm::floorf(x) as i32;
    let iy = libm::floorf(y) as i32;
    let iz = libm::floorf(z) as i32;
    to_unit(imix((ix.wrapping_mul(P1) ^ iy.wrapping_mul(P2) ^ iz.wrapping_mul(P3)) as u32))
}
#[inline]
fn smooth(f: f32) -> f32 {
    f * f * (3.0 - 2.0 * f)
}
#[inline]
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

fn noise2(px: f32, py: f32) -> f32 {
    let ix = libm::floorf(px);
    let iy = libm::floorf(py);
    let fx = smooth(px - ix);
    let fy = smooth(py - iy);
    let a = hash2(ix, iy);
    let b = hash2(ix + 1.0, iy);
    let c = hash2(ix, iy + 1.0);
    let d = hash2(ix + 1.0, iy + 1.0);
    lerp(lerp(a, b, fx), lerp(c, d, fx), fy)
}

fn noise3(px: f32, py: f32, pz: f32) -> f32 {
    let ix = libm::floorf(px);
    let iy = libm::floorf(py);
    let iz = libm::floorf(pz);
    let fx = smooth(px - ix);
    let fy = smooth(py - iy);
    let fz = smooth(pz - iz);
    let c = |dx: f32, dy: f32, dz: f32| hash3(ix + dx, iy + dy, iz + dz);
    let z0 = lerp(
        lerp(c(0.0, 0.0, 0.0), c(1.0, 0.0, 0.0), fx),
        lerp(c(0.0, 1.0, 0.0), c(1.0, 1.0, 0.0), fx),
        fy,
    );
    let z1 = lerp(
        lerp(c(0.0, 0.0, 1.0), c(1.0, 0.0, 1.0), fx),
        lerp(c(0.0, 1.0, 1.0), c(1.0, 1.0, 1.0), fx),
        fy,
    );
    lerp(z0, z1, fz)
}

// ---- the interpreter ----

/// Executes one bytecode block. `stack` and `out` are scratch the caller owns so
/// they can be reused across pixels without reallocation. `instr` is a flat
/// (opcode, arg) stream. Returns when it hits END or runs off the end.
#[allow(clippy::too_many_arguments)]
pub fn run(
    instr: &[u32],
    constants: &[f32],
    uniforms: &[f32],
    slots: &mut [f32],
    stack: &mut Vec<f32>,
    out: &mut [f32; 4],
) {
    stack.clear();
    let mut ip = 0usize;
    let n = instr.len();
    while ip + 1 < n {
        let opcode = instr[ip];
        let arg = instr[ip + 1];
        ip += 2;
        match opcode {
            op::END => break,
            op::PUSH_CONST => stack.push(constants[arg as usize]),
            op::LOAD_UNIFORM => stack.push(uniforms[arg as usize]),
            op::LOAD_SLOT => stack.push(slots[arg as usize]),
            op::STORE_SLOT => {
                let v = stack.pop().unwrap_or(0.0);
                slots[arg as usize] = v;
            }
            op::DUP => {
                let v = *stack.last().unwrap_or(&0.0);
                stack.push(v);
            }
            op::POP => {
                stack.pop();
            }
            op::SWAP => {
                let len = stack.len();
                if len >= 2 {
                    stack.swap(len - 1, len - 2);
                }
            }
            op::ADD => bin(stack, |a, b| a + b),
            op::SUB => bin(stack, |a, b| a - b),
            op::MUL => bin(stack, |a, b| a * b),
            op::DIV => bin(stack, |a, b| a / b),
            op::MOD => bin(stack, |a, b| a - b * libm::floorf(a / b)),
            op::NEG => un(stack, |a| -a),
            op::ABS => un(stack, |a| a.abs()),
            op::FLOOR => un(stack, libm::floorf),
            op::CEIL => un(stack, libm::ceilf),
            op::FRACT => un(stack, fract),
            op::SIGN => un(stack, |a| if a > 0.0 { 1.0 } else if a < 0.0 { -1.0 } else { 0.0 }),
            op::SQRT => un(stack, |a| a.sqrt()),
            op::MIN => bin(stack, |a, b| a.min(b)),
            op::MAX => bin(stack, |a, b| a.max(b)),
            op::CLAMP => {
                let hi = stack.pop().unwrap_or(0.0);
                let lo = stack.pop().unwrap_or(0.0);
                let x = stack.pop().unwrap_or(0.0);
                stack.push(x.max(lo).min(hi));
            }
            op::MIX => {
                let t = stack.pop().unwrap_or(0.0);
                let b = stack.pop().unwrap_or(0.0);
                let a = stack.pop().unwrap_or(0.0);
                stack.push(a + (b - a) * t);
            }
            op::STEP => bin(stack, |edge, x| if x < edge { 0.0 } else { 1.0 }),
            op::SMOOTHSTEP => {
                let x = stack.pop().unwrap_or(0.0);
                let e1 = stack.pop().unwrap_or(0.0);
                let e0 = stack.pop().unwrap_or(0.0);
                let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
                stack.push(t * t * (3.0 - 2.0 * t));
            }
            op::SIN => un(stack, libm::sinf),
            op::COS => un(stack, libm::cosf),
            op::TAN => un(stack, libm::tanf),
            op::ATAN2 => bin(stack, libm::atan2f),
            op::EXP => un(stack, libm::expf),
            op::LOG => un(stack, libm::logf),
            op::POW => bin(stack, libm::powf),
            op::HASH => un(stack, hash1),
            op::NOISE2 => bin(stack, noise2),
            op::NOISE3 => {
                let z = stack.pop().unwrap_or(0.0);
                let y = stack.pop().unwrap_or(0.0);
                let x = stack.pop().unwrap_or(0.0);
                stack.push(noise3(x, y, z));
            }
            op::LT => bin(stack, |a, b| (a < b) as i32 as f32),
            op::GT => bin(stack, |a, b| (a > b) as i32 as f32),
            op::LE => bin(stack, |a, b| (a <= b) as i32 as f32),
            op::GE => bin(stack, |a, b| (a >= b) as i32 as f32),
            op::EQ => bin(stack, |a, b| (a == b) as i32 as f32),
            op::NE => bin(stack, |a, b| (a != b) as i32 as f32),
            op::AND => bin(stack, |a, b| ((a != 0.0) && (b != 0.0)) as i32 as f32),
            op::OR => bin(stack, |a, b| ((a != 0.0) || (b != 0.0)) as i32 as f32),
            op::NOT => un(stack, |a| (a == 0.0) as i32 as f32),
            op::SELECT => {
                let c = stack.pop().unwrap_or(0.0);
                let b = stack.pop().unwrap_or(0.0);
                let a = stack.pop().unwrap_or(0.0);
                stack.push(if c != 0.0 { a } else { b });
            }
            op::JMP => ip = arg as usize,
            op::JMP_IF_ZERO => {
                let c = stack.pop().unwrap_or(0.0);
                if c == 0.0 {
                    ip = arg as usize;
                }
            }
            op::STORE_OUT => {
                let v = stack.pop().unwrap_or(0.0);
                out[arg as usize] = v;
            }
            _ => {} // unknown opcode: skip
        }
    }
}

#[inline]
fn un(stack: &mut Vec<f32>, f: impl Fn(f32) -> f32) {
    let a = stack.pop().unwrap_or(0.0);
    stack.push(f(a));
}
#[inline]
fn bin(stack: &mut Vec<f32>, f: impl Fn(f32, f32) -> f32) {
    let b = stack.pop().unwrap_or(0.0);
    let a = stack.pop().unwrap_or(0.0);
    stack.push(f(a, b));
}
