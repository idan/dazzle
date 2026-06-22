// Tree-walking interpreter for the shader language.
//
// This is the spike's preview VM. The locked architecture (docs/scenes/
// preview-and-parity.md) is "one shared Rust renderer compiled to WASM" — this
// TS interpreter is a stand-in so we can iterate on the *language* and the
// *editor loop* before committing the renderer to Rust. It honors the model
// that matters for authoring: the per-frame / per-pixel split, the built-in
// variables (t, frame, res, uv, st, xy), and premultiplied vec4 `color` output.

import type { Expr, Program, Stmt } from './ast';
import {
	add,
	asScalar,
	BUILTINS,
	div,
	fbm,
	isVec,
	makeVec,
	mul,
	neg,
	RuntimeError,
	sub,
	type Value
} from './builtins';

class Scope {
	vars = new Map<string, Value>();
	constructor(public parent: Scope | null = null) {}

	get(name: string): Value {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		let s: Scope | null = this;
		while (s) {
			const v = s.vars.get(name);
			if (v !== undefined) return v;
			s = s.parent;
		}
		throw new RuntimeError(`Undefined variable '${name}'`);
	}
	/** Assign to the nearest scope that defines `name`, else define here. */
	set(name: string, value: Value): void {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		let s: Scope | null = this;
		while (s) {
			if (s.vars.has(name)) {
				s.vars.set(name, value);
				return;
			}
			s = s.parent;
		}
		this.vars.set(name, value);
	}
	define(name: string, value: Value): void {
		this.vars.set(name, value);
	}
}

const SWIZZLE_INDEX: Record<string, number> = {
	x: 0,
	y: 1,
	z: 2,
	w: 3,
	r: 0,
	g: 1,
	b: 2,
	a: 3,
	s: 0,
	t: 1,
	p: 2,
	q: 3
};

export interface FrameGlobals {
	t: number;
	frame: number;
	res: [number, number];
}

export interface PixelCoords {
	uv: [number, number];
	st: [number, number];
	xy: [number, number];
}

export class SceneRuntime {
	private uniformDefaults = new Map<string, Value>();

	constructor(public program: Program) {
		// Evaluate uniform default expressions once, in an empty scope.
		const empty = new Scope();
		for (const u of program.uniforms) {
			if (u.default) {
				this.uniformDefaults.set(u.name, this.eval(u.default, empty));
			} else {
				// no default: zero scalar or zero vector matching the declared type
				const n = { float: 1, bool: 1, vec2: 2, vec3: 3, vec4: 4 }[u.type];
				this.uniformDefaults.set(u.name, n === 1 ? 0 : new Array(n).fill(0));
			}
		}
	}

	get uniformNames(): string[] {
		return this.program.uniforms.map((u) => u.name);
	}
	defaultUniform(name: string): Value {
		return this.uniformDefaults.get(name) ?? 0;
	}

	/** Run the `frame {}` block; returns a base scope (uniforms + frame-globals). */
	runFrame(globals: FrameGlobals, uniforms: Map<string, Value>): Scope {
		const base = new Scope();
		for (const u of this.program.uniforms) {
			base.define(u.name, uniforms.get(u.name) ?? this.defaultUniform(u.name));
		}
		base.define('t', globals.t);
		base.define('frame', globals.frame);
		base.define('res', [...globals.res]);
		// Run frame statements directly in `base` so top-level `var` decls become
		// frame-globals visible to the per-pixel block.
		for (const s of this.program.frame) this.execStmt(s, base);
		return base;
	}

	/** Run the `pixel {}` block for one pixel; returns its premultiplied [r,g,b,a]. */
	runPixel(base: Scope, px: PixelCoords): number[] {
		const scope = new Scope(base);
		scope.define('uv', [...px.uv]);
		scope.define('st', [...px.st]);
		scope.define('xy', [...px.xy]);
		scope.define('color', [0, 0, 0, 0]);
		// Run pixel statements directly in `scope` (sibling of `color`); `if`/`for`
		// bodies still get their own child scopes via execStmt.
		for (const s of this.program.pixel) this.execStmt(s, scope);
		const color = scope.get('color');
		if (!isVec(color) || color.length !== 4)
			throw new RuntimeError('`color` must be assigned a vec4');
		return color;
	}

	// ---- statements ----

	private execBlock(stmts: Stmt[], parent: Scope): void {
		const scope = new Scope(parent);
		for (const s of stmts) this.execStmt(s, scope);
	}

	private execStmt(s: Stmt, scope: Scope): void {
		switch (s.kind) {
			case 'var':
				scope.define(s.name, this.eval(s.init, scope));
				return;
			case 'assign': {
				const rhs = this.eval(s.value, scope);
				if (s.op === '=') {
					scope.set(s.name, rhs);
				} else {
					const cur = scope.get(s.name);
					const op = { '+=': add, '-=': sub, '*=': mul, '/=': div }[s.op]!;
					scope.set(s.name, op(cur, rhs));
				}
				return;
			}
			case 'if': {
				const cond = asScalar(this.eval(s.cond, scope), 'condition');
				if (cond !== 0) this.execBlock(s.then, scope);
				else if (s.else) this.execBlock(s.else, scope);
				return;
			}
			case 'for': {
				for (let i = s.from; i < s.to; i++) {
					const loopScope = new Scope(scope);
					loopScope.define(s.varName, i);
					for (const st of s.body) this.execStmt(st, loopScope);
				}
				return;
			}
			case 'expr':
				this.eval(s.expr, scope);
				return;
		}
	}

	// ---- expressions ----

	private eval(e: Expr, scope: Scope): Value {
		switch (e.kind) {
			case 'num':
				return e.value;
			case 'bool':
				return e.value ? 1 : 0;
			case 'ident':
				return scope.get(e.name);
			case 'unary': {
				const v = this.eval(e.expr, scope);
				if (e.op === '-') return neg(v);
				return asScalar(v) === 0 ? 1 : 0; // '!'
			}
			case 'logical': {
				const l = asScalar(this.eval(e.left, scope));
				if (e.op === '&&') return l === 0 ? 0 : asScalar(this.eval(e.right, scope)) !== 0 ? 1 : 0;
				return l !== 0 ? 1 : asScalar(this.eval(e.right, scope)) !== 0 ? 1 : 0;
			}
			case 'binary':
				return this.evalBinary(e.op, this.eval(e.left, scope), this.eval(e.right, scope));
			case 'ternary':
				return asScalar(this.eval(e.cond, scope), 'condition') !== 0
					? this.eval(e.then, scope)
					: this.eval(e.else, scope);
			case 'member':
				return this.evalSwizzle(this.eval(e.object, scope), e.swizzle);
			case 'call':
				return this.evalCall(e.name, e.args.map((a) => this.eval(a, scope)));
		}
	}

	private evalBinary(op: string, a: Value, b: Value): Value {
		switch (op) {
			case '+':
				return add(a, b);
			case '-':
				return sub(a, b);
			case '*':
				return mul(a, b);
			case '/':
				return div(a, b);
			case '%':
				return BUILTINS.mod([a, b]);
		}
		// comparisons — scalar only, yield 1.0/0.0
		const x = asScalar(a, 'comparison operand');
		const y = asScalar(b, 'comparison operand');
		const r =
			op === '<'
				? x < y
				: op === '<='
					? x <= y
					: op === '>'
						? x > y
						: op === '>='
							? x >= y
							: op === '=='
								? x === y
								: x !== y;
		return r ? 1 : 0;
	}

	private evalSwizzle(v: Value, swizzle: string): Value {
		if (!isVec(v)) throw new RuntimeError(`Cannot swizzle a scalar with '.${swizzle}'`);
		const out: number[] = [];
		for (const ch of swizzle) {
			const idx = SWIZZLE_INDEX[ch];
			if (idx === undefined) throw new RuntimeError(`Bad swizzle component '${ch}'`);
			if (idx >= v.length)
				throw new RuntimeError(`Swizzle '.${swizzle}' out of range for vec${v.length}`);
			out.push(v[idx]);
		}
		return out.length === 1 ? out[0] : out;
	}

	private evalCall(name: string, args: Value[]): Value {
		if (name === 'vec2') return makeVec(2, args);
		if (name === 'vec3') return makeVec(3, args);
		if (name === 'vec4') return makeVec(4, args);
		if (name === 'fbm') {
			const p = args[0];
			if (!isVec(p)) throw new RuntimeError('fbm() expects a vec2 or vec3 as first argument');
			return fbm(p, asScalar(args[1] ?? 4, 'octaves'));
		}
		const fn = BUILTINS[name];
		if (!fn) throw new RuntimeError(`Unknown function '${name}'`);
		return fn(args);
	}
}
