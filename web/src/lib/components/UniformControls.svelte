<script lang="ts">
	import type { UniformInfo, Value } from '$lib/scene';
	import Slider from './ui/Slider.svelte';
	import Checkbox from './ui/Checkbox.svelte';

	interface Props {
		uniforms: UniformInfo[];
		values: Record<string, Value>;
		/** names the user has moved off their code default */
		modified?: Record<string, boolean>;
		/** called when a control is edited, so the parent can flag an override */
		onedit?: (name: string) => void;
		/** called when the reset button is pressed */
		onreset?: (name: string) => void;
	}
	let {
		uniforms,
		values = $bindable(),
		modified = {},
		onedit,
		onreset
	}: Props = $props();

	function edit(name: string, v: Value) {
		values = { ...values, [name]: v };
		onedit?.(name);
	}
	function setComponent(name: string, i: number, v: number) {
		const next = (values[name] as number[]).slice();
		next[i] = v;
		edit(name, next);
	}
	function setColor(name: string, hex: string) {
		const r = parseInt(hex.slice(1, 3), 16) / 255;
		const g = parseInt(hex.slice(3, 5), 16) / 255;
		const b = parseInt(hex.slice(5, 7), 16) / 255;
		edit(name, [r, g, b]);
	}
	const toHex = (v: Value) => {
		const c = (v as number[]).map((x) =>
			Math.round(Math.min(Math.max(x, 0), 1) * 255)
				.toString(16)
				.padStart(2, '0')
		);
		return `#${c[0]}${c[1]}${c[2]}`;
	};
	const compLabels = ['x', 'y', 'z', 'w'];

	// Human-readable code default, shown so the slider's relationship to the
	// source is explicit.
	function fmtDefault(u: UniformInfo): string {
		const d = u.default;
		if (u.type === 'bool') return (d as number) !== 0 ? 'true' : 'false';
		if (typeof d === 'number') return trim(d);
		return `${u.type}(${(d as number[]).map(trim).join(', ')})`;
	}
	const trim = (n: number) => String(Math.round(n * 1000) / 1000);
</script>

<div class="uniforms">
	{#if uniforms.length === 0}
		<p class="empty">No <code>uniform</code> declared. Add e.g. <code>uniform float speed = 0.4;</code></p>
	{:else}
		{#each uniforms as u (u.name)}
			{@const isMod = !!modified[u.name]}
			<div class="row">
				<div class="head">
					<label for={`u-${u.name}`}>{u.name}</label>
					<span class="type">{u.type}</span>
				</div>

				<div class="control">
					{#if u.type === 'bool'}
						<Checkbox
							checked={(values[u.name] as number) !== 0}
							onCheckedChange={(v) => edit(u.name, v ? 1 : 0)}
						/>
					{:else if u.type === 'float'}
						<Slider
							value={values[u.name] as number}
							min={-4}
							max={4}
							step={0.01}
							onValueChange={(v) => edit(u.name, v)}
						/>
						<input
							class="num"
							type="number"
							step="0.01"
							value={values[u.name] as number}
							oninput={(e) => edit(u.name, +e.currentTarget.value)}
						/>
					{:else if u.type === 'vec3'}
						<input
							id={`u-${u.name}`}
							type="color"
							value={toHex(values[u.name])}
							oninput={(e) => setColor(u.name, e.currentTarget.value)}
						/>
						<span class="hint">rgb</span>
					{:else}
						<!-- vec2 / vec4: component sliders -->
						{#each values[u.name] as number[] as comp, i}
							<span class="comp">
								<span class="comp-label">{compLabels[i]}</span>
								<Slider
									value={comp}
									min={-4}
									max={4}
									step={0.01}
									onValueChange={(v) => setComponent(u.name, i, v)}
								/>
							</span>
						{/each}
					{/if}
				</div>

				<div class="meta">
					{#if isMod}
						<button class="reset" title={`reset to code default (${fmtDefault(u)})`} onclick={() => onreset?.(u.name)}>↺</button>
						<span class="modified">modified</span>
					{:else}
						<span class="def" title="default declared in source">= {fmtDefault(u)}</span>
					{/if}
				</div>
			</div>
		{/each}
	{/if}
</div>

<style>
	.uniforms {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.empty {
		color: #6b6b78;
		font-size: 13px;
		margin: 0;
		line-height: 1.6;
	}
	.empty code {
		font-family: ui-monospace, monospace;
		color: #9a9aa8;
	}
	.row {
		display: grid;
		grid-template-columns: 120px 1fr auto;
		align-items: center;
		gap: 10px;
	}
	.head {
		display: flex;
		flex-direction: column;
		line-height: 1.2;
	}
	label {
		font-family: ui-monospace, monospace;
		font-size: 13px;
		color: #d8d8e0;
	}
	.type {
		font-size: 11px;
		color: #6b6b78;
	}
	.control {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.num {
		width: 64px;
		background: #16161c;
		color: #d8d8e0;
		border: 1px solid #2a2a32;
		border-radius: 4px;
		padding: 2px 4px;
		font-family: ui-monospace, monospace;
		font-size: 12px;
	}
	.comp {
		display: flex;
		align-items: center;
		gap: 4px;
		flex: 1;
		min-width: 100px;
	}
	.comp-label,
	.hint {
		font-size: 11px;
		color: #6b6b78;
		font-family: ui-monospace, monospace;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 6px;
		justify-self: end;
		min-width: 80px;
		justify-content: flex-end;
	}
	.def {
		font-family: ui-monospace, monospace;
		font-size: 12px;
		color: #6b6b78;
	}
	.modified {
		font-size: 11px;
		color: var(--accent);
	}
	.reset {
		background: #1c1c24;
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 5px;
		padding: 1px 7px;
		font-size: 13px;
		cursor: pointer;
		line-height: 1.4;
	}
	.reset:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
</style>
