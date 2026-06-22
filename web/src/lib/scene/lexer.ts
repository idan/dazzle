// Lexer for the GLSL-flavored shader language (docs/scenes/shader-language.md).
//
// This is the spike's authoring surface. It tokenizes source into a flat token
// stream the parser consumes. Kept deliberately small; the device-side compiler
// (Rust → bytecode) is a separate, future concern.

export type TokenType =
	| 'number'
	| 'ident'
	| 'keyword'
	| 'op'
	| 'eof';

export interface Token {
	type: TokenType;
	value: string;
	/** byte offset of the token start, for error reporting */
	pos: number;
	line: number;
	col: number;
}

const KEYWORDS = new Set([
	'uniform',
	'frame',
	'pixel',
	'float',
	'vec2',
	'vec3',
	'vec4',
	'bool',
	'if',
	'else',
	'for',
	'in',
	'true',
	'false'
]);

// Multi-char operators, longest first so the scanner is greedy.
const OPERATORS = [
	'+=',
	'-=',
	'*=',
	'/=',
	'==',
	'!=',
	'<=',
	'>=',
	'&&',
	'||',
	'..',
	'+',
	'-',
	'*',
	'/',
	'%',
	'=',
	'<',
	'>',
	'!',
	'?',
	':',
	'.',
	',',
	';',
	'(',
	')',
	'{',
	'}'
];

export class LexError extends Error {
	constructor(
		message: string,
		public line: number,
		public col: number
	) {
		super(message);
		this.name = 'LexError';
	}
}

const isDigit = (c: string) => c >= '0' && c <= '9';
const isAlpha = (c: string) =>
	(c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isAlphaNum = (c: string) => isAlpha(c) || isDigit(c);

export function lex(src: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	let line = 1;
	let col = 1;

	const advance = (n = 1) => {
		for (let k = 0; k < n; k++) {
			if (src[i] === '\n') {
				line++;
				col = 1;
			} else {
				col++;
			}
			i++;
		}
	};

	while (i < src.length) {
		const c = src[i];

		// whitespace
		if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
			advance();
			continue;
		}

		// line comment
		if (c === '/' && src[i + 1] === '/') {
			while (i < src.length && src[i] !== '\n') advance();
			continue;
		}
		// block comment
		if (c === '/' && src[i + 1] === '*') {
			advance(2);
			while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) advance();
			advance(2);
			continue;
		}

		const startPos = i;
		const startLine = line;
		const startCol = col;

		// number: 123, 1.0, .5  (note: `..` is the range op, never part of a number)
		if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
			let s = '';
			while (i < src.length && isDigit(src[i])) {
				s += src[i];
				advance();
			}
			// fractional part — only if a single dot followed by a digit (not `..`)
			if (src[i] === '.' && src[i + 1] !== '.' && isDigit(src[i + 1])) {
				s += '.';
				advance();
				while (i < src.length && isDigit(src[i])) {
					s += src[i];
					advance();
				}
			} else if (src[i] === '.' && src[i + 1] !== '.') {
				// trailing dot, e.g. `2.` — allowed
				s += '.';
				advance();
			}
			tokens.push({ type: 'number', value: s, pos: startPos, line: startLine, col: startCol });
			continue;
		}

		// identifier / keyword
		if (isAlpha(c)) {
			let s = '';
			while (i < src.length && isAlphaNum(src[i])) {
				s += src[i];
				advance();
			}
			tokens.push({
				type: KEYWORDS.has(s) ? 'keyword' : 'ident',
				value: s,
				pos: startPos,
				line: startLine,
				col: startCol
			});
			continue;
		}

		// operator / punctuation
		const op = OPERATORS.find((o) => src.startsWith(o, i));
		if (op) {
			advance(op.length);
			tokens.push({ type: 'op', value: op, pos: startPos, line: startLine, col: startCol });
			continue;
		}

		throw new LexError(`Unexpected character '${c}'`, line, col);
	}

	tokens.push({ type: 'eof', value: '<eof>', pos: i, line, col });
	return tokens;
}
