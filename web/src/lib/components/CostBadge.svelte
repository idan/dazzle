<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import type { SceneRuntime } from '$lib/scene';
	import { estimateCost, costStatus } from '$lib/scene/cost';

	interface Props {
		runtime: SceneRuntime | null;
		res: number;
		/** the device scene target fps the budget is computed against */
		fps?: number;
	}
	let { runtime, res, fps = 30 }: Props = $props();

	const est = $derived(runtime ? estimateCost(runtime.program) : null);
	const cost = $derived(est ? costStatus(est, res, fps) : null);

	const tone = $derived(
		cost?.status === 'over'
			? 'border-red-500/40 bg-red-500/10 text-red-300'
			: cost?.status === 'warn'
				? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
				: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
	);
	const round = (n: number) => Math.round(n);
</script>

{#if est && cost}
	<Tooltip.Root>
		<Tooltip.Trigger
			class={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs ${tone}`}
		>
			≈ {round(cost.effective)} ops/px
		</Tooltip.Trigger>
		<Tooltip.Portal>
			<Tooltip.Content
				sideOffset={8}
				class="z-50 max-w-xs rounded-md border border-border bg-panel2 px-3 py-2 text-xs text-text shadow-xl"
			>
				<p class="mb-1 font-medium">Estimated shader cost</p>
				<ul class="space-y-0.5 text-muted">
					<li>per-pixel program: <span class="font-mono text-text">{round(est.perPixel)}</span> ops</li>
					<li>per-frame setup: <span class="font-mono text-text">{round(est.perFrame)}</span> ops</li>
					<li>
						budget @ {res}×{res} · {fps}fps:
						<span class="font-mono text-text">{round(cost.budget)}</span> ops/px
					</li>
				</ul>
				<p class="mt-2 text-muted">
					{#if cost.status === 'over'}
						Likely <span class="text-red-300">won't hold {fps}fps</span> on-device at this resolution.
						Lower <span class="font-mono">eval_res</span> or simplify the
						<span class="font-mono">pixel</span> block.
					{:else if cost.status === 'warn'}
						Getting close to the budget. Lowering <span class="font-mono">eval_res</span> buys
						proportional headroom.
					{:else}
						Comfortably within the per-pixel envelope.
					{/if}
				</p>
				<p class="mt-1.5 text-[10px] text-muted/70">
					Heuristic estimate (shader-vm.md cost model), not the real compiler.
				</p>
				<Tooltip.Arrow class="text-border" />
			</Tooltip.Content>
		</Tooltip.Portal>
	</Tooltip.Root>
{/if}
