// Static cost estimator — the editor's "budget warning" (preview-and-parity.md,
// shader-vm.md § Cost model). It walks the AST and estimates worst-case
// **opcodes per pixel**, then compares that to the device's per-pixel envelope so
// you can catch "too expensive to hold fps" before pushing to hardware.
//
// Because the device lowers vectors to N scalar ops, opcode count depends on
// vector width — so we do a lightweight type inference alongside the walk. The
// numbers are deliberately approximate (a heuristic, not the real compiler); they
// exist to flag the right order of magnitude.

import type { Expr, Program, Stmt, TypeName } from './ast';

type Env = Map<string, TypeName>;

const widthOf = (t: TypeName): number =>
	t === 'vec4' ? 4 : t === 'vec3' ? 3 : t === 'vec2' ? 2 : 1;
const vecType = (n: number): TypeName =>
	n >= 4 ? 'vec4' : n === 3 ? 'vec3' : n === 2 ? 'vec2' : 'float';

// --- type inference (just enough to know vector widths) ---

function inferType(e: Expr, env: Env): TypeName {
	switch (e.kind) {
		case 'num':
			return 'float';
		case 'bool':
			return 'bool';
		case 'ident':
			return env.get(e.name) ?? 'float';
		case 'member':
			return vecType(e.swizzle.length);
		case 'unary':
			return e.op === '!' ? 'bool' : inferType(e.expr, env);
		case 'logical':
			return 'bool';
		case 'binary':
			if (['<', '<=', '>', '>=', '==', '!='].includes(e.op)) return 'bool';
			// arithmetic broadcasts to the wider operand
			return vecType(Math.max(widthOf(inferType(e.left, env)), widthOf(inferType(e.right, env))));
		case 'ternary':
			return inferType(e.then, env);
		case 'call':
			return inferCall(e.name, e.args, env);
	}
}

function inferCall(name: string, args: Expr[], env: Env): TypeName {
	const a0 = () => inferType(args[0], env);
	switch (name) {
		case 'vec2':
			return 'vec2';
		case 'vec3':
			return 'vec3';
		case 'vec4':
			return 'vec4';
		case 'float':
		case 'length':
		case 'distance':
		case 'dot':
		case 'hash':
		case 'noise':
		case 'fbm':
			return 'float';
		case 'cross':
		case 'hsv':
		case 'palette':
			return 'vec3';
		case 'atan':
			return args.length === 2 ? 'float' : a0();
		default:
			// component-wise math + normalize keep the first arg's shape
			return args.length ? a0() : 'float';
	}
}

// --- opcode cost of an expression ---

function costExpr(e: Expr, env: Env): number {
	switch (e.kind) {
		case 'num':
		case 'bool':
			return 1;
		case 'ident':
			return widthOf(inferType(e, env));
		case 'member':
			return costExpr(e.object, env) + e.swizzle.length;
		case 'unary':
			return costExpr(e.expr, env) + (e.op === '!' ? 1 : widthOf(inferType(e, env)));
		case 'logical':
			return costExpr(e.left, env) + costExpr(e.right, env) + 1;
		case 'binary': {
			const base = costExpr(e.left, env) + costExpr(e.right, env);
			const isCmp = ['<', '<=', '>', '>=', '==', '!='].includes(e.op);
			return base + (isCmp ? 1 : widthOf(inferType(e, env)));
		}
		case 'ternary':
			return (
				costExpr(e.cond, env) + 1 + Math.max(costExpr(e.then, env), costExpr(e.else, env))
			);
		case 'call': {
			const argsCost = e.args.reduce((s, a) => s + costExpr(a, env), 0);
			return argsCost + builtinWeight(e.name, e.args, env);
		}
	}
}

// Approximate opcode weight of a built-in, accounting for vector width and the
// prelude functions that lower to several primitives.
function builtinWeight(name: string, args: Expr[], env: Env): number {
	const w0 = args.length ? widthOf(inferType(args[0], env)) : 1;
	switch (name) {
		case 'vec2':
		case 'vec3':
		case 'vec4':
			return 0; // assembly only; component values already counted
		case 'float':
			return 1;
		case 'clamp':
			return 2 * w0;
		case 'mix':
			return 3 * w0;
		case 'smoothstep':
			return 6 * w0;
		case 'length':
		case 'dot':
			return 2 * w0;
		case 'distance':
		case 'normalize':
			return 3 * w0;
		case 'cross':
			return 9;
		case 'hsv':
			return 15;
		case 'palette':
			return 20;
		case 'hash':
			return 5;
		case 'noise':
			return w0 === 3 ? 40 : 20;
		case 'fbm': {
			const octaves = args[1]?.kind === 'num' ? Math.max(1, Math.floor(args[1].value)) : 4;
			const noiseW = w0 === 3 ? 40 : 20;
			return octaves * (noiseW + 5);
		}
		case 'atan':
			return args.length === 2 ? 1 : w0;
		default:
			// component-wise math (abs, sin, min, pow, step, …): one op per component
			return w0;
	}
}

// --- statements ---

function costStmt(s: Stmt, env: Env): number {
	switch (s.kind) {
		case 'var': {
			const c = costExpr(s.init, env) + widthOf(s.type);
			env.set(s.name, s.type);
			return c;
		}
		case 'assign': {
			const w = widthOf(env.get(s.name) ?? 'float');
			// store (w) + the arithmetic for a compound assign
			return costExpr(s.value, env) + w + (s.op === '=' ? 0 : w);
		}
		case 'if':
			return (
				costExpr(s.cond, env) +
				1 +
				Math.max(costStmts(s.then, env), s.else ? costStmts(s.else, env) : 0)
			);
		case 'for': {
			const trips = Math.max(0, s.to - s.from);
			env.set(s.varName, 'float');
			return costStmts(s.body, env) * trips; // loops are unrolled
		}
		case 'expr':
			return costExpr(s.expr, env);
	}
}

function costStmts(stmts: Stmt[], env: Env): number {
	return stmts.reduce((sum, s) => sum + costStmt(s, env), 0);
}

// --- public API ---

export interface CostEstimate {
	perPixel: number;
	perFrame: number;
}

export function estimateCost(program: Program): CostEstimate {
	const frameEnv: Env = new Map([
		['t', 'float'],
		['frame', 'float'],
		['res', 'vec2']
	]);
	for (const u of program.uniforms) frameEnv.set(u.name, u.type);

	const perFrame = costStmts(program.frame, frameEnv); // frameEnv now holds frame-globals

	const pixelEnv: Env = new Map(frameEnv);
	pixelEnv.set('uv', 'vec2');
	pixelEnv.set('st', 'vec2');
	pixelEnv.set('xy', 'vec2');
	pixelEnv.set('color', 'vec4');
	const perPixel = costStmts(program.pixel, pixelEnv);

	return { perPixel, perFrame };
}

// Device envelope: shader-vm.md cites ~50–100 opcodes/pixel at 64×64 @ 30 fps.
// We anchor a reference and scale: lower eval_res or fps buys proportional room.
const REF_OPS = 75;
const REF_PX_PER_SEC = 64 * 64 * 30;
const OPS_PER_SEC = REF_OPS * REF_PX_PER_SEC;

export function opsBudgetPerPixel(res: number, fps: number): number {
	return OPS_PER_SEC / (res * res * fps);
}

export type CostStatus = 'ok' | 'warn' | 'over';

/** Effective per-pixel cost (folds in amortized per-frame work) vs. the budget. */
export function costStatus(
	est: CostEstimate,
	res: number,
	fps: number
): { status: CostStatus; effective: number; budget: number; ratio: number } {
	const effective = est.perPixel + est.perFrame / (res * res);
	const budget = opsBudgetPerPixel(res, fps);
	const ratio = effective / budget;
	const status: CostStatus = ratio <= 0.8 ? 'ok' : ratio <= 1.4 ? 'warn' : 'over';
	return { status, effective, budget, ratio };
}
