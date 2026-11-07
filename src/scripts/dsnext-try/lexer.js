/* DiceScript Next v0.1 词法器。
 * 所有下标都是整段源码的 UTF-16 绝对下标，模板插值与执行块共用同一坐标系。
 */
import { fail } from './core.js';

export const KEYWORDS = new Set([
  'if', 'else', 'while', 'break', 'continue', 'return',
  'true', 'false', 'null', 'self',
]);

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const MOD_RE = /^(min|max|kh|kl|k|q|dh|dl|优势|劣势)(\d*)/;
const OPERATORS = [
  ':=', '**', '==', '!=', '<=', '>=', '&&', '||', '??', '<<', '>>', '->', '=>', '..',
  '=', '<', '>', '+', '-', '*', '/', '%', '^', '!', '~', '&', '|', '?', ':', '.', ',', ';',
  '(', ')', '[', ']', '{', '}',
];

const isDigit = (c) => c >= '0' && c <= '9';

export function decodeEscapes(raw, start) {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (c !== '\\' || i + 1 >= raw.length) {
      out += c;
      continue;
    }
    const n = raw[++i];
    if (n === 'n') out += '\n';
    else if (n === 't') out += '\t';
    else if (n === 'r') out += '\r';
    else if (n === 'b') out += '\b';
    else if (n === 'f') out += '\f';
    else if (n === 'v') out += '\v';
    else if (n === '0') out += '\0';
    else if (n === '\\' || n === '"' || n === "'" || n === '`') out += n;
    else if (n === 'u') {
      if (raw[i + 1] === '{') {
        const close = raw.indexOf('}', i + 2);
        if (close < 0) fail('S001', '\\u{...} 缺少结束花括号', start + i);
        const hex = raw.slice(i + 2, close);
        if (!/^[0-9a-fA-F]+$/.test(hex)) fail('S001', '\\u{...} 不是十六进制码位', start + i);
        out += String.fromCodePoint(Number.parseInt(hex, 16));
        i = close;
      } else {
        const hex = raw.slice(i + 1, i + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('S001', '\\u 需要四位十六进制数字', start + i);
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 4;
      }
    } else {
      out += n;
    }
  }
  return out;
}

/** 尝试把一个连续词识别为基础骰点字面量；无法完整解释时返回 null，交回标识符。 */
export function parseDiceWord(word) {
  const m = /^(\d*)d(\d+)(.*)$/.exec(word);
  if (!m) return null;
  const count = m[1] === '' ? 1 : Number(m[1]);
  const faces = Number(m[2]);
  let rest = m[3];
  const mods = [];
  while (rest.length) {
    const hit = MOD_RE.exec(rest);
    if (!hit) return null;
    mods.push({ name: hit[1], n: hit[2] === '' ? null : Number(hit[2]) });
    rest = rest.slice(hit[0].length);
  }
  return { count, faces, mods };
}

/** 扫描一个带引号的字符串，返回解码后的内容和结束下标。 */
function scanQuoted(source, i, end, quote, start) {
  let raw = '';
  while (i < end) {
    const c = source[i];
    if (c === '\\') {
      raw += c;
      i += 1;
      if (i < end) {
        raw += source[i];
        i += 1;
      }
      continue;
    }
    if (c === quote) return { text: decodeEscapes(raw, start + 1), end: i + 1 };
    if (c === '\n' && quote !== '`') {
      fail('S001', '字符串没有在行内闭合', start);
    }
    raw += c;
    i += 1;
  }
  fail('S001', quote === '`' ? '反引号模板没有闭合' : '字符串没有闭合', start);
}

/** 扫描模板插值里的 {expr}，按括号层级配对并跳过内嵌字符串。 */
function scanInterpolation(source, i, end, start) {
  let depth = 1;
  let j = i;
  while (j < end) {
    const c = source[j];
    if (c === '"' || c === "'" || c === '`') {
      const q = scanQuoted(source, j + 1, end, c, j);
      j = q.end;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return j;
    }
    j += 1;
  }
  fail('S001', '模板插值 {expr} 缺少结束花括号', start);
}

function scanTemplate(source, i, end, start) {
  const parts = [];
  let text = '';
  while (i < end) {
    const c = source[i];
    if (c === '\\') {
      text += decodeEscapes(source.slice(i, i + 2), start + i);
      i += 2;
      continue;
    }
    if (c === '`') {
      if (text) parts.push({ t: 'text', text });
      return { parts, end: i + 1 };
    }
    if (c === '{') {
      if (source[i + 1] === '{') {
        text += '{';
        i += 2;
        continue;
      }
      const exprStart = i + 1;
      const exprEnd = scanInterpolation(source, exprStart, end, start + i);
      if (text) {
        parts.push({ t: 'text', text });
        text = '';
      }
      parts.push({ t: 'expr', start: exprStart, end: exprEnd });
      i = exprEnd + 1;
      continue;
    }
    if (c === '}' && source[i + 1] === '}') {
      text += '}';
      i += 2;
      continue;
    }
    text += c;
    i += 1;
  }
  fail('S001', '反引号模板没有闭合', start);
}

/**
 * tokenize(source, start, end)
 * 对 [start, end) 区间做词法分析，token 的 start/end 仍是整段源码的绝对下标。
 */
export function tokenize(source, start = 0, end = source.length) {
  const tokens = [];
  let i = start;
  const push = (type, value, from, to, extra = {}) => {
    tokens.push({ type, value, start: from, end: to, ...extra });
  };

  while (i < end) {
    const c = source[i];

    if (c === ' ' || c === '\t' || c === '\r' || c === '\f') {
      i += 1;
      continue;
    }
    if (c === '\n') {
      const from = i;
      i += 1;
      push('nl', '\n', from, i);
      continue;
    }
    if (c === '#') {
      while (i < end && source[i] !== '\n') i += 1;
      continue;
    }

    if (c === 'r' && source[i + 1] === '"') {
      const from = i;
      const q = scanQuoted(source, i + 2, end, '"', i + 1);
      push('rulestr', q.text, from, q.end);
      i = q.end;
      continue;
    }

    if (isDigit(c)) {
      const from = i;
      // 以数字开头的连续词优先按骰点字面量解释，避免把 2d20kh1 拆成 2 与 d20kh1。
      let wordEnd = i;
      while (wordEnd < end && WORD_CHAR.test(source[wordEnd])) wordEnd += 1;
      const dice = parseDiceWord(source.slice(from, wordEnd));
      if (dice) {
        push('dice', dice, from, wordEnd, { raw: source.slice(from, wordEnd) });
        i = wordEnd;
        continue;
      }
      while (i < end && isDigit(source[i])) i += 1;
      let isFloat = false;
      if (source[i] === '.' && isDigit(source[i + 1])) {
        isFloat = true;
        i += 1;
        while (i < end && isDigit(source[i])) i += 1;
      }
      push('num', Number(source.slice(from, i)), from, i, { isFloat });
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      const from = i;
      if (c === '`') {
        const tpl = scanTemplate(source, i + 1, end, from);
        push('tpl', tpl.parts, from, tpl.end);
        i = tpl.end;
      } else {
        const q = scanQuoted(source, i + 1, end, c, from);
        push('str', q.text, from, q.end);
        i = q.end;
      }
      continue;
    }

    if (WORD_CHAR.test(c)) {
      const from = i;
      while (i < end && WORD_CHAR.test(source[i])) i += 1;
      const word = source.slice(from, i);
      if (KEYWORDS.has(word)) {
        push('kw', word, from, i);
        continue;
      }
      const dice = parseDiceWord(word);
      if (dice) {
        push('dice', dice, from, i, { raw: word });
        continue;
      }
      push('ident', word, from, i);
      continue;
    }

    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (op) {
      push('op', op, i, i + op.length);
      i += op.length;
      continue;
    }

    fail('S001', `无法识别的字符「${c}」`, i, { char: c });
  }
  push('eof', null, end, end);
  return tokens;
}

/** 宿主文本里的 {{ code }} 边界扫描，跳过引号内容并按层级配对花括号。 */
export function scanHostBlocks(source) {
  const blocks = [];
  let i = 0;
  const end = source.length;
  while (i < end) {
    const c = source[i];
    if (c === '#') {
      while (i < end && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      i = scanQuoted(source, i + 1, end, c, i).end;
      continue;
    }
    if (c === '{' && source[i + 1] === '{') {
      const from = i + 2;
      let j = from;
      let depth = 0;
      while (j < end) {
        const d = source[j];
        if (d === '"' || d === "'" || d === '`') {
          j = scanQuoted(source, j + 1, end, d, j).end;
          continue;
        }
        if (d === '{') {
          depth += 1;
          j += 1;
          continue;
        }
        if (d === '}') {
          if (depth === 0 && source[j + 1] === '}') break;
          depth -= 1;
          j += 1;
          continue;
        }
        j += 1;
      }
      if (j >= end) fail('S002', '执行块 {{ ... }} 没有闭合', i);
      blocks.push({ start: from, end: j, open: i, close: j + 2 });
      i = j + 2;
      continue;
    }
    i += 1;
  }
  return blocks;
}
