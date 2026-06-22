// Frame renderer: runs a SceneRuntime's per-frame block once, then its per-pixel
// block across the eval-resolution grid, compositing premultiplied output over
// opaque black into an RGBA byte buffer (docs/scenes/layers-and-compositing.md).
//
// The panel is 64×64; `res` is the layer's eval resolution (≤ 64). The Preview
// component upscales nearest-neighbor, matching the device's v1 upscaling.

import { type FrameGlobals, type PixelCoords, SceneRuntime } from './interpreter';

export interface RenderResult {
	ok: boolean;
	/** error message if a runtime error occurred this frame */
	error?: string;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Render one frame into `rgba` (length res*res*4). Returns ok/error rather than
 * throwing so the animation loop can keep ticking and surface the message.
 */
export function renderFrame(
	runtime: SceneRuntime,
	t: number,
	frame: number,
	res: number,
	uniforms: Map<string, number | number[]>,
	rgba: Uint8ClampedArray
): RenderResult {
	try {
		const globals: FrameGlobals = { t, frame, res: [res, res] };
		const base = runtime.runFrame(globals, uniforms);

		const px: PixelCoords = { uv: [0, 0], st: [0, 0], xy: [0, 0] };
		let o = 0;
		for (let y = 0; y < res; y++) {
			for (let x = 0; x < res; x++) {
				const u = (x + 0.5) / res;
				const v = (y + 0.5) / res;
				px.uv[0] = u;
				px.uv[1] = v;
				// st: centered −1..1, aspect-corrected (square panel → aspect 1)
				px.st[0] = (u - 0.5) * 2;
				px.st[1] = (v - 0.5) * 2;
				px.xy[0] = x;
				px.xy[1] = y;

				const c = runtime.runPixel(base, px);
				// premultiplied over opaque black → rgb is already premultiplied
				rgba[o++] = clamp01(c[0]) * 255;
				rgba[o++] = clamp01(c[1]) * 255;
				rgba[o++] = clamp01(c[2]) * 255;
				rgba[o++] = 255;
			}
		}
		return { ok: true };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}
