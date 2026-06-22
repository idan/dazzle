<script lang="ts">
	import { onMount } from 'svelte';
	import { EditorView, keymap } from '@codemirror/view';
	import { EditorState } from '@codemirror/state';
	import { basicSetup } from 'codemirror';
	import { indentWithTab } from '@codemirror/commands';
	import { lintGutter } from '@codemirror/lint';
	import { shaderSupport, shaderHighlighting, shaderLinter } from '$lib/scene/editor-lang';

	interface Props {
		value: string;
	}
	let { value = $bindable() }: Props = $props();

	let host: HTMLDivElement;
	let view: EditorView | undefined;

	const theme = EditorView.theme(
		{
			'&': { height: '100%', backgroundColor: '#0b0b0f', color: '#e6e6ee' },
			'.cm-scroller': {
				fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
				fontSize: '13px',
				lineHeight: '1.55'
			},
			'.cm-content': { padding: '10px 0' },
			'&.cm-focused': { outline: 'none' },
			'.cm-gutters': { backgroundColor: '#0b0b0f', color: '#41414c', border: 'none' },
			'.cm-activeLineGutter': { backgroundColor: '#16161c', color: '#9a9aa8' },
			'.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.025)' },
			'.cm-cursor': { borderLeftColor: '#e6e6ee' },
			'.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
				backgroundColor: '#264f78'
			}
		},
		{ dark: true }
	);

	onMount(() => {
		view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: value,
				extensions: [
					keymap.of([indentWithTab]),
					basicSetup,
					shaderSupport,
					shaderHighlighting,
					shaderLinter,
					lintGutter(),
					theme,
					EditorView.updateListener.of((u) => {
						if (u.docChanged) {
							const next = u.state.doc.toString();
							if (next !== value) value = next;
						}
					})
				]
			})
		});
		return () => view?.destroy();
	});

	// Push external edits (load example / reset) into the editor.
	$effect(() => {
		if (view && value !== view.state.doc.toString()) {
			view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
		}
	});
</script>

<div class="cm-host" bind:this={host}></div>

<style>
	.cm-host {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}
</style>
