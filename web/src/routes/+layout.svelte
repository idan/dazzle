<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>dazzle — scene editor</title>
</svelte:head>

<Tooltip.Provider delayDuration={200}>
	{@render children()}
</Tooltip.Provider>
