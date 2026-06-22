//! pixel64 shared renderer — wasm32 entry point.
//!
//! A `Program` owns decoded shader bytecode (a per-frame block + a per-pixel
//! block, a constants pool, slot/uniform counts) and renders it across the
//! eval-resolution grid into a premultiplied-over-black RGBA buffer. This is the
//! "shared Rust renderer compiled to WASM" the preview architecture calls for
//! (docs/scenes/preview-and-parity.md) — the same crate is meant to drive the
//! device above the framebuffer seam.
//!
//! Uniform layout (f32 slots), per docs/scenes/shader-vm.md:
//!   0:t 1:frame 2:res.x 3:res.y 4:x 5:y 6:uv.x 7:uv.y 8:st.x 9:st.y 10..:inputs
//! The host fills 0..3 and 10.. each frame; the VM fills 4..9 per pixel.

mod vm;

use wasm_bindgen::prelude::*;

const RESERVED_UNIFORMS: usize = 10;

#[wasm_bindgen]
pub struct Program {
    frame: Vec<u32>,
    pixel: Vec<u32>,
    constants: Vec<f32>,
    num_slots: usize,
    // scratch reused across pixels
    slots: Vec<f32>,
    stack: Vec<f32>,
    framebuffer: Vec<u8>,
}

#[wasm_bindgen]
impl Program {
    /// `instr_frame` / `instr_pixel` are flat (opcode, arg) u32 streams.
    #[wasm_bindgen(constructor)]
    pub fn new(
        instr_frame: &[u32],
        instr_pixel: &[u32],
        constants: &[f32],
        num_slots: u32,
    ) -> Program {
        Program {
            frame: instr_frame.to_vec(),
            pixel: instr_pixel.to_vec(),
            constants: constants.to_vec(),
            num_slots: num_slots as usize,
            slots: vec![0.0; num_slots as usize],
            stack: Vec::with_capacity(32),
            framebuffer: Vec::new(),
        }
    }

    /// Render one frame. `uniforms` holds the reserved built-ins (0..3) and bound
    /// inputs (10..) for this frame; positions 4..9 are filled per pixel here.
    /// Returns RGBA8 (`res * res * 4` bytes), premultiplied over opaque black.
    pub fn render(&mut self, uniforms: &[f32], res: u32) -> Vec<u8> {
        let res = res as usize;
        let inv = 1.0 / res as f32;

        // Working uniform array: at least the reserved block.
        let mut u = uniforms.to_vec();
        if u.len() < RESERVED_UNIFORMS {
            u.resize(RESERVED_UNIFORMS, 0.0);
        }

        // Reset slots so frame-globals start clean each frame.
        self.slots.clear();
        self.slots.resize(self.num_slots, 0.0);

        // per-frame block once → writes frame-global slots.
        let mut out = [0.0f32; 4];
        vm::run(
            &self.frame,
            &self.constants,
            &u,
            &mut self.slots,
            &mut self.stack,
            &mut out,
        );

        self.framebuffer.clear();
        self.framebuffer.resize(res * res * 4, 0);

        let mut o = 0usize;
        for y in 0..res {
            for x in 0..res {
                let uvx = (x as f32 + 0.5) * inv;
                let uvy = (y as f32 + 0.5) * inv;
                u[4] = x as f32;
                u[5] = y as f32;
                u[6] = uvx;
                u[7] = uvy;
                u[8] = (uvx - 0.5) * 2.0;
                u[9] = (uvy - 0.5) * 2.0;

                out = [0.0; 4];
                vm::run(
                    &self.pixel,
                    &self.constants,
                    &u,
                    &mut self.slots,
                    &mut self.stack,
                    &mut out,
                );

                // premultiplied over opaque black → rgb already premultiplied
                self.framebuffer[o] = to_u8(out[0]);
                self.framebuffer[o + 1] = to_u8(out[1]);
                self.framebuffer[o + 2] = to_u8(out[2]);
                self.framebuffer[o + 3] = 255;
                o += 4;
            }
        }

        self.framebuffer.clone()
    }
}

#[inline]
fn to_u8(x: f32) -> u8 {
    (x.clamp(0.0, 1.0) * 255.0 + 0.5) as u8
}
