<script lang="ts">
	import { renderFrame, type SceneRuntime, type Value } from '$lib/scene';
	import type { WasmScene } from '$lib/scene/wasm-renderer';

	interface Props {
		runtime: SceneRuntime | null;
		wasmScene?: WasmScene | null;
		mode?: 'ts' | 'wasm';
		uniforms: Record<string, Value>;
		res: number;
		playing: boolean;
		timeScale?: number;
		/** display size of the (square) panel in CSS px */
		display?: number;
		grid?: boolean;
		t?: number;
		frame?: number;
		fps?: number;
		error?: string | null;
	}

	let {
		runtime,
		wasmScene = null,
		mode = 'ts',
		uniforms,
		res,
		playing,
		timeScale = 1,
		display = 512,
		grid = true,
		t = $bindable(0),
		frame = $bindable(0),
		fps = $bindable(0),
		error = $bindable(null)
	}: Props = $props();

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;
	let imageData: ImageData | null = null;

	// (Re)allocate the pixel buffer when resolution changes.
	$effect(() => {
		if (!canvas) return;
		ctx = canvas.getContext('2d');
		imageData = new ImageData(res, res);
	});

	// Draw whenever any render input changes (covers scrubbing while paused).
	$effect(() => {
		// touch reactive deps explicitly
		void runtime;
		void wasmScene;
		void mode;
		void uniforms;
		void res;
		void t;
		void frame;
		draw();
	});

	function draw() {
		if (!ctx || !imageData) return;
		const useWasm = mode === 'wasm' && wasmScene;
		if (!useWasm && !runtime) {
			ctx.clearRect(0, 0, res, res);
			return;
		}
		if (useWasm) {
			try {
				const rgba = wasmScene!.render(t, frame, res, uniforms);
				imageData.data.set(rgba);
				ctx.putImageData(imageData, 0, 0);
				error = null;
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
			}
			return;
		}
		const uni = new Map<string, Value>(Object.entries(uniforms));
		const result = renderFrame(runtime!, t, frame, res, uni, imageData.data as Uint8ClampedArray);
		error = result.ok ? null : (result.error ?? 'render error');
		if (result.ok) ctx.putImageData(imageData, 0, 0);
	}

	// Animation clock: advances t/frame while playing. Drawing happens in the
	// effect above, reacting to t.
	$effect(() => {
		if (!playing) return;
		let raf = 0;
		let last = performance.now();
		let acc = 0;
		let count = 0;

		const tick = (now: number) => {
			const dt = (now - last) / 1000;
			last = now;
			t += dt * timeScale;
			frame += 1;

			acc += dt;
			count += 1;
			if (acc >= 0.5) {
				fps = count / acc;
				acc = 0;
				count = 0;
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});
</script>

<div class="panel" style="--display:{display}px; --res:{res};">
	<canvas bind:this={canvas} width={res} height={res} style="width:{display}px; height:{display}px;"
	></canvas>
	{#if grid}
		<div class="grid" aria-hidden="true"></div>
	{/if}
	{#if error}
		<div class="overlay-error">⚠ runtime error</div>
	{/if}
</div>

<style>
	.panel {
		position: relative;
		width: var(--display);
		height: var(--display);
		border-radius: 6px;
		overflow: hidden;
		background: #000;
		box-shadow:
			0 0 0 1px #2a2a32,
			0 8px 30px rgba(0, 0, 0, 0.5);
	}
	canvas {
		display: block;
		image-rendering: pixelated;
	}
	.grid {
		position: absolute;
		inset: 0;
		pointer-events: none;
		--cell: calc(var(--display) / var(--res));
		background-image:
			linear-gradient(to right, rgba(0, 0, 0, 0.4) 1px, transparent 1px),
			linear-gradient(to bottom, rgba(0, 0, 0, 0.4) 1px, transparent 1px);
		background-size: var(--cell) var(--cell);
	}
	.overlay-error {
		position: absolute;
		left: 8px;
		bottom: 8px;
		padding: 2px 8px;
		font-size: 12px;
		font-family: ui-monospace, monospace;
		color: #ffb3b3;
		background: rgba(40, 0, 0, 0.7);
		border-radius: 4px;
	}
</style>
