// Recursive-descent parser for the shader language. Produces an AST `Program`
// of a `frame {}` block (optional) and a `pixel {}` block (required), plus any
// top-level `uniform` declarations. See docs/scenes/shader-language.md.

import { lex, type Token, LexError } from './lexer';
import type { Expr, Program, Stmt, TypeName, UniformDecl } from './ast';

const TYPE_NAMES = new Set(['float', 'vec2', 'vec3', 'vec4', 'bool']);

export class ParseError extends Error {
	constructor(
		message: string,
		public line: number,
		public col: number
	) {
		super(message);
		this.name = 'ParseError';
	}
}

class Parser {
	private toks: Token[];
	private p = 0;

	constructor(src: string) {
		this.toks = lex(src);
	}

	private peek(o = 0): Token {
		return this.toks[Math.min(this.p + o, this.toks.length - 1)];
	}
	private next(): Token {
		return this.toks[this.p++];
	}
	private err(msg: string, tok = this.peek()): never {
		throw new ParseError(msg, tok.line, tok.col);
	}
	private check(value: string): boolean {
		const t = this.peek();
		return (t.type === 'op' || t.type === 'keyword') && t.value === value;
	}
	private accept(value: string): boolean {
		if (this.check(value)) {
			this.p++;
			return true;
		}
		return false;
	}
	private expect(value: string): Token {
		if (!this.check(value)) this.err(`Expected '${value}' but found '${this.peek().value}'`);
		return this.next();
	}

	parseProgram(): Program {
		const uniforms: UniformDecl[] = [];
		let frame: Stmt[] = [];
		let pixel: Stmt[] | null = null;

		while (this.peek().type !== 'eof') {
			if (this.check('uniform')) {
				uniforms.push(this.parseUniform());
			} else if (this.check('frame')) {
				this.next();
				frame = this.parseBlock();
			} else if (this.check('pixel')) {
				this.next();
				pixel = this.parseBlock();
			} else {
				this.err(`Expected 'uniform', 'frame', or 'pixel' at top level, found '${this.peek().value}'`);
			}
		}

		if (pixel === null) this.err('Program must contain a `pixel { }` block.');
		return { uniforms, frame, pixel };
	}

	private parseUniform(): UniformDecl {
		this.expect('uniform');
		const type = this.parseType();
		const nameTok = this.next();
		if (nameTok.type !== 'ident') this.err('Expected uniform name', nameTok);
		let def: Expr | null = null;
		if (this.accept('=')) def = this.parseExpr();
		this.expect(';');
		return { name: nameTok.value, type, default: def };
	}

	private parseType(): TypeName {
		const t = this.peek();
		if (t.type === 'keyword' && TYPE_NAMES.has(t.value)) {
			this.next();
			return t.value as TypeName;
		}
		this.err(`Expected a type name, found '${t.value}'`);
	}

	private parseBlock(): Stmt[] {
		this.expect('{');
		const stmts: Stmt[] = [];
		while (!this.check('}') && this.peek().type !== 'eof') {
			stmts.push(this.parseStatement());
		}
		this.expect('}');
		return stmts;
	}

	private parseStatement(): Stmt {
		// typed variable declaration
		const t = this.peek();
		if (t.type === 'keyword' && TYPE_NAMES.has(t.value)) {
			const type = this.parseType();
			const nameTok = this.next();
			if (nameTok.type !== 'ident') this.err('Expected variable name', nameTok);
			this.expect('=');
			const init = this.parseExpr();
			this.expect(';');
			return { kind: 'var', type, name: nameTok.value, init };
		}

		if (this.check('if')) return this.parseIf();
		if (this.check('for')) return this.parseFor();

		// assignment:  IDENT (= | += | -= | *= | /=) expr ;
		if (t.type === 'ident') {
			const op = this.peek(1);
			if (op.type === 'op' && ['=', '+=', '-=', '*=', '/='].includes(op.value)) {
				const nameTok = this.next();
				const opTok = this.next();
				const value = this.parseExpr();
				this.expect(';');
				return { kind: 'assign', name: nameTok.value, op: opTok.value, value, pos: nameTok.pos };
			}
		}

		// bare expression statement (rare, but keeps the grammar total)
		const expr = this.parseExpr();
		this.expect(';');
		return { kind: 'expr', expr };
	}

	private parseIf(): Stmt {
		this.expect('if');
		this.expect('(');
		const cond = this.parseExpr();
		this.expect(')');
		const then = this.parseBlock();
		let els: Stmt[] | null = null;
		if (this.accept('else')) {
			els = this.check('if') ? [this.parseIf()] : this.parseBlock();
		}
		return { kind: 'if', cond, then, else: els };
	}

	private parseFor(): Stmt {
		// for (i in 0..8) { ... }  — compile-time-constant integer bounds only
		this.expect('for');
		this.expect('(');
		const varTok = this.next();
		if (varTok.type !== 'ident') this.err('Expected loop variable', varTok);
		this.expect('in');
		const from = this.parseIntLiteral();
		this.expect('..');
		const to = this.parseIntLiteral();
		this.expect(')');
		const body = this.parseBlock();
		return { kind: 'for', varName: varTok.value, from, to, body };
	}

	private parseIntLiteral(): number {
		let sign = 1;
		if (this.accept('-')) sign = -1;
		const t = this.next();
		if (t.type !== 'number') this.err('for-loop bounds must be integer literals', t);
		const n = Number(t.value);
		if (!Number.isInteger(n)) this.err('for-loop bounds must be integers', t);
		return sign * n;
	}

	// ---- expressions (precedence climbing) ----

	private parseExpr(): Expr {
		return this.parseTernary();
	}

	private parseTernary(): Expr {
		const cond = this.parseBinary(0);
		if (this.accept('?')) {
			const then = this.parseExpr();
			this.expect(':');
			const els = this.parseExpr();
			return { kind: 'ternary', cond, then, else: els };
		}
		return cond;
	}

	// Binary operator precedence table (higher binds tighter).
	private static readonly PREC: Record<string, number> = {
		'||': 1,
		'&&': 2,
		'==': 3,
		'!=': 3,
		'<': 4,
		'<=': 4,
		'>': 4,
		'>=': 4,
		'+': 5,
		'-': 5,
		'*': 6,
		'/': 6,
		'%': 6
	};

	private parseBinary(minPrec: number): Expr {
		let left = this.parseUnary();
		for (;;) {
			const t = this.peek();
			if (t.type !== 'op') break;
			const prec = Parser.PREC[t.value];
			if (prec === undefined || prec < minPrec) break;
			this.next();
			const right = this.parseBinary(prec + 1);
			if (t.value === '&&' || t.value === '||') {
				left = { kind: 'logical', op: t.value, left, right };
			} else {
				left = { kind: 'binary', op: t.value, left, right };
			}
		}
		return left;
	}

	private parseUnary(): Expr {
		if (this.check('-') || this.check('!')) {
			const op = this.next().value;
			return { kind: 'unary', op, expr: this.parseUnary() };
		}
		return this.parsePostfix();
	}

	private parsePostfix(): Expr {
		let e = this.parsePrimary();
		// swizzle / member access: e.xyz, e.rgba
		while (this.check('.')) {
			const dot = this.next();
			const id = this.next();
			if (id.type !== 'ident') this.err('Expected swizzle after `.`', id);
			e = { kind: 'member', object: e, swizzle: id.value, pos: dot.pos };
		}
		return e;
	}

	private parsePrimary(): Expr {
		const t = this.peek();

		if (t.type === 'number') {
			this.next();
			return { kind: 'num', value: Number(t.value) };
		}
		if (t.type === 'keyword' && (t.value === 'true' || t.value === 'false')) {
			this.next();
			return { kind: 'bool', value: t.value === 'true' };
		}
		if (this.accept('(')) {
			const e = this.parseExpr();
			this.expect(')');
			return e;
		}
		// identifier or function/constructor call. Type names double as constructors.
		if (t.type === 'ident' || (t.type === 'keyword' && TYPE_NAMES.has(t.value))) {
			this.next();
			if (this.check('(')) {
				this.next();
				const args: Expr[] = [];
				if (!this.check(')')) {
					do {
						args.push(this.parseExpr());
					} while (this.accept(','));
				}
				this.expect(')');
				return { kind: 'call', name: t.value, args, pos: t.pos };
			}
			return { kind: 'ident', name: t.value, pos: t.pos };
		}

		this.err(`Unexpected token '${t.value}'`);
	}
}

export function parse(src: string): Program {
	try {
		return new Parser(src).parseProgram();
	} catch (e) {
		if (e instanceof LexError) {
			throw new ParseError(e.message, e.line, e.col);
		}
		throw e;
	}
}
