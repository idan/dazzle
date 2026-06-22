<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>pixel64 — scene editor</title>
</svelte:head>

<Tooltip.Provider delayDuration={200}>
	{@render children()}
</Tooltip.Provider>
