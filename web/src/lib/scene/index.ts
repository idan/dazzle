// Public API for the shader scene engine (the spike's preview VM).
//
// compile(src) → parse + build a SceneRuntime, reporting errors with line/col.
// renderFrame() drives one frame. See sibling docs in /docs/scenes.

import type { TypeName } from './ast';
import { parse, ParseError } from './parser';
import { SceneRuntime } from './interpreter';

export { renderFrame, type RenderResult } from './renderer';
export { SceneRuntime } from './interpreter';
export type { Value } from './builtins';

export interface UniformInfo {
	name: string;
	type: TypeName;
	default: number | number[];
}

export interface CompileError {
	message: string;
	line?: number;
	col?: number;
}

export type CompileResult =
	| { ok: true; runtime: SceneRuntime; uniforms: UniformInfo[] }
	| { ok: false; error: CompileError };

export function compile(src: string): CompileResult {
	try {
		const program = parse(src);
		const runtime = new SceneRuntime(program);
		const uniforms: UniformInfo[] = program.uniforms.map((u) => ({
			name: u.name,
			type: u.type,
			default: runtime.defaultUniform(u.name)
		}));
		return { ok: true, runtime, uniforms };
	} catch (e) {
		if (e instanceof ParseError) {
			return { ok: false, error: { message: e.message, line: e.line, col: e.col } };
		}
		return { ok: false, error: { message: e instanceof Error ? e.message : String(e) } };
	}
}
