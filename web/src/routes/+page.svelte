<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import {
		compile,
		renderFrame,
		type CompileError,
		type SceneRuntime,
		type UniformInfo,
		type Value
	} from '$lib/scene';
	import { emitBytecode } from '$lib/scene/emit';
	import { ensureWasmReady, WasmScene } from '$lib/scene/wasm-renderer';
	import { EXAMPLES, DEFAULT_SOURCE } from '$lib/scene/examples';
	import CodeEditor from '$lib/components/CodeEditor.svelte';
	import Preview from '$lib/components/Preview.svelte';
	import UniformControls from '$lib/components/UniformControls.svelte';
	import CostBadge from '$lib/components/CostBadge.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Slider from '$lib/components/ui/Slider.svelte';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';

	const exampleItems = EXAMPLES.map((e) => ({ value: e.id, label: e.name }));

	// --- editor + compilation state ---
	let source = $state(DEFAULT_SOURCE);
	let selectedExample = $state(EXAMPLES[0].id);

	let runtime = $state<SceneRuntime | null>(null);
	let uniformInfos = $state<UniformInfo[]>([]);
	let uniformValues = $state<Record<string, Value>>({});
	// Which uniforms the user has moved off their code default. An un-overridden
	// slider tracks the `= default` in the source; a moved one keeps its value and
	// shows a reset affordance. This is what makes "code default vs live value"
	// legible.
	let overrides = $state<Record<string, boolean>>({});
	let compileError = $state<CompileError | null>(null);

	// Recompile on every edit. Cheap (~sub-ms); keeps last-good runtime on error so
	// the preview keeps animating while you fix a typo.
	$effect(() => {
		const result = compile(source);
		if (result.ok) {
			compileError = null;
			runtime = result.runtime;
			uniformInfos = result.uniforms;
			const prev = untrack(() => uniformValues);
			const prevOv = untrack(() => overrides);
			const next: Record<string, Value> = {};
			const nextOv: Record<string, boolean> = {};
			for (const u of result.uniforms) {
				if (prevOv[u.name] && u.name in prev) {
					// user moved this slider — keep their live value
					next[u.name] = prev[u.name];
					nextOv[u.name] = true;
				} else {
					// untouched — follow the code default (so editing `= x` updates it)
					next[u.name] = u.default;
				}
			}
			uniformValues = next;
			overrides = nextOv;
		} else {
			compileError = result.error;
		}
	});

	// --- WASM renderer (the shared Rust renderer compiled to wasm) ---
	let rendererMode = $state<'ts' | 'wasm'>('wasm');
	let wasmReady = $state(false);
	let wasmScene = $state<WasmScene | null>(null);
	let wasmError = $state<string | null>(null);
	let parityDiff = $state<number | null>(null);

	onMount(() => {
		ensureWasmReady()
			.then(() => (wasmReady = true))
			.catch((e) => (wasmError = e instanceof Error ? e.message : String(e)));
	});

	// (Re)compile the program to bytecode and build a wasm scene whenever the
	// program or wasm-readiness changes. If a construct isn't supported by the
	// bytecode path yet, fall back to the TS interpreter and surface why.
	$effect(() => {
		void runtime; // dependency: rebuild on recompile
		if (!wasmReady || !runtime) return;
		const prog = runtime.program;
		const old = untrack(() => wasmScene);
		try {
			const scene = new WasmScene(emitBytecode(prog));
			old?.free();
			wasmScene = scene;
			wasmError = null;
		} catch (e) {
			old?.free();
			wasmScene = null;
			wasmError = e instanceof Error ? e.message : String(e);
			if (untrack(() => rendererMode) === 'wasm') rendererMode = 'ts';
		}
		untrack(runParityCheck);
	});

	// Render the current frame with both engines and report the max channel diff —
	// the live proof that preview ≈ device (docs/scenes/preview-and-parity.md).
	function runParityCheck() {
		const rt = untrack(() => runtime);
		const scene = untrack(() => wasmScene);
		if (!rt || !scene) {
			parityDiff = null;
			return;
		}
		const r = untrack(() => res);
		const tt = untrack(() => t);
		const f = untrack(() => frame);
		const vals = untrack(() => uniformValues);
		const tsBuf = new Uint8ClampedArray(r * r * 4);
		renderFrame(rt, tt, f, r, new Map(Object.entries(vals)), tsBuf);
		const w = scene.render(tt, f, r, vals);
		let maxDiff = 0;
		for (let i = 0; i < tsBuf.length; i++) {
			if (i % 4 === 3) continue;
			const d = Math.abs(tsBuf[i] - w[i]);
			if (d > maxDiff) maxDiff = d;
		}
		parityDiff = maxDiff;
	}

	function markOverride(name: string) {
		if (!overrides[name]) overrides = { ...overrides, [name]: true };
	}
	function resetUniform(name: string) {
		const info = uniformInfos.find((u) => u.name === name);
		if (!info) return;
		uniformValues = { ...uniformValues, [name]: info.default };
		const { [name]: _drop, ...rest } = overrides;
		overrides = rest;
	}

	// --- transport state ---
	let playing = $state(true);
	let t = $state(0);
	let frame = $state(0);
	let fps = $state(0);
	let timeScale = $state(1);
	let res = $state(64);
	let grid = $state(true);
	let runtimeError = $state<string | null>(null);

	const RESOLUTIONS = [16, 32, 48, 64];

	// The scrub slider is two-way bound to the clock, so a fixed `max` would clamp
	// `t` and freeze the animation once it hit the cap. Grow the scrub window in
	// 30s steps so the free-running clock is never clamped.
	const SCRUB_WINDOW = 30;
	const scrubMax = $derived((Math.floor(Math.max(t, 0) / SCRUB_WINDOW) + 1) * SCRUB_WINDOW);

	function loadExample(id: string) {
		const ex = EXAMPLES.find((e) => e.id === id);
		if (!ex) return;
		selectedExample = id;
		source = ex.source;
		resetClock();
	}
	function resetClock() {
		t = 0;
		frame = 0;
	}
</script>

<div class="app">
	<header>
		<div class="brand">dazzle <span class="sub">scene editor</span></div>
		<div class="spacer"></div>
		<div class="field">
			example
			<Select bind:value={selectedExample} items={exampleItems} onValueChange={loadExample} />
		</div>
	</header>

	<main>
		<!-- left: source editor -->
		<section class="editor-pane">
			<div class="pane-head">shader source</div>
			<CodeEditor bind:value={source} />
			<div class="status" class:error={!!compileError}>
				{#if compileError}
					✗ {compileError.message}{#if compileError.line}
						<span class="loc">(line {compileError.line}:{compileError.col})</span>{/if}
				{:else}
					✓ compiles
				{/if}
			</div>
		</section>

		<!-- right: simulator -->
		<section class="sim-pane">
			<div class="preview-wrap">
				<Preview
					{runtime}
					{wasmScene}
					mode={rendererMode}
					uniforms={uniformValues}
					{res}
					{playing}
					{timeScale}
					{grid}
					display={480}
					bind:t
					bind:frame
					bind:fps
					bind:error={runtimeError}
				/>
			</div>

			<div class="renderer-bar">
				<div class="field">
					renderer
					<div class="res-buttons">
						<button class:active={rendererMode === 'ts'} onclick={() => (rendererMode = 'ts')}
							>TS</button
						>
						<button
							class:active={rendererMode === 'wasm'}
							disabled={!wasmScene}
							title={wasmScene ? 'Rust → WASM renderer' : 'wasm unavailable for this scene'}
							onclick={() => wasmScene && (rendererMode = 'wasm')}>WASM</button
						>
					</div>
				</div>
				{#if wasmError}
					<span class="parity warn" title={wasmError}>⚠ wasm: {wasmError}</span>
				{:else if parityDiff !== null}
					<span class="parity" class:ok={parityDiff <= 2} class:warn={parityDiff > 2}>
						{parityDiff <= 2 ? '✓' : '≠'} WASM ≡ TS · Δ{parityDiff}/255
					</span>
					<button class="recheck" onclick={runParityCheck} title="re-check parity at current frame"
						>recheck</button
					>
				{:else if !wasmReady}
					<span class="parity">loading wasm…</span>
				{/if}
			</div>

			<div class="transport">
				<button class="play" onclick={() => (playing = !playing)}>
					{playing ? '❚❚' : '▶'}
				</button>
				<button onclick={resetClock} title="reset clock">⟲</button>
				<!-- Native range, not bits-ui: this is bound to the per-frame clock over a
				     growing window. bits-ui snaps each value against an O((max-min)/step)
				     array every change, which makes playback jerky as `t` climbs. -->
				<input
					class="scrub"
					type="range"
					min="0"
					max={scrubMax}
					step="0.01"
					bind:value={t}
					aria-label="scrub time"
				/>
				<span class="readout">t={t.toFixed(2)}s</span>
				<span class="readout">f={frame}</span>
				<span class="readout">{fps.toFixed(0)} fps</span>
			</div>

			<div class="sim-options">
				<label class="field speed">
					speed
					<div class="speed-slider"><Slider bind:value={timeScale} min={0} max={3} step={0.05} /></div>
					<span class="readout">{timeScale.toFixed(2)}×</span>
				</label>
				<div class="field">
					eval_res
					<div class="res-buttons">
						{#each RESOLUTIONS as r (r)}
							<button class:active={res === r} onclick={() => (res = r)}>{r}</button>
						{/each}
					</div>
				</div>
				<Checkbox bind:checked={grid} label="grid" />
				<div class="spacer"></div>
				<CostBadge {runtime} {res} />
			</div>

			<div class="uniforms-box">
				<div class="pane-head">
					inputs (uniforms)
					<span class="pane-hint">— declared in code; sliders set the live value</span>
				</div>
				<UniformControls
					uniforms={uniformInfos}
					bind:values={uniformValues}
					modified={overrides}
					onedit={markOverride}
					onreset={resetUniform}
				/>
			</div>
		</section>
	</main>
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
	}
	header {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--border);
		background: var(--panel);
	}
	.brand {
		font-weight: 700;
		letter-spacing: 0.5px;
	}
	.brand .sub {
		color: var(--muted);
		font-weight: 400;
		font-size: 13px;
		margin-left: 6px;
	}
	.spacer {
		flex: 1;
	}
	main {
		flex: 1;
		display: grid;
		grid-template-columns: 1fr 540px;
		min-height: 0;
	}
	.editor-pane {
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--border);
		min-width: 0;
	}
	.pane-head {
		padding: 8px 14px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		color: var(--muted);
		border-bottom: 1px solid var(--border);
	}
	.pane-hint {
		text-transform: none;
		letter-spacing: 0;
		color: #50505c;
	}
	.status {
		padding: 8px 14px;
		font-family: ui-monospace, monospace;
		font-size: 12px;
		color: #7bd88f;
		border-top: 1px solid var(--border);
		background: var(--panel);
		white-space: pre-wrap;
	}
	.status.error {
		color: #ff9d9d;
	}
	.status .loc {
		color: var(--muted);
		margin-left: 6px;
	}

	.sim-pane {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 16px;
		overflow-y: auto;
		background: var(--panel);
	}
	.preview-wrap {
		display: flex;
		justify-content: center;
	}
	.renderer-bar {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.parity {
		font-family: ui-monospace, monospace;
		font-size: 12px;
		color: var(--muted);
	}
	.parity.ok {
		color: #7bd88f;
	}
	.parity.warn {
		color: #ffb86b;
	}
	.recheck {
		padding: 2px 8px;
		font-size: 11px;
	}
	button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.transport {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.transport .scrub {
		flex: 1;
		accent-color: var(--accent);
		cursor: pointer;
	}
	.speed-slider {
		width: 110px;
		display: flex;
	}
	button {
		background: #1c1c24;
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 5px;
		padding: 5px 10px;
		font-size: 13px;
		cursor: pointer;
	}
	button:hover {
		border-color: #3a3a44;
	}
	button.play {
		min-width: 40px;
		font-size: 14px;
	}
	.readout {
		font-family: ui-monospace, monospace;
		font-size: 12px;
		color: var(--muted);
		white-space: nowrap;
	}
	.sim-options {
		display: flex;
		align-items: center;
		gap: 18px;
		flex-wrap: wrap;
	}
	.field {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--muted);
	}
	.res-buttons {
		display: flex;
		gap: 4px;
	}
	.res-buttons button {
		padding: 3px 8px;
		font-family: ui-monospace, monospace;
	}
	.res-buttons button.active {
		border-color: var(--accent);
		color: var(--accent);
	}
	.uniforms-box {
		border: 1px solid var(--border);
		border-radius: 6px;
		overflow: hidden;
	}
	.uniforms-box :global(.uniforms) {
		padding: 12px 14px;
	}
	.uniforms-box .pane-head {
		background: #16161c;
	}
</style>
