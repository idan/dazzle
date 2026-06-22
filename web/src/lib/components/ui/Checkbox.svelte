<script lang="ts">
	import { Checkbox } from 'bits-ui';

	interface Props {
		checked: boolean;
		label?: string;
		onCheckedChange?: (checked: boolean) => void;
	}
	let { checked = $bindable(), label, onCheckedChange }: Props = $props();
</script>

<label class="inline-flex cursor-pointer items-center gap-2 text-xs text-muted select-none">
	<Checkbox.Root
		bind:checked
		{onCheckedChange}
		class="flex size-4 items-center justify-center rounded border border-border bg-panel2 data-[state=checked]:border-accent data-[state=checked]:bg-accent"
	>
		{#snippet children({ checked: isChecked })}
			{#if isChecked}
				<svg viewBox="0 0 16 16" class="size-3 text-[#0d0d11]" fill="none" stroke="currentColor" stroke-width="2.5">
					<path d="M3.5 8.5l3 3 6-7" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			{/if}
		{/snippet}
	</Checkbox.Root>
	{#if label}<span>{label}</span>{/if}
</label>
