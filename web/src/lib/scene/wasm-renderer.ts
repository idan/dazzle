// Browser-side binding to the Rust→WASM renderer (renderer/ crate). This is the
// "shared renderer compiled to WASM" the architecture calls for — the same
// bytecode runs here and (eventually) on-device, so the preview matches by
// construction (docs/scenes/preview-and-parity.md).
//
// The wasm glue is dynamic-imported so it never loads during SSR.

import type { Program } from '$lib/renderer-wasm/renderer';
import type { Value } from './builtins';
import type { CompiledBytecode } from './emit';
import { UNIFORM } from './opcodes';

type WasmModule = typeof import('$lib/renderer-wasm/renderer');

let mod: WasmModule | null = null;
let initPromise: Promise<void> | null = null;

/** Initialize the wasm module once (idempotent). Browser-only. */
export async function ensureWasmReady(): Promise<void> {
	if (mod) return;
	if (!initPromise) {
		initPromise = (async () => {
			const m = await import('$lib/renderer-wasm/renderer');
			await m.default(); // fetches renderer_bg.wasm via import.meta.url
			mod = m;
		})();
	}
	await initPromise;
}

export function isWasmReady(): boolean {
	return mod !== null;
}

/** A compiled scene living in wasm: owns a Program + a reusable uniform buffer. */
export class WasmScene {
	private program: Program;
	private uniforms: Float32Array;

	constructor(private compiled: CompiledBytecode) {
		if (!mod) throw new Error('wasm not initialized — call ensureWasmReady() first');
		this.program = new mod.Program(
			compiled.frame,
			compiled.pixel,
			compiled.constants,
			compiled.numSlots
		);
		this.uniforms = new Float32Array(Math.max(10, compiled.totalUniforms));
	}

	/** Render one frame → RGBA8 (`res*res*4`), premultiplied over black. */
	render(t: number, frame: number, res: number, values: Record<string, Value>): Uint8Array {
		const u = this.uniforms;
		u[UNIFORM.t] = t;
		u[UNIFORM.frame] = frame;
		u[UNIFORM.resX] = res;
		u[UNIFORM.resY] = res;
		for (const slot of this.compiled.uniforms) {
			const v = values[slot.name];
			if (Array.isArray(v)) {
				for (let k = 0; k < slot.width; k++) u[slot.index + k] = v[k] ?? 0;
			} else {
				u[slot.index] = (v as number) ?? 0;
			}
		}
		return this.program.render(u, res);
	}

	free(): void {
		this.program.free();
	}
}
