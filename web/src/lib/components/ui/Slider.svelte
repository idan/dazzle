<script lang="ts">
	import { Slider } from 'bits-ui';

	interface Props {
		value: number;
		min?: number;
		max?: number;
		step?: number;
		class?: string;
		onValueChange?: (value: number) => void;
	}
	let {
		value = $bindable(),
		min = 0,
		max = 1,
		step = 0.01,
		class: cls = '',
		onValueChange
	}: Props = $props();
</script>

<Slider.Root
	type="single"
	bind:value
	{min}
	{max}
	{step}
	{onValueChange}
	class={`relative flex min-w-0 flex-1 touch-none items-center select-none ${cls}`}
>
	{#snippet children({ thumbs })}
		<span class="relative h-1.5 w-full grow overflow-hidden rounded-full bg-[#26262f]">
			<Slider.Range class="absolute h-full bg-accent" />
		</span>
		{#each thumbs as index (index)}
			<Slider.Thumb
				{index}
				class="block size-3.5 rounded-full border border-accent bg-text shadow transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
			/>
		{/each}
	{/snippet}
</Slider.Root>
