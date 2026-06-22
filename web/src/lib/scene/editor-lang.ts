// CodeMirror 6 language support for the shader language: a StreamLanguage
// tokenizer for syntax highlighting + a linter that surfaces compile errors
// inline (the "errors inline" editor responsibility from preview-and-parity.md).

import {
	HighlightStyle,
	LanguageSupport,
	StreamLanguage,
	syntaxHighlighting
} from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import { tags } from '@lezer/highlight';
import { BUILTINS } from './builtins';
import { compile } from './index';

const KEYWORDS = new Set(['uniform', 'frame', 'pixel', 'if', 'else', 'for', 'in']);
const TYPES = new Set(['float', 'vec2', 'vec3', 'vec4', 'bool']);
const SPECIAL = new Set(['t', 'frame', 'res', 'uv', 'st', 'xy', 'color']);
const BUILTIN = new Set([...Object.keys(BUILTINS), 'vec2', 'vec3', 'vec4', 'fbm']);

interface State {
	inBlockComment: boolean;
}

const shaderStream = StreamLanguage.define<State>({
	startState: () => ({ inBlockComment: false }),
	copyState: (s) => ({ ...s }),
	token(stream, state) {
		if (state.inBlockComment) {
			if (stream.match(/^.*?\*\//)) state.inBlockComment = false;
			else stream.skipToEnd();
			return 'comment';
		}
		if (stream.eatSpace()) return null;

		// comments
		if (stream.match('//')) {
			stream.skipToEnd();
			return 'comment';
		}
		if (stream.match('/*')) {
			if (!stream.match(/^.*?\*\//)) {
				state.inBlockComment = true;
				stream.skipToEnd();
			}
			return 'comment';
		}

		// numbers
		if (stream.match(/^\d+\.?\d*/) || stream.match(/^\.\d+/)) return 'number';

		// identifiers / keywords
		if (stream.match(/^[A-Za-z_]\w*/)) {
			const w = stream.current();
			if (KEYWORDS.has(w)) return 'keyword';
			if (TYPES.has(w)) return 'type';
			if (w === 'true' || w === 'false') return 'atom';
			if (SPECIAL.has(w)) return 'special';
			if (BUILTIN.has(w)) return 'builtin';
			return 'variable';
		}

		// operators / punctuation
		if (stream.match(/^(\+=|-=|\*=|\/=|==|!=|<=|>=|&&|\|\||\.\.|[-+*/%=<>!?:.,;(){}])/))
			return 'operator';

		stream.next();
		return null;
	},
	tokenTable: {
		keyword: tags.keyword,
		type: tags.typeName,
		number: tags.number,
		comment: tags.lineComment,
		atom: tags.bool,
		builtin: tags.function(tags.variableName),
		special: tags.special(tags.variableName),
		variable: tags.variableName,
		operator: tags.operator
	}
});

const shaderHighlight = HighlightStyle.define([
	{ tag: tags.lineComment, color: '#6b7280', fontStyle: 'italic' },
	{ tag: tags.keyword, color: '#c084fc' },
	{ tag: tags.typeName, color: '#7dd3fc' },
	{ tag: tags.number, color: '#fca5a5' },
	{ tag: tags.bool, color: '#fca5a5' },
	{ tag: tags.function(tags.variableName), color: '#fbbf24' },
	{ tag: tags.special(tags.variableName), color: '#34d399' },
	{ tag: tags.variableName, color: '#e6e6ee' },
	{ tag: tags.operator, color: '#94a3b8' }
]);

export const shaderSupport = new LanguageSupport(shaderStream);
export const shaderHighlighting = syntaxHighlighting(shaderHighlight);

export const shaderLinter = linter(
	(view) => {
		const result = compile(view.state.doc.toString());
		if (result.ok) return [];
		const e = result.error;
		const doc = view.state.doc;
		if (!e.line || e.line < 1 || e.line > doc.lines) {
			return [{ from: 0, to: Math.min(1, doc.length), severity: 'error', message: e.message }];
		}
		const line = doc.line(e.line);
		const from = Math.min(line.from + Math.max(0, (e.col ?? 1) - 1), line.to);
		const to = Math.min(from + 1, doc.length);
		const diag: Diagnostic = {
			from,
			to: Math.max(to, from),
			severity: 'error',
			message: e.message
		};
		return [diag];
	},
	{ delay: 250 }
);
