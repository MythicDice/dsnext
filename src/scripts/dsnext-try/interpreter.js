/* DiceScript Next v0.1 求值器与运行入口。
 * 解析、静态诊断、求值、宿主文本执行块全部走同一套实现，界面不预置任何结果。
 */
import {
  VERSION, DSError, fail, locate, Int, Float, Bool, Str, List, Obj, Native,
  UNIT, NULL, TRUE, FALSE, typeName, display, repr, formatFloat,
  numericBinary, numericCompare, strictEqual, makeRoll, Env,
  createRuntime, toJsonValue, typeMatches,
} from './core.js';
import { parseProgram, astSummary, walkAst } from './parser.js';
import { scanHostBlocks, parseDiceWord } from './lexer.js';

export { VERSION };

class ReturnSignal { constructor(value) { this.value = value; } }
class BreakSignal {}
class ContinueSignal {}

const isFloatVal = (v) => v?.t === 'Float';
const isIntVal = (v) => v?.t === 'Int';

function asNumber(v, pos) {
  if (isIntVal(v) || isFloatVal(v)) return v.v;
  if (v?.t === 'Roll') return asNumber(v.total, pos);
  fail('C001', `这里需要数值，实际是 ${typeName(v)}`, pos);
}

function asInt(v, pos) {
  if (v?.t === 'Roll') return asInt(v.total, pos);
  if (!isIntVal(v)) fail('C001', `这里需要 Int，实际是 ${typeName(v)}`, pos);
  return v.v;
}

function requireBool(v, pos) {
  if (v?.t !== 'Bool') fail('T002', `条件必须是 Bool，实际是 ${typeName(v)}`, pos);
  return v.v;
}

function toVal(x, depth = 0) {
  if (depth > 6 || x === null || x === undefined) return NULL;
  if (typeof x === 'number') return Number.isInteger(x) ? Int(x) : Float(x);
  if (typeof x === 'boolean') return Bool(x);
  if (typeof x === 'string') return Str(x);
  if (Array.isArray(x)) return List(x.map((v) => toVal(v, depth + 1)));
  return Obj(Object.entries(x).map(([k, v]) => [k, toVal(v, depth + 1)]));
}

function rollDiceEntries(roll) {
  return roll.dice.v.map((d) => ({
    raw: d.v.get('raw').v,
    effective: d.v.get('effective').v,
    kept: d.v.get('kept').v,
    round: d.v.get('round').v,
  }));
}

function transformRoll(v, fn, label, ctx, pos) {
  const total = fn(v.total);
  return makeRoll({
    total,
    faces: v.faces.v.map((x) => x.v),
    dice: rollDiceEntries(v),
    detail: `${label}(${v.detail})  →  ${display(total)}`,
    trace: { op: 'unary', operator: label, operand: v.trace, total: total.v, offset: pos },
    ctx,
  });
}

/* ---------------------------------------------------------- 普通骰点 */

function applyDiceMods(mods) {
  let clamp = null;
  let filter = null;
  let advantage = null;
  for (const m of mods) {
    if (m.name === 'min' || m.name === 'max') clamp = m;
    else if (m.name === '优势' || m.name === '劣势') advantage = m;
    else filter = m;
  }
  return { clamp, filter, advantage };
}

export function rollDice(countValue, facesValue, mods, ctx, pos) {
  let count = asInt(countValue, pos);
  const facesCount = asInt(facesValue, pos);
  if (count < 1 || facesCount < 1) {
    fail('D001', `${count}d${facesCount} 的骰数与骰面都必须是正整数`, pos);
  }
  const { clamp, filter, advantage } = applyDiceMods(mods || []);
  if (advantage) {
    count = 2;
    const auto = { name: advantage.name === '优势' ? 'kh' : 'kl', n: 1 };
    if (filter) fail('D001', '优势与劣势不能与其他取高取低修饰连用', pos);
    return rollDice(Int(count), Int(facesCount),
      clamp ? [clamp, auto] : [auto], ctx, pos, true);
  }

  const raw = ctx.sample(count, facesCount, pos);
  const effective = raw.map((n) => {
    if (!clamp) return n;
    return clamp.name === 'min' ? Math.max(n, clamp.n) : Math.min(n, clamp.n);
  });

  let kept = raw.map(() => true);
  let filterLabel = '';
  if (filter) {
    const n = filter.n === null ? 1 : filter.n;
    if (n < 1 || n > count) {
      fail('D001', `筛选的骰子数量 ${n} 超出总骰数 ${count}`, pos);
    }
    const order = effective
      .map((value, index) => ({ value, index }))
      .sort((a, b) => b.value - a.value || a.index - b.index);
    const high = ['kh', 'k'].includes(filter.name);
    const keepSet = new Set();
    if (['kh', 'k', 'kl', 'q'].includes(filter.name)) {
      const chosen = high ? order.slice(0, n) : order.slice(-n);
      for (const item of chosen) keepSet.add(item.index);
      filterLabel = `${high ? '取高' : '取低'} ${n} 枚 [${chosen.map((x) => x.value).join(', ')}]`;
    } else {
      const drop = high ? order.slice(0, n) : order.slice(-n);
      for (const item of drop) keepSet.add(item.index);
      for (let i = 0; i < count; i += 1) kept[i] = !keepSet.has(i);
      filterLabel = `丢弃${high ? '最高' : '最低'} ${n} 枚 [${drop.map((x) => x.value).join(', ')}]`;
    }
    if (['kh', 'k', 'kl', 'q'].includes(filter.name)) {
      kept = raw.map((_, i) => keepSet.has(i));
    }
  }

  const totalValue = effective.reduce(
    (acc, value, i) => (kept[i] ? numericBinary('+', acc, Int(value), pos, ctx) : acc),
    Int(0),
  );
  const notes = [];
  if (clamp) notes.push(`每骰${clamp.name === 'min' ? '下限' : '上限'} ${clamp.n} → [${effective.join(', ')}]`);
  if (filterLabel) notes.push(filterLabel);
  notes.push(`合计 ${display(totalValue)}`);
  const modifierText = (mods || []).map((m) => `${m.name}${m.n ?? ''}`).join('');
  const detail = `${count}d${facesCount}${modifierText}  →  [${raw.join(', ')}]  →  ${notes.join('  →  ')}`;

  return makeRoll({
    total: totalValue,
    faces: raw,
    dice: raw.map((n, i) => ({ raw: n, effective: effective[i], kept: kept[i], round: 1 })),
    detail,
    trace: {
      op: 'dice', rule: 'base', count, faces: facesCount,
      raw, effective, kept, total: totalValue.v, offset: pos,
    },
    ctx,
  });
}

/* -------------------------------------------------------- 规则骰空间 */

function ruleRoll({ total, faces, dice, detail, trace, ctx }) {
  return makeRoll({ total, faces, dice, detail, trace, ctx });
}

export function evalRuleText(text, ctx, pos, ruleSource = 'roll(String)') {
  const code = String(text).trim();
  const plain = /^(\d*d\d+(?:(?:min|max|kh|kl|k|q|dh|dl|优势|劣势)\d*)*)([+-]\d+)?$/.exec(code);
  if (plain) {
    const base = parseDiceWord(plain[1]);
    if (base) {
      const roll = rollDice(Int(base.count), Int(base.faces), base.mods, ctx, pos);
      if (!plain[2]) return roll;
      const delta = Int(Number(plain[2]));
      return numericBinary(plain[2][0], roll, delta, pos, ctx);
    }
  }

  let m = /^([bp])(\d+)$/.exec(code);
  if (m) {
    const bonus = m[1] === 'b';
    const extra = Math.min(20, Number(m[2]));
    const tens = ctx.sample(extra + 1, 10, pos).map((n) => (n === 10 ? 0 : n));
    const unitsRaw = ctx.nextInt(10, pos);
    const units = unitsRaw === 10 ? 0 : unitsRaw;
    const chosen = bonus ? Math.min(...tens) : Math.max(...tens);
    let total = chosen * 10 + units;
    if (total === 0) total = 100;
    const detail = `${bonus ? '奖励' : '惩罚'}骰 ${code}  →  十位 [${tens.join(', ')}] 取 ${chosen}，个位 ${units}  →  ${total}`;
    return ruleRoll({
      total: Int(total),
      faces: [...tens, units],
      dice: [...tens.map((n) => ({ raw: n, effective: n, kept: false, round: 1 })),
        { raw: units, effective: units, kept: true, round: 1 }],
      detail,
      trace: { op: 'rule', rule: 'coc', source: ruleSource, params: { kind: m[1], extra }, total, offset: pos },
      ctx,
    });
  }

  if (code === 'f') {
    const values = ctx.sample(4, 3, pos).map((n) => n - 2);
    const total = values.reduce((a, b) => a + b, 0);
    const detail = `命运骰 f  →  [${values.map((n) => (n > 0 ? `+${n}` : n)).join(', ')}]  →  ${total}`;
    return ruleRoll({
      total: Int(total),
      faces: values,
      dice: values.map((n) => ({ raw: n, effective: n, kept: true, round: 1 })),
      detail,
      trace: { op: 'rule', rule: 'fate', source: ruleSource, total, offset: pos },
      ctx,
    });
  }

  m = /^(\d+)a(\d+)(?:k(\d+))?$/.exec(code);
  if (m) {
    const pool = Math.min(100, Number(m[1]));
    const again = Number(m[2]);
    const target = m[3] ? Number(m[3]) : 8;
    if (pool < 1 || again < 2 || again > 10 || target < 1 || target > 10) {
      fail('D001', `规则骰 ${code} 的参数超出允许范围`, pos);
    }
    const faces = [];
    const dice = [];
    let successes = 0;
    let round = 1;
    let queue = ctx.sample(pool, 10, pos);
    while (queue.length && round <= 3) {
      const next = [];
      for (const face of queue) {
        faces.push(face);
        const hit = face >= target;
        if (hit) successes += 1;
        dice.push({ raw: face, effective: face, kept: hit, round });
        if (face >= again) next.push(ctx.nextInt(10, pos));
      }
      queue = next;
      round += 1;
    }
    const detail = `成功数 ${code}  →  骰面 [${faces.join(', ')}]，命中线 ${target}，爆骰线 ${again}  →  成功 ${successes}`;
    return ruleRoll({
      total: Int(successes),
      faces,
      dice,
      detail,
      trace: {
        op: 'rule', rule: 'wod', source: ruleSource,
        params: { pool, again, target }, rounds: round - 1, total: successes, offset: pos,
      },
      ctx,
    });
  }

  m = /^(\d+)c(\d+)m(\d+)$/.exec(code);
  if (m) {
    const pool = Math.min(100, Number(m[1]));
    const crit = Number(m[2]);
    const again = Number(m[3]);
    if (pool < 1 || crit < 1 || crit > 10 || again < 2 || again > 10) {
      fail('D001', `规则骰 ${code} 的参数超出允许范围`, pos);
    }
    const faces = [];
    const dice = [];
    let hits = 0;
    let round = 1;
    let queue = ctx.sample(pool, 10, pos);
    while (queue.length && round <= 3) {
      const next = [];
      for (const face of queue) {
        faces.push(face);
        const hit = face >= crit;
        if (hit) hits += 1;
        dice.push({ raw: face, effective: face, kept: hit, round });
        if (face >= again) next.push(ctx.nextInt(10, pos));
      }
      queue = next;
      round += 1;
    }
    const detail = `轮数骰 ${code}  →  骰面 [${faces.join(', ')}]，命中线 ${crit}，追加线 ${again}，共 ${round - 1} 轮  →  命中 ${hits}`;
    return ruleRoll({
      total: Int(hits),
      faces,
      dice,
      detail,
      trace: {
        op: 'rule', rule: 'dx', source: ruleSource,
        params: { pool, crit, again }, rounds: round - 1, total: hits, offset: pos,
      },
      ctx,
    });
  }

  if (/^custom:/.test(code)) {
    fail('D002', `宿主没有注册规则「${code}」`, pos);
  }
  fail('D001', `无法按规则骰文法解释「${code}」`, pos);
}

/* ------------------------------------------------------------ 内建值 */

function numArg(v, pos) {
  return asNumber(v, pos);
}

function truthy(v) {
  switch (v?.t) {
    case 'Null':
    case 'Unit': return false;
    case 'Bool': return v.v;
    case 'Int':
    case 'Float': return v.v !== 0;
    case 'Str': return v.v.length > 0;
    case 'List': return v.v.length > 0;
    case 'Roll': return truthy(v.total);
    default: return true;
  }
}

function createGlobals(ctx) {
  const env = new Env();
  const add = (name, fn, arity) => env.declare(name, Native(name, fn, arity), 0, 'Any');

  add('Int', (a, pos) => {
    const v = a[0];
    if (v?.t === 'Str') {
      if (!/^[+-]?\d+$/.test(v.v.trim())) fail('C001', `Int("${v.v}") 不是十进制整数`, pos);
      return Int(Number.parseInt(v.v.trim(), 10));
    }
    if (v?.t === 'Int') return v;
    if (v?.t === 'Bool') return Int(v.v ? 1 : 0);
    if (v?.t === 'Float') return Int(Math.trunc(v.v));
    if (v?.t === 'Roll') return Int(Math.trunc(asNumber(v.total, pos)));
    fail('C001', `Int 不能转换 ${typeName(v)}`, pos);
  }, 1);

  add('Float', (a, pos) => {
    const v = a[0];
    if (v?.t === 'Str') {
      const n = Number(v.v.trim());
      if (!v.v.trim() || !Number.isFinite(n)) fail('C001', `Float("${v.v}") 不是有限数值`, pos);
      return Float(n);
    }
    if (v?.t === 'Roll') return Float(asNumber(v.total, pos));
    if (isIntVal(v) || isFloatVal(v)) return Float(v.v);
    fail('C001', `Float 不能转换 ${typeName(v)}`, pos);
  }, 1);

  add('String', (a) => Str(display(a[0])), 1);
  add('Bool', (a) => Bool(truthy(a[0])), 1);
  add('repr', (a) => Str(repr(a[0])), 1);
  add('typeOf', (a) => Str(typeName(a[0])), 1);

  add('abs', (a, pos, c) => unaryNumeric(a[0], Math.abs, 'abs', pos, c), 1);
  add('floor', (a, pos, c) => unaryNumeric(a[0], Math.floor, 'floor', pos, c, true), 1);
  add('ceil', (a, pos, c) => unaryNumeric(a[0], Math.ceil, 'ceil', pos, c, true), 1);
  add('round', (a, pos, c) => unaryNumeric(a[0], (n) => Math.sign(n) * Math.round(Math.abs(n)), 'round', pos, c, true), 1);

  add('bitXor', (a, pos) => Int(asInt(a[0], pos) ^ asInt(a[1], pos)), 2);

  add('min', (a, pos) => {
    if (!a.length) fail('C001', 'min 至少需要一个参数', pos);
    return a.reduce((best, v) => (numArg(v, pos) < numArg(best, pos) ? v : best));
  }, 1);
  add('max', (a, pos) => {
    if (!a.length) fail('C001', 'max 至少需要一个参数', pos);
    return a.reduce((best, v) => (numArg(v, pos) > numArg(best, pos) ? v : best));
  }, 1);

  add('roll', (a, pos, c) => {
    if (a[0]?.t !== 'Str') {
      fail('C001', `roll 需要 String，实际是 ${typeName(a[0])}；传 Roll 不会重新抽样`, pos);
    }
    return evalRuleText(a[0].v, c, pos, 'roll(String)');
  }, 1);

  add('formula', (a, pos) => {
    if (a[0]?.t !== 'Fn' && a[0]?.t !== 'Native') {
      fail('C001', 'formula 需要一个语言函数', pos);
    }
    return { t: 'Formula', fn: a[0], bound: new Map(), start: pos };
  }, 1);

  env.declare('Object', Obj([
    ['keys', Native('keys', (a, pos) => {
      requireObject(a[0], pos);
      return List([...a[0].v.keys()].map(Str));
    }, 1)],
    ['values', Native('values', (a, pos) => {
      requireObject(a[0], pos);
      return List([...a[0].v.values()]);
    }, 1)],
  ]), 0, 'Any');

  env.declare('actor', Obj([
    ['名字', Str('调查员')],
    ['侦查', Int(60)],
    ['HP', Int(12)],
    ['力量加值', Int(4)],
  ]), 0, 'Any');
  env.declare('state', Obj([]), 0, 'Any');

  env.declare('coc', Obj([
    ['bonus', Native('bonus', (a, pos, c) => evalRuleText(`b${asInt(a[0], pos)}`, c, pos, 'coc.bonus'), 1)],
    ['penalty', Native('penalty', (a, pos, c) => evalRuleText(`p${asInt(a[0], pos)}`, c, pos, 'coc.penalty'), 1)],
  ]), 0, 'Any');
  env.declare('fate', Obj([
    ['roll', Native('roll', (a, pos, c) => evalRuleText('f', c, pos, 'fate.roll'), 0)],
  ]), 0, 'Any');
  env.declare('wod', Obj([
    ['roll', Native('roll', (a, pos, c, named) => {
      const count = asInt(a[0], pos);
      const again = named.again === undefined ? 9 : asInt(named.again, pos);
      const target = named.target === undefined ? 8 : asInt(named.target, pos);
      return evalRuleText(`${count}a${again}k${target}`, c, pos, 'wod.roll');
    }, 1)],
  ]), 0, 'Any');
  env.declare('dx', Obj([]), 0, 'Any');
  return env;
}

function requireObject(v, pos) {
  if (v?.t !== 'Obj') fail('C001', `这里需要 Object，实际是 ${typeName(v)}`, pos);
  return v;
}

function unaryNumeric(v, fn, label, pos, ctx, integerResult = false) {
  const n = fn(numArg(v, pos));
  if (!Number.isFinite(n)) fail('C001', `${label} 的结果不是有限数值`, pos);
  const result = integerResult ? Int(n) : (isFloatVal(v) || v?.t === 'Roll' && isFloatVal(v.total) ? Float(n) : Int(n));
  if (v?.t === 'Roll') return transformRoll(v, () => result, label, ctx, pos);
  return result;
}

/* ------------------------------------------------------ 成员与方法 */

const OBJECT_METHODS = new Set(['len', 'has', 'get', 'keys', 'values', 'items']);
const LIST_METHODS = new Set([
  'len', 'sum', 'kh', 'kl', 'shuffle', 'rand', 'randSize',
  'push', 'pop', 'shift', 'map', 'filter', 'count',
]);

function nearest(name, keys) {
  let best = null;
  let distance = Infinity;
  for (const key of keys) {
    const d = absDistance(name, key);
    if (d < distance) { distance = d; best = key; }
  }
  return distance <= 2 ? best : null;
}

function absDistance(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  const dp = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
  for (let j = 0; j <= y.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= x.length; i += 1) {
    for (let j = 1; j <= y.length; j += 1) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
  }
  return dp[x.length][y.length];
}

function methodNative(name, receiver, ctx) {
  return Native(name, (args, pos, c, named) =>
    invokeBuiltinMethod(name, receiver, args, pos, c, named), name === 'get' ? 1 : 0);
}

function invokeBuiltinMethod(name, receiver, args, pos, ctx, named) {
  if (ctx.pure && ['push', 'pop', 'shift'].includes(name)) {
    fail('F001', '公式体里不能修改列表', pos);
  }
  if (receiver.t === 'Obj') {
    switch (name) {
      case 'len': return Int(receiver.v.size);
      case 'has': return Bool(receiver.v.has(String(display(args[0]))));
      case 'get': {
        const key = String(display(args[0]));
        return receiver.v.has(key) ? receiver.v.get(key) : (args[1] ?? NULL);
      }
      case 'keys': return List([...receiver.v.keys()].map(Str));
      case 'values': return List([...receiver.v.values()]);
      case 'items': return List([...receiver.v.entries()].map(([k, v]) => List([Str(k), v])));
      default: break;
    }
  }
  if (receiver.t === 'List') {
    const items = receiver.v;
    switch (name) {
      case 'len': return Int(items.length);
      case 'sum':
        return items.reduce((acc, x) => numericBinary('+', acc, x, pos, ctx), Int(0));
      case 'kh':
      case 'kl': {
        const n = args.length ? asInt(args[0], pos) : 1;
        if (n < 1 || n > items.length) fail('C001', `kh 的数量 ${n} 超出列表长度 ${items.length}`, pos);
        const order = items
          .map((value, index) => ({ value, index, key: numArg(value, pos) }))
          .sort((a, b) => b.key - a.key || a.index - b.index);
        const chosen = name === 'kh' ? order.slice(0, n) : order.slice(-n);
        return chosen.reduce((acc, x) => numericBinary('+', acc, x.value, pos, ctx), Int(0));
      }
      case 'shuffle': {
        const copy = [...items];
        for (let i = copy.length - 1; i > 0; i -= 1) {
          const j = ctx.nextInt(i + 1, pos) - 1;
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return List(copy);
      }
      case 'rand': {
        if (!items.length) fail('C001', '空列表不能 rand', pos);
        return items[ctx.nextInt(items.length, pos) - 1];
      }
      case 'randSize': {
        const n = asInt(args[0], pos);
        if (n < 1 || n > items.length) fail('C001', `randSize 的数量 ${n} 超出列表长度 ${items.length}`, pos);
        const copy = [...items];
        const out = [];
        for (let i = 0; i < n; i += 1) {
          const j = ctx.nextInt(copy.length, pos) - 1;
          out.push(copy.splice(j, 1)[0]);
        }
        return List(out);
      }
      case 'push': items.push(args[0]); return receiver;
      case 'pop':
        if (!items.length) fail('C001', '空列表不能 pop', pos);
        return items.pop();
      case 'shift':
        if (!items.length) fail('C001', '空列表不能 shift', pos);
        return items.shift();
      case 'map': return List(items.map((x) => callValue(args[0], [x], pos, ctx)));
      case 'filter':
        return List(items.filter((x) => requireBool(callValue(args[0], [x], pos, ctx), pos)));
      case 'count':
        return Int(items.filter((x) => requireBool(callValue(args[0], [x], pos, ctx), pos)).length);
      default: break;
    }
  }
  if (receiver.t === 'Roll') {
    if (name === 'to_text') return Str(display(receiver.total));
  }
  if (receiver.t === 'Formula') {
    if (name === 'eval') return evalFormula(receiver, args, pos, ctx);
    if (name === 'bind') {
      requireObject(args[0], pos);
      const bound = new Map(receiver.bound);
      for (const [k, v] of args[0].v) bound.set(k, v);
      return { ...receiver, bound };
    }
  }
  fail('O001', `${typeName(receiver)} 没有方法「${name}」`, pos);
}

function resolveMember(receiver, key, pos, ctx) {
  const name = String(key);
  if (receiver.t === 'Obj') {
    if (receiver.v.has(name)) {
      const value = receiver.v.get(name);
      if (value?.t === 'Fn' && value.isMethod) return { ...value, boundSelf: receiver };
      return value;
    }
    if (OBJECT_METHODS.has(name)) return methodNative(name, receiver, ctx);
    if (name === 'to_text' && ctx.rendering) {
      const fn = receiver.v.get('to_text');
      if (fn) return fn;
    }
    const hint = nearest(name, receiver.v.keys());
    fail('O001', `对象没有字段「${name}」${hint ? `，是否想写「${hint}」` : ''}`, pos);
  }
  if (receiver.t === 'Roll') {
    switch (name) {
      case 'total': return receiver.total;
      case 'faces': return receiver.faces;
      case 'dice': return receiver.dice;
      case 'trace': return toVal(receiver.trace);
      case 'detail': return Str(receiver.detail);
      case 'to_text': return methodNative('to_text', receiver, ctx);
      default: fail('O001', `Roll 没有字段「${name}」`, pos);
    }
  }
  if (receiver.t === 'List') {
    if (name === 'length') return Int(receiver.v.length);
    if (LIST_METHODS.has(name)) return methodNative(name, receiver, ctx);
    fail('O001', `List 没有字段「${name}」`, pos);
  }
  if (receiver.t === 'Str') {
    if (name === 'length') return Int(Array.from(receiver.v).length);
    fail('O001', `String 没有字段「${name}」`, pos);
  }
  if (receiver.t === 'Formula') {
    if (name === 'eval' || name === 'bind') return methodNative(name, receiver, ctx);
    fail('O001', `Formula 没有字段「${name}」`, pos);
  }
  fail('O001', `${typeName(receiver)} 没有字段「${name}」`, pos);
}

/* ---------------------------------------------------------- 调用 */

function callValue(fn, args, pos, ctx, named = {}) {
  if (fn?.t === 'Native') {
    if (Number.isFinite(fn.arity) && fn.arity > 0 && args.length < fn.arity) {
      fail('C001', `${fn.name} 需要至少 ${fn.arity} 个参数`, pos);
    }
    ctx.enter(pos);
    try {
      const result = fn.fn(args, pos, ctx, named);
      return result ?? UNIT;
    } finally {
      ctx.leave();
    }
  }
  if (fn?.t === 'Fn') {
    let actual = args;
    const names = Object.keys(named);
    if (names.length) {
      actual = fn.params.map((p) => named[p.name]);
      let cursor = 0;
      for (let i = 0; i < actual.length; i += 1) {
        if (actual[i] === undefined) {
          if (cursor < args.length) actual[i] = args[cursor++];
          else actual[i] = NULL;
        }
      }
    }
    if (actual.length !== fn.params.length) {
      fail('C001', `${fn.name || '函数'} 需要 ${fn.params.length} 个参数，实际给了 ${actual.length} 个`, pos);
    }
    const env = new Env(fn.env);
    fn.params.forEach((p, i) => {
      if (p.annotation && !typeMatches(p.annotation, actual[i])) {
        fail('T001', `参数 ${p.name} 需要 ${p.annotation}，实际是 ${typeName(actual[i])}`, pos);
      }
      env.declare(p.name, actual[i], pos, 'Any');
    });
    if (fn.boundSelf) env.declare('self', fn.boundSelf, pos, 'Any');
    ctx.enter(pos);
    try {
      const body = fn.body;
      if (body.type === 'Block') return evalProgram(body.body, env, ctx);
      return evalNode(body, env, ctx);
    } catch (error) {
      if (error instanceof ReturnSignal) return error.value;
      throw error;
    } finally {
      ctx.leave();
    }
  }
  if (fn?.t === 'Obj' && fn.v.has('to_text')) {
    return callValue(fn.v.get('to_text'), args, pos, ctx, named);
  }
  fail('C001', `${typeName(fn)} 不是可调用值`, pos);
}

function evalFormula(formula, args, pos, ctx) {
  const explicit = args[0] ?? null;
  if (explicit && explicit.t !== 'Obj') {
    fail('C001', `公式上下文必须是 Object，实际是 ${typeName(explicit)}`, pos);
  }
  const merged = Obj([]);
  for (const [k, v] of formula.bound) merged.v.set(k, v);
  if (explicit) for (const [k, v] of explicit.v) merged.v.set(k, v);

  const fn = formula.fn;
  const param = fn.t === 'Fn' ? fn.params[0]?.name : null;
  if (param) {
    const needed = new Set();
    walkAst(fn.body, (n) => {
      if (n.type === 'Member' && n.object?.type === 'Ident' && n.object.name === param) {
        needed.add(n.property);
      }
    });
    for (const key of needed) {
      if (!merged.v.has(key)) {
        fail('C001', `缺少上下文属性「${key}」，可用 bind 提供默认值`, pos);
      }
    }
  }

  const previous = ctx.pure;
  ctx.pure = true;
  ctx.events.push({ kind: 'eval', id: ctx.stats.samples + 1, detail: 'Formula.eval 独立抽样', offset: pos });
  try {
    return callValue(fn, [merged], pos, ctx);
  } finally {
    ctx.pure = previous;
  }
}

/* ---------------------------------------------------------- 求值 */

function evalProgram(body, env, ctx) {
  let last = UNIT;
  for (const stmt of body) {
    ctx.step(stmt.start);
    last = evalStatement(stmt, env, ctx);
  }
  return last;
}

function evalStatement(stmt, env, ctx) {
  switch (stmt.type) {
    case 'Decl': {
      const value = evalNode(stmt.expr, env, ctx);
      env.declare(stmt.name, value, stmt.start, stmt.annotation);
      return UNIT;
    }
    case 'Assign': {
      if (ctx.pure) fail('F001', '公式体里不能赋值或改名状态', stmt.start);
      const value = evalNode(stmt.expr, env, ctx);
      assignTarget(stmt.target, value, env, ctx);
      return UNIT;
    }
    case 'FnDecl': {
      env.declare(stmt.name, {
        t: 'Fn', name: stmt.name, params: stmt.params, body: stmt.body,
        env, isMethod: false, boundSelf: null, start: stmt.start,
      }, stmt.start, 'Any');
      return UNIT;
    }
    case 'While': {
      if (ctx.pure) fail('F001', '公式体里不能执行循环', stmt.start);
      for (;;) {
        ctx.step(stmt.start);
        if (!requireBool(evalNode(stmt.cond, env, ctx), stmt.cond.start)) break;
        try {
          evalProgram(stmt.body.body, new Env(env), ctx);
        } catch (error) {
          if (error instanceof BreakSignal) break;
          if (error instanceof ContinueSignal) continue;
          throw error;
        }
      }
      return UNIT;
    }
    case 'Jump': {
      const value = stmt.expr ? evalNode(stmt.expr, env, ctx) : UNIT;
      if (stmt.kind === 'return') throw new ReturnSignal(value);
      if (stmt.kind === 'break') throw new BreakSignal();
      throw new ContinueSignal();
    }
    case 'ExprStmt':
      return evalNode(stmt.expr, env, ctx);
    default:
      fail('S002', `无法求值的语句 ${stmt.type}`, stmt.start);
      return UNIT;
  }
}

function assignTarget(target, value, env, ctx) {
  if (target.type === 'Ident') {
    if (ctx.pure) fail('F001', '公式体里不能赋值', target.start);
    return env.assign(target.name, value, target.start);
  }
  if (target.type === 'Member') {
    const receiver = evalNode(target.object, env, ctx);
    if (receiver.t !== 'Obj') {
      fail('T001', `${typeName(receiver)} 的字段是只读的`, target.start);
    }
    receiver.v.set(target.property, value);
    return UNIT;
  }
  if (target.type === 'Index') {
    const receiver = evalNode(target.object, env, ctx);
    const index = evalNode(target.index, env, ctx);
    if (receiver.t === 'List') {
      const i = normalizeIndex(asInt(index, target.start), receiver.v.length, target.start);
      receiver.v[i] = value;
      return UNIT;
    }
    if (receiver.t === 'Obj') {
      if (index.t !== 'Str') fail('C001', '对象键必须是 String，不会把数字隐式转成字符串', target.start);
      receiver.v.set(index.v, value);
      return UNIT;
    }
    fail('T001', `${typeName(receiver)} 不支持下标赋值`, target.start);
  }
  if (target.type === 'Slice') {
    const receiver = evalNode(target.object, env, ctx);
    if (receiver.t !== 'List' || value.t !== 'List') {
      fail('T001', '切片赋值只作用于 List，右侧也必须是 List', target.start);
    }
    const [from, to] = sliceBounds(target, receiver.v.length, env, ctx);
    receiver.v.splice(from, to - from, ...value.v);
    return UNIT;
  }
  fail('S002', '等号左侧不是可赋值目标', target.start);
}

function normalizeIndex(i, length, pos) {
  const at = i < 0 ? length + i : i;
  if (at < 0 || at >= length) fail('C001', `下标 ${i} 超出范围（长度 ${length}）`, pos);
  return at;
}

function sliceBounds(target, length, env, ctx) {
  const from = target.startExpr ? asInt(evalNode(target.startExpr, env, ctx), target.start) : 0;
  const to = target.endExpr ? asInt(evalNode(target.endExpr, env, ctx), target.start) : length;
  const a = from < 0 ? length + from : from;
  const b = to < 0 ? length + to : to;
  if (a < 0 || b > length || a > b) {
    fail('C001', `切片 [${from}:${to}] 超出范围（长度 ${length}）`, target.start);
  }
  return [a, b];
}

function evalNode(node, env, ctx) {
  if (!node) return UNIT;
  ctx.step(node.start);
  switch (node.type) {
    case 'Num': return node.isFloat ? Float(node.value) : Int(node.value);
    case 'Str': return Str(node.value);
    case 'Bool': return Bool(node.value);
    case 'NullLit': return NULL;
    case 'Ident': {
      const value = env.get(node.name, node.start);
      if (value === null) {
        fail('N001', `未声明的名字「${node.name}」`, node.start);
      }
      return value;
    }
    case 'Template': {
      let out = '';
      for (const part of node.parts) {
        if (part.type === 'TemplateText') out += part.value;
        else out += renderValue(evalNode(part.expr, env, ctx), ctx, part.expr.start);
      }
      return Str(out);
    }
    case 'RuleDice': return evalRuleText(node.code, ctx, node.start, `r"${node.code}"`);
    case 'Dice': return rollDice(Int(node.count), Int(node.faces), node.mods, ctx, node.start);
    case 'DiceInfix': {
      const count = evalNode(node.count, env, ctx);
      const faces = evalNode(node.faces, env, ctx);
      return rollDice(count, faces, node.mods, ctx, node.start);
    }
    case 'AssignExpr': {
      if (ctx.pure) fail('F001', '公式体里不能赋值或改名状态', node.start);
      const value = evalNode(node.expr, env, ctx);
      assignTarget(node.target, value, env, ctx);
      return UNIT;
    }
    case 'Unary': return evalUnary(node, env, ctx);
    case 'Binary': return evalBinary(node, env, ctx);
    case 'Conditional': {
      if (requireBool(evalNode(node.cond, env, ctx), node.cond.start)) {
        return evalNode(node.yes, env, ctx);
      }
      return evalNode(node.no, env, ctx);
    }
    case 'If': {
      if (requireBool(evalNode(node.cond, env, ctx), node.cond.start)) {
        return evalProgram(node.then.body, new Env(env), ctx);
      }
      if (!node.otherwise) return UNIT;
      if (node.otherwise.type === 'If') return evalNode(node.otherwise, env, ctx);
      return evalProgram(node.otherwise.body, new Env(env), ctx);
    }
    case 'List': return List(node.items.map((x) => evalNode(x, env, ctx)));
    case 'Range': {
      const from = asInt(evalNode(node.from, env, ctx), node.start);
      const to = asInt(evalNode(node.to, env, ctx), node.start);
      const step = from <= to ? 1 : -1;
      const size = Math.abs(to - from) + 1;
      if (size > 10000) fail('R001', `闭区间包含 ${size} 项，超出限额`, node.start);
      const items = [];
      for (let i = 0; i < size; i += 1) items.push(Int(from + i * step));
      return List(items);
    }
    case 'Object': {
      const map = new Map();
      for (const m of node.members) {
        if (m.kind === 'field') {
          map.set(m.key, evalNode(m.value, env, ctx));
        } else {
          map.set(m.key, {
            t: 'Fn', name: m.key, params: m.params, body: m.body,
            env, isMethod: true, boundSelf: null, start: m.start,
          });
        }
      }
      return { t: 'Obj', v: map };
    }
    case 'Lambda': return {
      t: 'Fn', name: null, params: node.params, body: node.body,
      env, isMethod: false, boundSelf: null, start: node.start,
    };
    case 'Member': {
      const receiver = evalNode(node.object, env, ctx);
      return resolveMember(receiver, node.property, node.start, ctx);
    }
    case 'Index': {
      const receiver = evalNode(node.object, env, ctx);
      const index = evalNode(node.index, env, ctx);
      if (receiver.t === 'List') {
        return receiver.v[normalizeIndex(asInt(index, node.start), receiver.v.length, node.start)];
      }
      if (receiver.t === 'Str') {
        const chars = Array.from(receiver.v);
        return Str(chars[normalizeIndex(asInt(index, node.start), chars.length, node.start)]);
      }
      if (receiver.t === 'Obj') {
        if (index.t !== 'Str') {
          fail('C001', '对象键必须是 String，不会把数字隐式转成字符串', node.start);
        }
        return resolveMember(receiver, index.v, node.start, ctx);
      }
      if (receiver.t === 'Roll') return resolveMember(receiver, String(display(index)), node.start, ctx);
      fail('C001', `${typeName(receiver)} 不支持下标读取`, node.start);
      return UNIT;
    }
    case 'Slice': {
      const receiver = evalNode(node.object, env, ctx);
      if (receiver.t === 'List') {
        const [a, b] = sliceBounds(node, receiver.v.length, env, ctx);
        return List(receiver.v.slice(a, b));
      }
      if (receiver.t === 'Str') {
        const chars = Array.from(receiver.v);
        const [a, b] = sliceBounds(node, chars.length, env, ctx);
        return Str(chars.slice(a, b).join(''));
      }
      fail('C001', `${typeName(receiver)} 不支持切片`, node.start);
      return UNIT;
    }
    case 'Call': {
      const positional = [];
      const named = {};
      for (const item of node.args.items) {
        const value = evalNode(item.expr, env, ctx);
        if (item.name) named[item.name] = value;
        else positional.push(value);
      }
      const callee = node.callee;
      if (callee.type === 'Member') {
        const receiver = evalNode(callee.object, env, ctx);
        const fn = resolveMember(receiver, callee.property, callee.start, ctx);
        return callValue(fn, positional, node.start, ctx, named);
      }
      const fn = evalNode(callee, env, ctx);
      return callValue(fn, positional, node.start, ctx, named);
    }
    default:
      fail('S002', `无法求值的表达式 ${node.type}`, node.start);
      return UNIT;
  }
}

function evalUnary(node, env, ctx) {
  const value = evalNode(node.arg, env, ctx);
  switch (node.op) {
    case '!': return Bool(!requireBool(value, node.start));
    case '~': return Int(~asInt(value, node.start));
    case '-': return numericBinary('-', Int(0), value, node.start, ctx);
    case '+': return numericBinary('+', Int(0), value, node.start, ctx);
    default: fail('S002', `不支持的单目运算 ${node.op}`, node.start);
  }
  return UNIT;
}

function evalBinary(node, env, ctx) {
  const op = node.op;
  const left = evalNode(node.left, env, ctx);
  if (op === '&&' || op === '||') {
    const a = requireBool(left, node.left.start);
    if (op === '&&' && !a) return FALSE;
    if (op === '||' && a) return TRUE;
    return Bool(requireBool(evalNode(node.right, env, ctx), node.right.start));
  }
  if (op === '??') {
    if (left.t === 'Null') return evalNode(node.right, env, ctx);
    return left;
  }
  const right = evalNode(node.right, env, ctx);
  if (op === '==') return Bool(strictEqual(left, right));
  if (op === '!=') return Bool(!strictEqual(left, right));
  if (['<', '<=', '>', '>='].includes(op)) return numericCompare(op, left, right, node.start);
  if (op === '+') {
    if (left.t === 'Str' && right.t === 'Str') return Str(left.v + right.v);
    if (left.t === 'List' && right.t === 'List') return List([...left.v, ...right.v]);
  }
  if (op === '*') {
    const list = left.t === 'List' ? left : right.t === 'List' ? right : null;
    const times = left.t === 'List' ? right : left;
    if (list) {
      const n = asInt(times, node.start);
      if (n < 0 || n > 10000) fail('R001', `列表重复 ${n} 次超出限额`, node.start);
      const items = [];
      for (let i = 0; i < n; i += 1) items.push(...list.v);
      return List(items);
    }
  }
  return numericBinary(op, left, right, node.start, ctx);
}

/** 渲染边界：对象可声明 to_text()，错误不得被吞成空文本。 */
export function renderValue(value, ctx, pos) {
  if (value?.t === 'Obj' && value.v.has('to_text')) {
    const fn = value.v.get('to_text');
    const previous = ctx.rendering;
    ctx.rendering = true;
    try {
      const result = callValue(fn, [], pos, ctx);
      if (result?.t !== 'Str') {
        fail('H001', 'to_text() 必须返回 String', pos);
      }
      return result.v;
    } finally {
      ctx.rendering = previous;
    }
  }
  return display(value);
}

/* ---------------------------------------------------------- 运行入口 */

function runHostText(source, blocks, ctx) {
  const shared = createGlobals(ctx);
  let text = '';
  let cursor = 0;
  const parts = [];
  for (const block of blocks) {
    text += source.slice(cursor, block.open);
    const ast = parseProgram(source, block.start, block.end);
    const value = evalProgram(ast.body, new Env(shared), ctx);
    const rendered = renderValue(value, ctx, block.start);
    text += rendered;
    parts.push({
      type: 'Block', start: block.open, end: block.close,
      body: ast.body, result: rendered,
    });
    ctx.events.push({
      kind: 'block', id: parts.length, detail: rendered || '（空结果）',
      offset: block.open,
    });
    cursor = block.close;
  }
  text += source.slice(cursor);
  return {
    ast: { type: 'HostText', parts, start: 0, end: source.length },
    value: Str(text), text, statements: parts.reduce((n, p) => n + p.body.length, 0),
  };
}

export function run(source, options = {}) {
  try {
    return runInner(source, options);
  } catch (error) {
    throw locate(source, error);
  }
}

function runInner(source, options = {}) {
  const ctx = createRuntime(source, options);
  const started = Date.now();
  let output;
  let summary;
  const blocks = scanHostBlocks(source);
  if (blocks.length) {
    output = runHostText(source, blocks, ctx);
    summary = { statements: output.statements, nodes: 0, dice: 0, calls: 0 };
  } else {
    const ast = parseProgram(source);
    const env = createGlobals(ctx);
    const value = evalProgram(ast.body, env, ctx);
    output = { ast, value, text: renderValue(value, ctx, 0), statements: ast.body.length };
    summary = astSummary(ast);
  }
  return {
    ok: true,
    version: VERSION,
    mode: output.ast.type === 'HostText' ? 'host' : 'script',
    value: output.value,
    text: output.text,
    valueType: typeName(output.value),
    ast: output.ast,
    trace: ctx.events,
    stats: { ...ctx.stats, statements: output.statements, ...summary, elapsed: Date.now() - started },
    jsonValue: toJsonValue(output.value),
  };
}

export { DSError };
