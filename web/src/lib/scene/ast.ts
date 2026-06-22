// AST node types for the shader language. The parser produces a `Program`;
// the interpreter walks it. Vector types are tracked only as `TypeName` hints —
// the spike interpreter is dynamically typed (values are scalars or number[]).
// The eventual device compiler lowers vectors → scalar ops + bytecode.

export type TypeName = 'float' | 'vec2' | 'vec3' | 'vec4' | 'bool';

export type Expr =
	| { kind: 'num'; value: number }
	| { kind: 'bool'; value: boolean }
	| { kind: 'ident'; name: string; pos: number }
	| { kind: 'call'; name: string; args: Expr[]; pos: number }
	| { kind: 'member'; object: Expr; swizzle: string; pos: number }
	| { kind: 'unary'; op: string; expr: Expr }
	| { kind: 'binary'; op: string; left: Expr; right: Expr }
	| { kind: 'logical'; op: '&&' | '||'; left: Expr; right: Expr }
	| { kind: 'ternary'; cond: Expr; then: Expr; else: Expr };

export type Stmt =
	| { kind: 'var'; type: TypeName; name: string; init: Expr }
	| { kind: 'assign'; name: string; op: string; value: Expr; pos: number }
	| { kind: 'if'; cond: Expr; then: Stmt[]; else: Stmt[] | null }
	| { kind: 'for'; varName: string; from: number; to: number; body: Stmt[] }
	| { kind: 'expr'; expr: Expr };

export interface UniformDecl {
	name: string;
	type: TypeName;
	/** literal default; null means "no default given" (treated as 0/zero-vec) */
	default: Expr | null;
}

export interface Program {
	uniforms: UniformDecl[];
	frame: Stmt[];
	pixel: Stmt[];
}
