/* DiceScript Next v0.1 的值模型、诊断、随机源与执行预算。
 * 本模块不依赖 DOM，可在浏览器与 Node 自检中共用。
 */

export const VERSION = '0.1';

/** 内建值与宿主注入名字。静态检查里它们不需要脚本声明。 */
export const GLOBAL_NAMES = new Set([
  'Int', 'Float', 'String', 'Bool', 'Object',
  'abs', 'floor', 'ceil', 'round', 'min', 'max', 'repr', 'bitXor', 'typeOf',
  'roll', 'formula', 'self',
  'actor', 'state', 'coc', 'fate', 'wod', 'dx',
]);

/* ------------------------------------------------------------------ 诊断 */

export class DSError extends Error {
  constructor(code, detail, offset = 0, extra = {}) {
    super(`${code}: ${detail}`);
    this.name = 'DSError';
    this.code = code;
    this.detail = detail;
    this.offset = offset;
    this.utf16Offset = offset;
    Object.assign(this, extra);
  }
}

/** 把 UTF-16 下标换算为以 Unicode 标量值计数的行列号。 */
export function positionAt(source, offset) {
  const at = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, at);
  const parts = before.split('\n');
  return {
    line: parts.length,
    column: Array.from(parts[parts.length - 1]).length + 1,
    offset: Array.from(before).length,
    utf16Offset: at,
  };
}

export function locate(source, error) {
  if (error instanceof DSError) {
    const pos = positionAt(source, error.offset);
    error.line = pos.line;
    error.column = pos.column;
    error.codePointOffset = pos.offset;
  }
  return error;
}

export function fail(code, detail, offset = 0, extra = {}) {
  throw new DSError(code, detail, offset, extra);
}

/* -------------------------------------------------------------- 脚本值 */

export const UNIT = Object.freeze({ t: 'Unit' });
export const NULL = Object.freeze({ t: 'Null' });
export const TRUE = Object.freeze({ t: 'Bool', v: true });
export const FALSE = Object.freeze({ t: 'Bool', v: false });

export const Int = (v) => ({ t: 'Int', v });
export const Float = (v) => ({ t: 'Float', v });
export const Bool = (v) => (v ? TRUE : FALSE);
export const Str = (v) => ({ t: 'Str', v: String(v) });
export const List = (items) => ({ t: 'List', v: items });
export const Obj = (entries = []) => ({ t: 'Obj', v: new Map(entries) });
export const Native = (name, fn, arity) => ({ t: 'Native', name, fn, arity });

export function typeName(v) {
  switch (v?.t) {
    case 'Int': return 'Int';
    case 'Float': return 'Float';
    case 'Bool': return 'Bool';
    case 'Str': return 'String';
    case 'Null': return 'Null';
    case 'Unit': return 'Unit';
    case 'List': return 'List';
    case 'Obj': return 'Object';
    case 'Fn': return 'Function';
    case 'Native': return 'Function';
    case 'Roll': return 'Roll';
    case 'Formula': return 'Formula';
    default: return 'Any';
  }
}

export function formatNumber(n) {
  if (!Number.isFinite(n)) return 'Infinity';
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(12)));
}

export function formatFloat(n) {
  if (!Number.isFinite(n)) return 'Infinity';
  return Number.isInteger(n) ? `${n}.0` : formatNumber(n);
}

/** 值到文字的转换：只在渲染边界调用，不吞掉错误。 */
export function display(v, depth = 0) {
  if (depth > 8) return '…';
  switch (v?.t) {
    case 'Int': return formatNumber(v.v);
    case 'Float': return formatFloat(v.v);
    case 'Bool': return v.v ? 'true' : 'false';
    case 'Str': return v.v;
    case 'Null':
    case 'Unit': return '';
    case 'Roll': return display(v.total, depth + 1);
    case 'List': return `[${v.v.map((x) => display(x, depth + 1)).join(', ')}]`;
    case 'Obj': return `{ ${[...v.v.entries()].map(([k, x]) => `${k}: ${display(x, depth + 1)}`).join(', ')} }`;
    case 'Fn': return `Function(${v.params.map((p) => p.name).join(', ')})`;
    case 'Native': return `Function(${v.name})`;
    case 'Formula': return 'Formula';
    default: return '';
  }
}

export function repr(v, depth = 0) {
  if (depth > 8) return '…';
  switch (v?.t) {
    case 'Str': return `"${v.v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    case 'Roll': return `Roll(${display(v.total)})`;
    case 'Formula': return 'Formula(...)';
    case 'List': return `[${v.v.map((x) => repr(x, depth + 1)).join(', ')}]`;
    case 'Obj': return `{ ${[...v.v.entries()].map(([k, x]) => `${k}: ${repr(x, depth + 1)}`).join(', ')} }`;
    default: return display(v, depth + 1) || typeName(v);
  }
}

/** 生成可供解析树面板使用的纯 JSON 数据，带类型标记且限制深度。 */
export function toJsonValue(v, depth = 0) {
  if (depth > 6) return '…';
  switch (v?.t) {
    case 'Int':
    case 'Float': return { type: typeName(v), value: v.v };
    case 'Bool': return { type: 'Bool', value: v.v };
    case 'Str': return { type: 'String', value: v.v };
    case 'Null':
    case 'Unit': return { type: typeName(v) };
    case 'List': return { type: 'List', items: v.v.map((x) => toJsonValue(x, depth + 1)) };
    case 'Obj': return {
      type: 'Object',
      fields: [...v.v.entries()].map(([k, x]) => ({ key: k, value: toJsonValue(x, depth + 1) })),
    };
    case 'Roll': return {
      type: 'Roll',
      total: toJsonValue(v.total, depth + 1),
      faces: toJsonValue(v.faces, depth + 1),
      detail: v.detail,
      sampleId: v.id,
    };
    case 'Formula': return { type: 'Formula', boundKeys: [...v.bound.keys()] };
    case 'Fn': return { type: 'Function', params: v.params.map((p) => p.name) };
    case 'Native': return { type: 'Function', name: v.name };
    default: return null;
  }
}

/* ------------------------------------------------------------ 数值运算 */

function numeric(v, pos, ctx) {
  if (v?.t === 'Int' || v?.t === 'Float') return { t: v.t, n: v.v };
  if (v?.t === 'Roll') return numeric(v.total, pos, ctx);
  return null;
}

function checkFinite(n, pos, code = 'T001') {
  if (!Number.isFinite(n)) fail(code, '运算结果不是有限数值', pos);
  if (Math.abs(n) > Number.MAX_SAFE_INTEGER) {
    fail(code, '整数结果超出安全范围', pos);
  }
  return n;
}

function isIntLike(x) {
  return x.t === 'Int' && Number.isSafeInteger(x.n);
}

export function numericBinary(op, a, b, pos, ctx) {
  const A = numeric(a, pos, ctx);
  const B = numeric(b, pos, ctx);
  if (!A || !B) {
    if (a?.t === 'Roll' || b?.t === 'Roll') {
      fail('T001', `Roll 与 ${typeName(a?.t === 'Roll' ? b : a)} 不能做 ${op} 运算`, pos);
    }
    fail('T001', `${typeName(a)} 与 ${typeName(b)} 不能做 ${op} 运算`, pos);
  }
  const isRoll = a?.t === 'Roll' || b?.t === 'Roll';
  const float = A.t === 'Float' || B.t === 'Float' || op === '/';
  let n;
  switch (op) {
    case '+': n = A.n + B.n; break;
    case '-': n = A.n - B.n; break;
    case '*': n = A.n * B.n; break;
    case '/':
      if (B.n === 0) fail('C001', '除数不能为 0', pos);
      n = A.n / B.n;
      break;
    case '%':
      if (!isIntLike(A) || !isIntLike(B)) fail('T001', '% 只作用于 Int', pos);
      if (B.n === 0) fail('C001', '取模的除数不能为 0', pos);
      n = A.n % B.n;
      break;
    case '**':
    case '^': n = A.n ** B.n; break;
    case '<<':
    case '>>':
      if (!isIntLike(A) || !isIntLike(B)) fail('T001', '位移只作用于 Int', pos);
      n = op === '<<' ? A.n << B.n : A.n >> B.n;
      break;
    case '&':
    case '|':
      if (!isIntLike(A) || !isIntLike(B)) fail('T001', '按位运算只作用于 Int', pos);
      n = op === '&' ? A.n & B.n : A.n | B.n;
      break;
    default: fail('S002', `不支持的运算符 ${op}`, pos);
  }
  checkFinite(n, pos);
  const value = float ? Float(n) : Int(n);
  if (isRoll) return rollArithmetic(op, a, b, value, pos, ctx);
  return value;
}

export function numericCompare(op, a, b, pos) {
  if ((a?.t === 'Str' && b?.t === 'Str') || (a?.t === 'List' && b?.t === 'List')) {
    if (!['<', '<=', '>', '>='].includes(op)) return Bool(false);
    const x = display(a);
    const y = display(b);
    const r = x < y ? -1 : x > y ? 1 : 0;
    return Bool(op === '<' ? r < 0 : op === '<=' ? r <= 0 : op === '>' ? r > 0 : r >= 0);
  }
  const A = numeric(a, pos);
  const B = numeric(b, pos);
  if (!A || !B) fail('T001', `${typeName(a)} 与 ${typeName(b)} 不能比较大小`, pos);
  const diff = A.n - B.n;
  switch (op) {
    case '<': return Bool(diff < 0);
    case '<=': return Bool(diff <= 0);
    case '>': return Bool(diff > 0);
    case '>=': return Bool(diff >= 0);
    default: return Bool(false);
  }
}

export function strictEqual(a, b) {
  if (a?.t !== b?.t) return false;
  switch (a?.t) {
    case 'Unit':
    case 'Null': return true;
    case 'Int':
    case 'Float':
    case 'Bool':
    case 'Str': return a.v === b.v;
    case 'Roll': return a.id === b.id;
    case 'Formula':
    case 'Fn':
    case 'Native': return a === b;
    case 'List': return a.v.length === b.v.length && a.v.every((x, i) => strictEqual(x, b.v[i]));
    case 'Obj': {
      if (a.v.size !== b.v.size) return false;
      for (const [k, x] of a.v) {
        if (!b.v.has(k) || !strictEqual(x, b.v.get(k))) return false;
      }
      return true;
    }
    default: return false;
  }
}

/* ---------------------------------------------------------------- Roll */

let nextSampleId = 1;

export function makeRoll({ total, faces, dice, detail, trace, ctx }) {
  const id = nextSampleId++;
  const fullTrace = { ...trace, id };
  ctx.stats.samples += 1;
  ctx.events.push({
    kind: 'roll',
    id,
    total: display(total),
    faces: faces.map((f) => f.v ?? f),
    detail,
    trace: toPlain(fullTrace) ?? null,
    offset: trace?.offset ?? 0,
  });
  return {
    t: 'Roll',
    id,
    total,
    faces: List(faces.map((f) => (typeof f === 'number' ? Int(f) : f))),
    dice: List(dice.map((d) => Obj([
      ['raw', Int(d.raw)],
      ['effective', Int(d.effective)],
      ['kept', Bool(d.kept)],
      ['round', Int(d.round)],
    ]))),
    trace: fullTrace,
    detail,
  };
}

function rollArithmetic(op, a, b, value, pos, ctx) {
  const left = a?.t === 'Roll' ? a : null;
  const right = b?.t === 'Roll' ? b : null;
  const base = left || right;
  const trace = {
    op: 'arith',
    operator: op,
    left: left?.trace ?? toTraceLeaf(a),
    right: right?.trace ?? toTraceLeaf(b),
    total: value.v,
    offset: pos,
  };
  const parts = [];
  if (left) parts.push(left.detail);
  parts.push(`${op} ${right ? right.detail : display(b)}`);
  const detail = `${parts.join('  ')}  →  ${display(value)}`;
  return makeRoll({
    total: value,
    faces: [...base.faces.v.map((x) => x.v)],
    dice: base.dice.v.map((d) => ({
      raw: d.v.get('raw').v,
      effective: d.v.get('effective').v,
      kept: d.v.get('kept').v,
      round: d.v.get('round').v,
    })),
    detail,
    trace,
    ctx,
  });
}

function toTraceLeaf(v) {
  if (v?.t === 'Roll') return v.trace;
  if (v?.t === 'Int' || v?.t === 'Float') return { op: 'const', value: v.v };
  return { op: 'const', value: display(v) };
}

export function rollTraceValue(roll) {
  return toPlain(roll.trace);
}

function toPlain(x, depth = 0) {
  if (depth > 6 || x === null || x === undefined) return x ?? null;
  if (typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map((v) => toPlain(v, depth + 1));
  if (x instanceof Map) return Object.fromEntries([...x].map(([k, v]) => [k, toPlain(v, depth + 1)]));
  const out = {};
  for (const [k, v] of Object.entries(x)) out[k] = toPlain(v, depth + 1);
  return out;
}

/* -------------------------------------------------------- 随机源与预算 */

export function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRuntime(source, options = {}) {
  let state = options.seed ?? hashString(source);
  const maxSteps = options.maxSteps ?? 20000;
  const ctx = {
    source,
    stats: { steps: 0, samples: 0, dice: 0 },
    events: [],
    maxSteps,
    maxDice: 1000,
    maxFaces: 100000,
    depth: 0,
    maxDepth: 64,
    pure: false,
    step(pos) {
      this.stats.steps += 1;
      if (this.stats.steps > maxSteps) {
        fail('R001', `执行步数超过 ${maxSteps} 的限额`, pos);
      }
    },
    nextInt(faces, pos) {
      if (!Number.isSafeInteger(faces) || faces < 1) {
        fail('D001', '骰面数必须是正整数', pos);
      }
      if (faces > this.maxFaces) fail('R001', `骰面数超过 ${this.maxFaces} 的限额`, pos);
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Math.floor(r * faces) + 1;
    },
    sample(count, faces, pos) {
      if (!Number.isSafeInteger(count) || count < 1) {
        fail('D001', `骰数 ${count} 不合法，必须是正整数`, pos);
      }
      if (count > this.maxDice || this.stats.dice + count > this.maxDice * 4) {
        fail('R001', `骰子总数超过 ${this.maxDice} 的限额`, pos);
      }
      this.stats.dice += count;
      const out = [];
      for (let i = 0; i < count; i += 1) out.push(this.nextInt(faces, pos));
      return out;
    },
    enter(pos) {
      this.depth += 1;
      if (this.depth > this.maxDepth) fail('R001', `递归深度超过 ${this.maxDepth} 层`, pos);
    },
    leave() { this.depth -= 1; },
  };
  return ctx;
}

/* ------------------------------------------------------------ 词法环境 */

export class Env {
  constructor(parent = null) {
    this.vars = new Map();
    this.parent = parent;
  }
  declare(name, value, pos, annotated = null) {
    if (annotated && annotated !== 'Any' && !typeMatches(annotated, value)) {
      fail('T001', `不能把 ${typeName(value)} 赋给标注为 ${annotated} 的名字 ${name}`, pos);
    }
    this.vars.set(name, { value, type: annotated || typeName(value) });
    return value;
  }
  has(name) {
    return this.vars.has(name) || (this.parent?.has(name) ?? false);
  }
  get(name, pos) {
    let scope = this;
    while (scope) {
      if (scope.vars.has(name)) return scope.vars.get(name).value;
      scope = scope.parent;
    }
    return null;
  }
  binding(name) {
    let scope = this;
    while (scope) {
      if (scope.vars.has(name)) return scope.vars.get(name);
      scope = scope.parent;
    }
    return null;
  }
  assign(name, value, pos) {
    const b = this.binding(name);
    if (!b) fail('N001', `未声明的名字「${name}」`, pos, { name });
    if (b.type && b.type !== 'Any' && !typeMatches(b.type, value)) {
      fail('T001', `不能把 ${typeName(value)} 赋给已知类型为 ${b.type} 的名字 ${name}`, pos);
    }
    b.value = value;
    return UNIT;
  }
}

export function typeMatches(annotation, value) {
  const base = annotation.replace(/\?$/, '');
  if (annotation.endsWith('?') && value?.t === 'Null') return true;
  if (base === 'Any') return true;
  if (base === 'Int' || base === 'Float') return value?.t === base;
  return typeName(value) === base;
}
