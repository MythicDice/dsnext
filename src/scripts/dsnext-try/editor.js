/* CodeMirror 6 的 DiceScript Next 语法高亮、浅色主题与实时诊断 */
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { StateField, StateEffect } from '@codemirror/state';
import { EditorView, Decoration } from '@codemirror/view';
import { linter, lintGutter } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';
import { checkSource } from './check.js';
import { describeError } from './diagnostics.js';

const KEYWORD = /^(?:if|else|while|break|continue|return|true|false|null|self)\b/;
// 末尾排斥标识符字符，保证 d20foo 不会被当成骰点字面量着色。
const DICE = /^\d*d\d+(?:(?:min|max|kh|kl|k|q|dh|dl|优势|劣势)\d*)*(?![\p{L}\p{N}_])/u;
const IDENT = /^[\p{L}_][\p{L}\p{N}_]*/u;
const OP = /^(?::=|\*\*|==|!=|<=|>=|&&|\|\||\?\?|<<|>>|->|=>|\.\.|[=+\-*/%^!~&|?:.,;()[\]{}<>])/;

function eatQuoted(stream, quote) {
  stream.next();
  while (!stream.eol()) {
    const c = stream.next();
    if (c === '\\' && !stream.eol()) {
      stream.next();
      continue;
    }
    if (c === quote) break;
  }
}

const dsLanguage = StreamLanguage.define({
  startState() { return {}; },
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.peek() === '#') {
      stream.skipToEnd();
      return 'dsComment';
    }
    if (stream.match(/^r(?=")/)) {
      eatQuoted(stream, '"');
      return 'dsRule';
    }
    const quote = stream.peek();
    if (quote === '"' || quote === "'" || quote === '`') {
      eatQuoted(stream, quote);
      return 'dsString';
    }
    if (stream.match(DICE)) return 'dsDice';
    if (/[0-9]/.test(stream.peek() ?? '')) {
      stream.match(/^[0-9]+(?:\.[0-9]+)?/);
      return 'dsNumber';
    }
    if (stream.match(KEYWORD)) return 'dsKeyword';
    if (stream.match(IDENT)) return 'dsIdent';
    if (stream.match(OP)) return 'dsOp';
    stream.next();
    return null;
  },
  tokenTable: {
    dsComment: t.lineComment,
    dsString: t.string,
    dsRule: t.atom,
    dsDice: t.className,
    dsNumber: t.number,
    dsKeyword: t.keyword,
    dsIdent: t.variableName,
    dsOp: t.operator,
  },
});

const dsHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#2c5c6b', fontWeight: '600' },
  { tag: t.atom, color: '#7a521f' },
  { tag: t.string, color: '#4f7a5e' },
  { tag: t.className, color: '#7a521f', fontWeight: '600' },
  { tag: t.number, color: '#4f7a5e' },
  { tag: t.variableName, color: '#2b3036' },
  { tag: t.operator, color: '#a45a5a', fontWeight: '600' },
  { tag: t.lineComment, color: '#a7acb0', fontStyle: 'italic' },
  { tag: t.punctuation, color: '#8a9196' },
]);

const dsEditorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      fontSize: '13.5px',
      color: '#2b3036',
      backgroundColor: '#ffffff',
    },
    '.cm-scroller': {
      fontFamily:
        '"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", "Noto Sans Mono CJK SC", monospace',
      lineHeight: '1.75',
      overflow: 'auto',
    },
    '.cm-content': { padding: '14px 0', caretColor: '#2c5c6b' },
    '.cm-line': { padding: '0 14px' },
    '.cm-gutters': {
      backgroundColor: '#fbfbfa',
      color: '#a7acb0',
      border: 'none',
      borderRight: '1px solid #eceeee',
    },
    '.cm-activeLine': { backgroundColor: '#f5f8f8' },
    '.cm-activeLineGutter': { backgroundColor: '#eff3f3', color: '#7c8288' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: '#dbe9ec !important',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#2c5c6b' },
    '.cm-ds-error-line': { backgroundColor: '#fdf4f2' },
    '.cm-foldPlaceholder': {
      backgroundColor: '#eef2f4',
      border: 'none',
      color: '#7c8288',
    },
    '.cm-lintRange-error': {
      backgroundImage: 'none',
      backgroundColor: 'transparent',
      textDecorationLine: 'underline',
      textDecorationStyle: 'wavy',
      textDecorationColor: '#c4736a',
      textUnderlineOffset: '3px',
    },
    '.cm-lint-marker-error': { opacity: '0.6' },
    '.cm-tooltip-lint': {
      border: '1px solid #ecd9d5',
      borderRadius: '7px',
      backgroundColor: '#fefafa',
      color: '#555c63',
      fontFamily: 'var(--font)',
      fontSize: '12px',
      boxShadow: '0 2px 8px rgb(23 26 29 / 6%)',
    },
    '.cm-diagnostic-error': { borderLeftColor: '#c4736a' },
    '.cm-completionListIncompleteTop:before, .cm-completionListIncompleteBottom:after': {
      content: '"…"',
    },
  },
  { dark: false },
);

const setErrorLine = StateEffect.define();

const dsErrorField = StateField.define({
  create() { return Decoration.none; },
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setErrorLine)) continue;
      const pos = effect.value;
      next = pos === null
        ? Decoration.none
        : Decoration.set([
          Decoration.line({ class: 'cm-ds-error-line' }).range(pos),
        ], true);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function setEditorError(view, utf16Offset) {
  const from = Math.max(0, Math.min(utf16Offset, view.state.doc.length));
  view.dispatch({ effects: setErrorLine.of(view.state.doc.lineAt(from).from) });
}

export function clearEditorError(view) {
  view.dispatch({ effects: setErrorLine.of(null) });
}

export function locateEditorError(view, utf16Offset) {
  const pos = Math.max(0, Math.min(utf16Offset, view.state.doc.length));
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  view.focus();
}

function toDiagnostic(error, source, view) {
  const doc = view.state.doc;
  const length = doc.length;
  const hasPosition = Number.isFinite(error?.utf16Offset);
  const from = hasPosition
    ? Math.max(0, Math.min(error.utf16Offset, Math.max(0, length - 1)))
    : 0;
  const line = doc.lineAt(from);
  const rest = source.slice(from, line.to);
  const stop = /[\s,;:()[\]{}=+\-*/%<>!&|?]/.exec(rest);
  const span = Math.min(40, Math.max(1, stop?.index ?? rest.length));
  const to = Math.min(length, Math.max(from + 1, from + span));

  const d = describeError(error, source);
  const diagnostic = {
    from,
    to,
    severity: 'error',
    source: 'DiceScript Next v0.1',
    message: `${d.code} ${d.title}：${d.detail}`,
  };
  if (d.fix) {
    diagnostic.actions = [{
      name: d.fix.label,
      apply(v) {
        v.dispatch({
          changes: { from: 0, to: v.state.doc.length, insert: d.fix.text },
          selection: { anchor: 0 },
        });
      },
    }];
  }
  return diagnostic;
}

/* 每次文档变更都调用真实解释器，诊断的位置、说明与修复全部来自该次解释。 */
const dsLinter = linter((view) => {
  const src = view.state.doc.toString();
  const result = checkSource(src);
  return result.ok ? [] : [toDiagnostic(result.error, src, view)];
}, { delay: 80 });

export const dsExtensions = [
  dsLanguage,
  syntaxHighlighting(dsHighlightStyle),
  dsEditorTheme,
  dsErrorField,
  dsLinter,
  lintGutter(),
];
