<script lang="ts">
	import { Select } from 'bits-ui';

	interface Item {
		value: string;
		label: string;
	}
	interface Props {
		value: string;
		items: Item[];
		placeholder?: string;
		onValueChange?: (value: string) => void;
	}
	let { value = $bindable(), items, placeholder = 'Select…', onValueChange }: Props = $props();

	const selectedLabel = $derived(items.find((i) => i.value === value)?.label ?? placeholder);
</script>

<Select.Root type="single" bind:value {items} {onValueChange}>
	<Select.Trigger
		class="inline-flex h-8 min-w-40 items-center justify-between gap-2 rounded-md border border-border bg-panel2 px-3 text-sm text-text hover:border-[#3a3a44] focus:outline-none focus-visible:border-accent"
	>
		{selectedLabel}
		<span class="text-muted">▾</span>
	</Select.Trigger>
	<Select.Portal>
		<Select.Content
			sideOffset={6}
			class="z-50 max-h-72 min-w-(--bits-select-anchor-width) overflow-hidden rounded-md border border-border bg-panel2 shadow-xl"
		>
			<Select.Viewport class="p-1">
				{#each items as item (item.value)}
					<Select.Item
						value={item.value}
						label={item.label}
						class="flex cursor-pointer items-center rounded px-3 py-1.5 text-sm text-text outline-none data-highlighted:bg-[#23232c] data-[state=checked]:text-accent"
					>
						{#snippet children({ selected })}
							{item.label}
							{#if selected}<span class="ml-auto text-accent">✓</span>{/if}
						{/snippet}
					</Select.Item>
				{/each}
			</Select.Viewport>
		</Select.Content>
	</Select.Portal>
</Select.Root>
