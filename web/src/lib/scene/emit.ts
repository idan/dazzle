// Bytecode compiler: lowers a parsed `Program` to the stack-VM bytecode the Rust
// renderer executes (renderer/src/vm.rs). This is the "Emit" stage from
// shader-language.md — it lowers vectors to scalar ops and inlines the prelude
// (length, palette, fbm, …) into primitive opcodes.
//
// Strategy: every expression compiles to a `Value` = an array of component
// "sources" (a constant-pool index, a uniform index, or a scratch slot). Scalar
// ops materialize results into fresh slots; vector ops just operate per
// component. The operand stack is only used transiently inside one scalar op, so
// we never have to juggle interleaved vector values on the stack.

import type { Expr, Program, Stmt, TypeName } from './ast';
import { FIRST_INPUT_UNIFORM, OP, UNIFORM } from './opcodes';

export class EmitError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'EmitError';
	}
}

type Source =
	| { k: 'const'; i: number }
	| { k: 'uniform'; i: number }
	| { k: 'slot'; i: number };
type Value = Source[]; // one source per vector component

interface Binding {
	type: TypeName;
	value: Value;
}

export interface UniformSlot {
	name: string;
	type: TypeName;
	index: number;
	width: number;
}

export interface CompiledBytecode {
	frame: Uint32Array;
	pixel: Uint32Array;
	constants: Float32Array;
	numSlots: number;
	uniforms: UniformSlot[];
	totalUniforms: number;
}

const widthOf = (t: TypeName): number =>
	t === 'vec4' ? 4 : t === 'vec3' ? 3 : t === 'vec2' ? 2 : 1;

const TAU = Math.PI * 2;
const COMPONENTWISE_UNARY: Record<string, number> = {
	abs: OP.ABS,
	floor: OP.FLOOR,
	ceil: OP.CEIL,
	fract: OP.FRACT,
	sign: OP.SIGN,
	sqrt: OP.SQRT,
	sin: OP.SIN,
	cos: OP.COS,
	tan: OP.TAN,
	exp: OP.EXP,
	log: OP.LOG
};

class Emitter {
	private instr: number[] = [];
	private constants: number[] = [];
	private constMap = new Map<number, number>();
	private nextSlot = 4; // slots 0..3 reserved for `color`
	private env = new Map<string, Binding>();
	private uniformLayout: UniformSlot[] = [];
	private totalUniforms = FIRST_INPUT_UNIFORM;

	constructor(private program: Program) {}

	compile(): CompiledBytecode {
		// bound inputs → uniform indices 10..
		for (const u of this.program.uniforms) {
			const width = widthOf(u.type);
			const index = this.totalUniforms;
			this.uniformLayout.push({ name: u.name, type: u.type, index, width });
			this.env.set(u.name, { type: u.type, value: this.uniformRange(index, width) });
			this.totalUniforms += width;
		}
		// built-in variables
		this.env.set('t', { type: 'float', value: this.uniformRange(UNIFORM.t, 1) });
		this.env.set('frame', { type: 'float', value: this.uniformRange(UNIFORM.frame, 1) });
		this.env.set('res', { type: 'vec2', value: this.uniformRange(UNIFORM.resX, 2) });
		this.env.set('xy', { type: 'vec2', value: this.uniformRange(UNIFORM.x, 2) });
		this.env.set('uv', { type: 'vec2', value: this.uniformRange(UNIFORM.uvX, 2) });
		this.env.set('st', { type: 'vec2', value: this.uniformRange(UNIFORM.stX, 2) });
		// color → reserved slots 0..3
		this.env.set('color', {
			type: 'vec4',
			value: [0, 1, 2, 3].map((i) => ({ k: 'slot', i }) as Source)
		});

		// per-frame block
		this.instr = [];
		for (const s of this.program.frame) this.stmt(s);
		this.emit(OP.END);
		const frame = Uint32Array.from(this.instr);

		// per-pixel block
		this.instr = [];
		for (const s of this.program.pixel) this.stmt(s);
		// epilogue: write color slots to output
		for (let c = 0; c < 4; c++) {
			this.emit(OP.LOAD_SLOT, c);
			this.emit(OP.STORE_OUT, c);
		}
		this.emit(OP.END);
		const pixel = Uint32Array.from(this.instr);

		return {
			frame,
			pixel,
			constants: Float32Array.from(this.constants),
			numSlots: this.nextSlot,
			uniforms: this.uniformLayout,
			totalUniforms: this.totalUniforms
		};
	}

	// ---- low-level emit helpers ----

	private emit(op: number, arg = 0): void {
		this.instr.push(op, arg);
	}
	private constIdx(v: number): number {
		let i = this.constMap.get(v);
		if (i === undefined) {
			i = this.constants.length;
			this.constants.push(v);
			this.constMap.set(v, i);
		}
		return i;
	}
	private constSrc(v: number): Source {
		return { k: 'const', i: this.constIdx(v) };
	}
	private uniformRange(start: number, width: number): Value {
		return Array.from({ length: width }, (_, k) => ({ k: 'uniform', i: start + k }) as Source);
	}
	private allocSlot(): number {
		return this.nextSlot++;
	}
	private load(s: Source): void {
		if (s.k === 'const') this.emit(OP.PUSH_CONST, s.i);
		else if (s.k === 'uniform') this.emit(OP.LOAD_UNIFORM, s.i);
		else this.emit(OP.LOAD_SLOT, s.i);
	}
	/** Materialize whatever is on top of the stack into a fresh slot. */
	private storeNew(): Source {
		const i = this.allocSlot();
		this.emit(OP.STORE_SLOT, i);
		return { k: 'slot', i };
	}
	private broadcast(v: Value, i: number): Source {
		return v.length === 1 ? v[0] : v[i];
	}

	// ---- statements ----

	private stmt(s: Stmt): void {
		switch (s.kind) {
			case 'var': {
				const v = this.expr(s.init);
				const slots: Value = [];
				for (let i = 0; i < v.length; i++) {
					this.load(v[i]);
					slots.push(this.storeNew());
				}
				this.env.set(s.name, { type: s.type, value: slots });
				return;
			}
			case 'assign': {
				const target = this.env.get(s.name);
				if (!target) throw new EmitError(`Assignment to undeclared '${s.name}'`);
				if (target.value.some((c) => c.k !== 'slot'))
					throw new EmitError(`Cannot assign to '${s.name}' (not a writable variable)`);
				const v = this.expr(s.value);
				const op = { '+=': OP.ADD, '-=': OP.SUB, '*=': OP.MUL, '/=': OP.DIV }[s.op];
				for (let i = 0; i < target.value.length; i++) {
					const dest = target.value[i] as { k: 'slot'; i: number };
					if (op !== undefined) {
						this.load(dest);
						this.load(this.broadcast(v, i));
						this.emit(op);
					} else {
						this.load(this.broadcast(v, i));
					}
					this.emit(OP.STORE_SLOT, dest.i);
				}
				return;
			}
			case 'if': {
				this.load(this.expr(s.cond)[0]);
				this.emit(OP.JMP_IF_ZERO, 0);
				const elsePatch = this.instr.length - 1;
				for (const st of s.then) this.stmt(st);
				this.emit(OP.JMP, 0);
				const endPatch = this.instr.length - 1;
				this.instr[elsePatch] = this.instr.length;
				if (s.else) for (const st of s.else) this.stmt(st);
				this.instr[endPatch] = this.instr.length;
				return;
			}
			case 'for': {
				for (let i = s.from; i < s.to; i++) {
					this.env.set(s.varName, { type: 'float', value: [this.constSrc(i)] });
					for (const st of s.body) this.stmt(st);
				}
				return;
			}
			case 'expr':
				this.expr(s.expr);
				return;
		}
	}

	// ---- expressions → Value ----

	private expr(e: Expr): Value {
		switch (e.kind) {
			case 'num':
				return [this.constSrc(e.value)];
			case 'bool':
				return [this.constSrc(e.value ? 1 : 0)];
			case 'ident': {
				const b = this.env.get(e.name);
				if (!b) throw new EmitError(`Undefined variable '${e.name}'`);
				return b.value;
			}
			case 'member': {
				const base = this.expr(e.object);
				const idx: Record<string, number> = {
					x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3, s: 0, t: 1, p: 2, q: 3
				};
				return [...e.swizzle].map((ch) => {
					const k = idx[ch];
					if (k === undefined || k >= base.length)
						throw new EmitError(`Bad swizzle '.${e.swizzle}'`);
					return base[k];
				});
			}
			case 'unary': {
				const v = this.expr(e.expr);
				if (e.op === '!') {
					this.load(v[0]);
					this.emit(OP.NOT);
					return [this.storeNew()];
				}
				return v.map((c) => {
					this.load(c);
					this.emit(OP.NEG);
					return this.storeNew();
				});
			}
			case 'binary':
				return this.binary(e.op, e.left, e.right);
			case 'logical': {
				this.load(this.expr(e.left)[0]);
				this.load(this.expr(e.right)[0]);
				this.emit(e.op === '&&' ? OP.AND : OP.OR);
				return [this.storeNew()];
			}
			case 'ternary': {
				const cond = this.expr(e.cond)[0];
				const a = this.expr(e.then);
				const b = this.expr(e.else);
				const n = Math.max(a.length, b.length);
				const out: Value = [];
				for (let i = 0; i < n; i++) {
					this.load(this.broadcast(a, i));
					this.load(this.broadcast(b, i));
					this.load(cond);
					this.emit(OP.SELECT);
					out.push(this.storeNew());
				}
				return out;
			}
			case 'call':
				return this.call(e.name, e.args);
		}
	}

	private binary(op: string, leftE: Expr, rightE: Expr): Value {
		const cmp: Record<string, number> = {
			'<': OP.LT, '>': OP.GT, '<=': OP.LE, '>=': OP.GE, '==': OP.EQ, '!=': OP.NE
		};
		const l = this.expr(leftE);
		const r = this.expr(rightE);
		if (op in cmp) {
			this.load(l[0]);
			this.load(r[0]);
			this.emit(cmp[op]);
			return [this.storeNew()];
		}
		const arith: Record<string, number> = {
			'+': OP.ADD, '-': OP.SUB, '*': OP.MUL, '/': OP.DIV, '%': OP.MOD
		};
		const code = arith[op];
		if (code === undefined) throw new EmitError(`Unsupported operator '${op}'`);
		const n = Math.max(l.length, r.length);
		const out: Value = [];
		for (let i = 0; i < n; i++) {
			this.load(this.broadcast(l, i));
			this.load(this.broadcast(r, i));
			this.emit(code);
			out.push(this.storeNew());
		}
		return out;
	}

	// ---- calls: constructors, prelude, builtins ----

	private call(name: string, args: Expr[]): Value {
		if (name === 'vec2' || name === 'vec3' || name === 'vec4') {
			const n = widthOf(name as TypeName);
			const parts = args.map((a) => this.expr(a));
			if (parts.length === 1 && parts[0].length === 1) {
				return Array.from({ length: n }, () => parts[0][0]); // splat
			}
			const flat = parts.flat();
			if (flat.length !== n) throw new EmitError(`${name}() needs ${n} components, got ${flat.length}`);
			return flat;
		}
		if (name === 'float') return [this.expr(args[0])[0]];

		if (name in COMPONENTWISE_UNARY) {
			const v = this.expr(args[0]);
			return v.map((c) => {
				this.load(c);
				this.emit(COMPONENTWISE_UNARY[name]);
				return this.storeNew();
			});
		}
		if (name === 'radians' || name === 'degrees') {
			const k = name === 'radians' ? Math.PI / 180 : 180 / Math.PI;
			return this.expr(args[0]).map((c) => {
				this.load(c);
				this.load(this.constSrc(k));
				this.emit(OP.MUL);
				return this.storeNew();
			});
		}
		if (name === 'atan') {
			if (args.length === 2) {
				this.load(this.expr(args[0])[0]);
				this.load(this.expr(args[1])[0]);
				this.emit(OP.ATAN2);
				return [this.storeNew()];
			}
			return this.expr(args[0]).map((c) => {
				this.load(c);
				this.load(this.constSrc(1));
				this.emit(OP.ATAN2);
				return this.storeNew();
			});
		}

		// componentwise binary/ternary with broadcasting
		const binBuiltin: Record<string, number> = {
			min: OP.MIN, max: OP.MAX, mod: OP.MOD, pow: OP.POW, step: OP.STEP
		};
		if (name in binBuiltin) return this.componentwise(binBuiltin[name], args, 2);
		if (name === 'clamp') return this.componentwise(OP.CLAMP, args, 3);
		if (name === 'mix') return this.componentwise(OP.MIX, args, 3);
		if (name === 'smoothstep') return this.componentwise(OP.SMOOTHSTEP, args, 3);

		switch (name) {
			case 'length':
				return [this.sumSquares(this.expr(args[0]), true)];
			case 'distance': {
				const a = this.expr(args[0]);
				const b = this.expr(args[1]);
				return [this.sumSquaresDiff(a, b)];
			}
			case 'dot':
				return [this.dot(this.expr(args[0]), this.expr(args[1]))];
			case 'normalize': {
				const v = this.expr(args[0]);
				const len = this.sumSquares(v, true);
				return v.map((c) => {
					this.load(c);
					this.load(len);
					this.emit(OP.DIV);
					return this.storeNew();
				});
			}
			case 'cross':
				return this.cross(this.expr(args[0]), this.expr(args[1]));
			case 'hash':
				this.load(this.expr(args[0])[0]);
				this.emit(OP.HASH);
				return [this.storeNew()];
			case 'noise':
				return [this.noise(this.expr(args[0]))];
			case 'fbm':
				return [this.fbm(args)];
			case 'palette':
				return this.palette(args);
			case 'hsv':
				return this.hsv(args);
		}
		throw new EmitError(`Builtin '${name}' is not supported in the bytecode path yet`);
	}

	private componentwise(op: number, args: Expr[], arity: number): Value {
		const vs = args.slice(0, arity).map((a) => this.expr(a));
		const n = Math.max(...vs.map((v) => v.length));
		const out: Value = [];
		for (let i = 0; i < n; i++) {
			for (const v of vs) this.load(this.broadcast(v, i));
			this.emit(op);
			out.push(this.storeNew());
		}
		return out;
	}

	/** sum(v_i^2), optionally sqrt → length. Leaves nothing on the stack. */
	private sumSquares(v: Value, sqrt: boolean): Source {
		for (let i = 0; i < v.length; i++) {
			this.load(v[i]);
			this.emit(OP.DUP);
			this.emit(OP.MUL);
			if (i > 0) this.emit(OP.ADD);
		}
		if (sqrt) this.emit(OP.SQRT);
		return this.storeNew();
	}
	private sumSquaresDiff(a: Value, b: Value): Source {
		const n = Math.max(a.length, b.length);
		for (let i = 0; i < n; i++) {
			this.load(this.broadcast(a, i));
			this.load(this.broadcast(b, i));
			this.emit(OP.SUB);
			this.emit(OP.DUP);
			this.emit(OP.MUL);
			if (i > 0) this.emit(OP.ADD);
		}
		this.emit(OP.SQRT);
		return this.storeNew();
	}
	private dot(a: Value, b: Value): Source {
		const n = Math.max(a.length, b.length);
		for (let i = 0; i < n; i++) {
			this.load(this.broadcast(a, i));
			this.load(this.broadcast(b, i));
			this.emit(OP.MUL);
			if (i > 0) this.emit(OP.ADD);
		}
		return this.storeNew();
	}
	private cross(a: Value, b: Value): Value {
		const term = (p: number, q: number, r: number, s: number) => {
			this.load(a[p]); this.load(b[q]); this.emit(OP.MUL);
			this.load(a[r]); this.load(b[s]); this.emit(OP.MUL);
			this.emit(OP.SUB);
			return this.storeNew();
		};
		return [term(1, 2, 2, 1), term(2, 0, 0, 2), term(0, 1, 1, 0)];
	}
	private noise(p: Value): Source {
		for (const c of p) this.load(c);
		this.emit(p.length === 3 ? OP.NOISE3 : OP.NOISE2);
		return this.storeNew();
	}
	private fbm(args: Expr[]): Source {
		const p = this.expr(args[0]);
		const octArg = args[1];
		const octaves = octArg?.kind === 'num' ? Math.max(1, Math.floor(octArg.value)) : 4;
		let acc: Source | null = null;
		for (let k = 0; k < octaves; k++) {
			const scale = 2 ** k;
			const amp = 0.5 ** (k + 1);
			// noise(p * scale)
			for (const c of p) {
				this.load(c);
				this.load(this.constSrc(scale));
				this.emit(OP.MUL);
			}
			this.emit(p.length === 3 ? OP.NOISE3 : OP.NOISE2);
			this.load(this.constSrc(amp));
			this.emit(OP.MUL);
			if (acc) {
				this.load(acc);
				this.emit(OP.ADD);
			}
			acc = this.storeNew();
		}
		return acc!;
	}
	private palette(args: Expr[]): Value {
		const t = this.expr(args[0])[0];
		const def = (e: Expr | undefined, d: number[]): Value =>
			e ? this.expr(e) : d.map((x) => this.constSrc(x));
		const a = def(args[1], [0.5, 0.5, 0.5]);
		const b = def(args[2], [0.5, 0.5, 0.5]);
		const c = def(args[3], [1, 1, 1]);
		const d = def(args[4], [0, 0.33, 0.67]);
		// a + b*cos(TAU*(c*t + d))
		return [0, 1, 2].map((i) => {
			this.load(c[i]); this.load(t); this.emit(OP.MUL);
			this.load(d[i]); this.emit(OP.ADD);
			this.load(this.constSrc(TAU)); this.emit(OP.MUL);
			this.emit(OP.COS);
			this.load(b[i]); this.emit(OP.MUL);
			this.load(a[i]); this.emit(OP.ADD);
			return this.storeNew();
		});
	}
	private hsv(args: Expr[]): Value {
		const h = this.expr(args[0])[0];
		const s = this.expr(args[1])[0];
		const v = this.expr(args[2])[0];
		const offs = [1.0, 2 / 3, 1 / 3];
		// branchless hsv→rgb: p=abs(fract(h+off)*6-3); c=clamp(p-1,0,1); rgb=v*(1+(c-1)*s)
		return offs.map((off) => {
			this.load(h); this.load(this.constSrc(off)); this.emit(OP.ADD);
			this.emit(OP.FRACT);
			this.load(this.constSrc(6)); this.emit(OP.MUL);
			this.load(this.constSrc(3)); this.emit(OP.SUB);
			this.emit(OP.ABS);
			this.load(this.constSrc(1)); this.emit(OP.SUB);
			this.load(this.constSrc(0)); this.load(this.constSrc(1)); this.emit(OP.CLAMP); // c
			this.load(this.constSrc(1)); this.emit(OP.SUB); // c-1
			this.load(s); this.emit(OP.MUL); // (c-1)*s
			this.load(this.constSrc(1)); this.emit(OP.ADD); // 1+(c-1)*s
			this.load(v); this.emit(OP.MUL); // *v
			return this.storeNew();
		});
	}
}

export function emitBytecode(program: Program): CompiledBytecode {
	return new Emitter(program).compile();
}
