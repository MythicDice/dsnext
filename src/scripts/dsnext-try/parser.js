/* DiceScript Next v0.1 语法分析与静态诊断。
 * AST 全为纯 JSON 数据，供在线尝试的解析树面板与 Node 自检共用。
 */
import { fail, GLOBAL_NAMES } from './core.js';
import { tokenize } from './lexer.js';

const BINARY_LEVELS = [
  ['||'], ['&&'], ['|'], ['&'], ['==', '!='], ['<', '<=', '>', '>='],
  ['<<', '>>'], ['+', '-'], ['*', '/', '%'],
];
const UNARY_OPS = new Set(['+', '-', '!', '~']);
const MOD_WORD = /^(min|max|kh|kl|k|q|dh|dl|优势|劣势)(\d*)$/;
const TYPE_WORDS = new Set([
  'Int', 'Float', 'Bool', 'String', 'Null', 'Unit', 'List', 'Object',
  'Function', 'Roll', 'Formula', 'Any',
]);

const FIXED_ARITY = {
  abs: [1, 1], floor: [1, 1], ceil: [1, 1], round: [1, 1],
  Int: [1, 1], Float: [1, 1], String: [1, 1], Bool: [1, 1],
  repr: [1, 1], typeOf: [1, 1], bitXor: [2, 2], roll: [1, 1], formula: [1, 1],
  min: [1, Infinity], max: [1, Infinity],
};

class Parser {
  constructor(source, tokens) {
    this.source = source;
    this.tokens = tokens;
    this.p = 0;
    this.paren = 0;   // 圆括号与方括号：内部换行按空白处理
    this.braces = 0;  // 花括号：块与对象字面量
  }

  peek(k = 0) { return this.tokens[Math.min(this.p + k, this.tokens.length - 1)]; }
  at(type, value) {
    const t = this.peek();
    return t.type === type && (value === undefined || t.value === value);
  }
  atOp(value) { return this.at('op', value); }
  eof() { return this.peek().type === 'eof'; }
  next() { return this.tokens[this.p++]; }
  skipNL() { while (this.at('nl')) this.next(); }
  skipSeparators() { while (this.at('nl') || this.atOp(';')) this.next(); }
  peekPastNL(k = 0) {
    let i = this.p;
    while (this.tokens[i]?.type === 'nl') i += 1;
    return this.tokens[Math.min(i + k, this.tokens.length - 1)];
  }
  /** 当前 token 之后的第一个有效 token（跳过中间换行）。 */
  peekNextPastNL() {
    let i = this.p + 1;
    while (this.tokens[i]?.type === 'nl') i += 1;
    return this.tokens[Math.min(i, this.tokens.length - 1)];
  }

  expect(type, value, message) {
    if (!this.at(type, value)) {
      const t = this.peek();
      fail('S002', message || `这里需要 ${value ?? type}，实际是「${t.value ?? '文件末尾'}」`, t.start);
    }
    return this.next();
  }

  /* ------------------------------------------------------------ 语句层 */

  parseProgram(stopAtBrace = false) {
    const start = this.peek().start;
    const body = [];
    this.skipSeparators();
    while (!this.eof() && !(stopAtBrace && this.atOp('}'))) {
      body.push(this.parseStatement());
      this.consumeSeparator(stopAtBrace);
    }
    return { type: 'Program', body, start, end: this.peek().start };
  }

  consumeSeparator(stopAtBrace) {
    if (this.eof() || (stopAtBrace && this.atOp('}'))) return;
    if (this.at('nl') || this.atOp(';')) {
      this.skipSeparators();
      return;
    }
    const t = this.peek();
    fail('S002', '连续两个完整表达式之间需要换行或分号', t.start);
  }

  parseBlock() {
    const open = this.expect('op', '{', '这里需要一个 { 块');
    this.braces += 1;
    const program = this.parseProgram(true);
    const close = this.expect('op', '}', '块缺少结束的 }');
    this.braces -= 1;
    return { type: 'Block', body: program.body, start: open.start, end: close.end };
  }

  looksLikeFunctionDecl() {
    if (!this.at('ident')) return false;
    if (this.tokens[this.p + 1]?.type !== 'op' || this.tokens[this.p + 1]?.value !== '(') return false;
    let k = this.p + 1;
    let depth = 0;
    while (k < this.tokens.length) {
      const t = this.tokens[k];
      if (t.type === 'eof') return false;
      if (t.type === 'op' && t.value === '(') depth += 1;
      else if (t.type === 'op' && t.value === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
      k += 1;
    }
    if (depth !== 0) return false;
    k += 1;
    if (this.tokens[k]?.type === 'op' && this.tokens[k]?.value === '->') {
      k += 1;
      if (this.tokens[k]?.type === 'ident') k += 1;
      if (this.tokens[k]?.type === 'op' && this.tokens[k]?.value === '?') k += 1;
    }
    while (this.tokens[k]?.type === 'nl') k += 1;
    return this.tokens[k]?.type === 'op' && this.tokens[k]?.value === '{';
  }

  parseType() {
    const t = this.expect('ident', undefined, '类型标注需要一个类型名');
    if (!TYPE_WORDS.has(t.value)) {
      fail('S002', `不认识的类型「${t.value}」`, t.start);
    }
    let name = t.value;
    if (this.atOp('?')) {
      this.next();
      name += '?';
    }
    return name;
  }

  parseStatement() {
    const t = this.peek();

    if (t.type === 'kw' && t.value === 'while') {
      this.next();
      const cond = this.parseExpr();
      const body = this.parseBlock();
      return { type: 'While', cond, body, start: t.start, end: body.end };
    }

    if (t.type === 'kw' && ['break', 'continue', 'return'].includes(t.value)) {
      this.next();
      let expr = null;
      const n = this.peek();
      if (!(this.at('nl') || this.atOp(';') || this.atOp('}') || this.eof()) && t.value === 'return') {
        expr = this.parseExpr();
      }
      return { type: 'Jump', kind: t.value, expr, start: t.start, end: expr?.end ?? t.end };
    }

    if (t.type === 'kw' && t.value === 'if') {
      const expr = this.parseIf();
      return { type: 'ExprStmt', expr, start: expr.start, end: expr.end };
    }

    if (t.type === 'ident') {
      if (this.tokens[this.p + 1]?.type === 'op' && this.tokens[this.p + 1]?.value === ':=') {
        this.next();
        this.next();
        const expr = this.parseExpr();
        return { type: 'Decl', name: t.value, annotation: null, expr, start: t.start, end: expr.end };
      }
      if (this.tokens[this.p + 1]?.type === 'op' && this.tokens[this.p + 1]?.value === ':'
          && this.tokens[this.p + 2]?.type === 'ident'
          && TYPE_WORDS.has(this.tokens[this.p + 2]?.value)) {
        this.next();
        this.next();
        const annotation = this.parseType();
        if (this.atOp('=')) {
          fail('S002', '带类型标注的声明必须写 :=，赋值用 = 只对已存在的名字有效', this.peek().start);
        }
        this.expect('op', ':=', '带类型标注的声明后面需要 :=');
        const expr = this.parseExpr();
        return { type: 'Decl', name: t.value, annotation, expr, start: t.start, end: expr.end };
      }
      if (this.looksLikeFunctionDecl()) {
        return this.parseFunctionDecl();
      }
    }

    const expr = this.parseExpr();
    if (this.atOp('=')) {
      this.next();
      if (!['Ident', 'Member', 'Index', 'Slice'].includes(expr.type)) {
        fail('S002', '等号左侧必须是可赋值的名字、字段、下标或切片', expr.start);
      }
      const value = this.parseExpr();
      return { type: 'Assign', target: expr, expr: value, start: expr.start, end: value.end };
    }
    return { type: 'ExprStmt', expr, start: expr.start, end: expr.end };
  }

  parseParams() {
    this.expect('op', '(');
    this.paren += 1;
    this.skipNL();
    const params = [];
    while (!this.atOp(')') && !this.eof()) {
      const name = this.expect('ident', undefined, '参数表里需要一个名字');
      let annotation = null;
      if (this.atOp(':')) {
        this.next();
        annotation = this.parseType();
      }
      params.push({ name: name.value, annotation });
      this.skipNL();
      if (this.atOp(',')) {
        this.next();
        this.skipNL();
      } else break;
    }
    this.expect('op', ')', '参数表缺少 )');
    this.paren -= 1;
    return params;
  }

  parseFunctionDecl() {
    const name = this.expect('ident');
    const params = this.parseParams();
    let returnType = null;
    if (this.atOp('->')) {
      this.next();
      returnType = this.parseType();
    }
    this.skipNL();
    const body = this.parseBlock();
    return {
      type: 'FnDecl', name: name.value, params, returnType, body,
      start: name.start, end: body.end,
    };
  }

  parseIf() {
    const kw = this.expect('kw', 'if');
    const cond = this.parseExpr();
    const then = this.parseBlock();
    let otherwise = null;
    const ahead = this.peekPastNL();
    if (ahead.type === 'kw' && ahead.value === 'else') {
      this.skipNL();
      this.next();
      this.skipNL();
      otherwise = this.peek().type === 'kw' && this.peek().value === 'if'
        ? this.parseIf()
        : this.parseBlock();
    }
    return {
      type: 'If', cond, then, otherwise,
      start: kw.start, end: otherwise?.end ?? then.end,
    };
  }

  /* ---------------------------------------------------------- 表达式层 */

  parseExpr() {
    if (this.at('kw', 'if')) return this.parseIf();
    return this.parseConditional();
  }

  parseConditional() {
    const cond = this.parseNullCoalesce();
    if (!this.atOp('?')) return cond;
    this.next();
    this.skipNL();
    const yes = this.parseExpr();
    this.expect('op', ':', '三目表达式缺少 :');
    this.skipNL();
    const no = this.parseConditional();
    return { type: 'Conditional', cond, yes, no, start: cond.start, end: no.end };
  }

  parseNullCoalesce() {
    const left = this.parseOr();
    if (!this.atOp('??')) return left;
    this.next();
    this.skipNL();
    const right = this.parseNullCoalesce();
    return { type: 'Binary', op: '??', left, right, start: left.start, end: right.end };
  }

  parseOr() { return this.parseBinaryLevel(0, () => this.parseAnd()); }
  parseAnd() { return this.parseBinaryLevel(1, () => this.parseBitOr()); }
  parseBitOr() { return this.parseBinaryLevel(2, () => this.parseBitAnd()); }
  parseBitAnd() { return this.parseBinaryLevel(3, () => this.parseEqual()); }

  parseEqual() {
    const left = this.parseCompare();
    const hit = this.findOperator(['==', '!=']);
    if (!hit) return left;
    this.consumeUpTo(hit);
    const right = this.parseCompare();
    return { type: 'Binary', op: hit.value, left, right, start: left.start, end: right.end };
  }

  parseCompare() {
    const left = this.parseShift();
    const hit = this.findOperator(['<', '<=', '>', '>=']);
    if (!hit) return left;
    this.consumeUpTo(hit);
    const right = this.parseShift();
    if (this.findOperator(['<', '<=', '>', '>='])) {
      fail('S002', '比较运算不可链式书写', right.end);
    }
    return { type: 'Binary', op: hit.value, left, right, start: left.start, end: right.end };
  }

  parseShift() { return this.parseBinaryLevel(6, () => this.parseAdd()); }
  parseAdd() { return this.parseBinaryLevel(7, () => this.parseMul()); }
  parseMul() { return this.parseBinaryLevel(8, () => this.parseUnary()); }

  findOperator(ops) {
    const direct = this.peek();
    if (direct.type === 'op' && ops.includes(direct.value)) return direct;
    // 只在圆括号与方括号内部允许「换行后接运算符」继续同一个表达式。
    if (this.paren > 0) {
      const ahead = this.peekPastNL();
      if (ahead.type === 'op' && ops.includes(ahead.value) && this.at('nl')) return ahead;
    }
    return null;
  }

  consumeUpTo(token) {
    while (this.p < this.tokens.length && this.tokens[this.p] !== token) this.next();
    if (this.peek() === token) this.next();
    this.skipNL();
  }

  parseBinaryLevel(level, sub) {
    const ops = BINARY_LEVELS[level];
    let left = sub();
    for (;;) {
      const hit = this.findOperator(ops);
      if (!hit) break;
      this.consumeUpTo(hit);
      const right = sub();
      left = { type: 'Binary', op: hit.value, left, right, start: left.start, end: right.end };
    }
    return left;
  }

  parseUnary() {
    const t = this.peek();
    if (t.type === 'op' && UNARY_OPS.has(t.value)) {
      this.next();
      this.skipNL();
      const arg = this.parseUnary();
      return { type: 'Unary', op: t.value, arg, start: t.start, end: arg.end };
    }
    return this.parsePow();
  }

  parsePow() {
    const left = this.parseDiceExpr();
    const hit = this.findOperator(['**', '^']);
    if (!hit) return left;
    this.consumeUpTo(hit);
    const right = this.parsePow();
    return { type: 'Binary', op: hit.value, left, right, start: left.start, end: right.end };
  }

  parseDiceExpr() {
    let left = this.parsePostfix();
    for (;;) {
      if (!this.at('ident', 'd')) break;
      this.next();
      this.skipNL();
      // 面数操作数只取一个原子，避免把后面的 .total 误当成面数表达式的成员。
      const faces = this.parseAtom();
      const mods = this.consumeDiceMods();
      left = { type: 'DiceInfix', count: left, faces, mods, start: left.start, end: faces.end };
      left = this.parsePostfixTail(left);
    }
    return left;
  }

  consumeDiceMods() {
    const mods = [];
    for (;;) {
      const t = this.peek();
      if (t.type !== 'ident') break;
      const m = MOD_WORD.exec(t.value);
      if (!m) break;
      mods.push({ name: m[1], n: m[2] === '' ? null : Number(m[2]) });
      this.next();
    }
    return mods;
  }

  parsePostfix() {
    return this.parsePostfixTail(this.parseAtom());
  }

  parsePostfixTail(node) {
    for (;;) {
      if (this.atOp('.')) {
        this.next();
        if (this.paren > 0) this.skipNL();
        const name = this.expect('ident', undefined, '点号后面需要字段名');
        node = { type: 'Member', object: node, property: name.value, start: node.start, end: name.end };
        continue;
      }
      if (this.atOp('[')) {
        node = this.parseBracketAccess(node);
        continue;
      }
      if (this.atOp('(')) {
        const args = this.parseCallArgs();
        node = { type: 'Call', callee: node, args, start: node.start, end: args.end };
        continue;
      }
      break;
    }
    return node;
  }

  parseBracketAccess(object) {
    const open = this.expect('op', '[');
    this.paren += 1;
    this.skipNL();
    let first = null;
    if (!this.atOp(':') && !this.atOp(']')) first = this.parseExpr();
    if (this.atOp(':')) {
      this.next();
      this.skipNL();
      let second = null;
      if (!this.atOp(']')) second = this.parseExpr();
      const close = this.expect('op', ']', '切片缺少 ]');
      this.paren -= 1;
      return {
        type: 'Slice', object, startExpr: first, endExpr: second,
        start: object.start, end: close.end,
      };
    }
    const close = this.expect('op', ']', '下标缺少 ]');
    this.paren -= 1;
    if (!first) fail('S002', '方括号里需要一个下标表达式', open.start);
    return { type: 'Index', object, index: first, start: object.start, end: close.end };
  }

  parseCallArgs() {
    const open = this.expect('op', '(');
    this.paren += 1;
    this.skipNL();
    const items = [];
    while (!this.atOp(')') && !this.eof()) {
      let name = null;
      if (this.at('ident') && this.tokens[this.p + 1]?.type === 'op'
          && this.tokens[this.p + 1]?.value === ':') {
        name = this.next().value;
        this.next();
        this.skipNL();
      }
      const expr = this.parseExpr();
      items.push({ name, expr });
      this.skipNL();
      if (this.atOp(',')) {
        this.next();
        this.skipNL();
      } else break;
    }
    const close = this.expect('op', ')', '参数表缺少 )');
    this.paren -= 1;
    return { items, start: open.start, end: close.end };
  }

  looksLikeParenLambda() {
    let k = this.p;
    let depth = 0;
    while (k < this.tokens.length) {
      const t = this.tokens[k];
      if (t.type === 'eof') return false;
      if (t.type === 'op' && t.value === '(') depth += 1;
      else if (t.type === 'op' && t.value === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
      k += 1;
    }
    if (depth !== 0) return false;
    k += 1;
    while (this.tokens[k]?.type === 'nl') k += 1;
    return this.tokens[k]?.type === 'op' && this.tokens[k]?.value === '=>';
  }

  parseLambda() {
    const start = this.peek().start;
    let params;
    if (this.at('ident')) {
      params = [{ name: this.next().value, annotation: null }];
    } else {
      params = this.parseParams();
    }
    if (this.paren === 0) this.skipNL();
    this.expect('op', '=>', '匿名函数缺少 =>');
    this.skipNL();
    const body = this.atOp('{') ? this.parseBlock() : this.parseLambdaBody();
    return { type: 'Lambda', params, body, start, end: body.end };
  }

  /** 匿名函数的表达式体允许出现赋值，供公式效果检查判定 F001。 */
  parseLambdaBody() {
    const expr = this.parseExpr();
    if (!this.atOp('=')) return expr;
    if (!['Ident', 'Member', 'Index', 'Slice'].includes(expr.type)) {
      fail('S002', '等号左侧必须是可赋值的名字、字段、下标或切片', expr.start);
    }
    this.next();
    const value = this.parseExpr();
    return { type: 'AssignExpr', target: expr, expr: value, start: expr.start, end: value.end };
  }

  parseList() {
    const open = this.expect('op', '[');
    this.paren += 1;
    this.skipNL();
    const items = [];
    if (this.atOp(']')) {
      this.next();
      this.paren -= 1;
      return { type: 'List', items, start: open.start, end: this.tokens[this.p - 1].end };
    }
    const first = this.parseExpr();
    if (this.atOp('..')) {
      this.next();
      this.skipNL();
      const last = this.parseExpr();
      const close = this.expect('op', ']', '闭区间缺少 ]');
      this.paren -= 1;
      return { type: 'Range', from: first, to: last, start: open.start, end: close.end };
    }
    items.push(first);
    for (;;) {
      this.skipNL();
      if (this.atOp(',')) {
        this.next();
        this.skipNL();
        if (this.atOp(']')) break;
        items.push(this.parseExpr());
        continue;
      }
      break;
    }
    const close = this.expect('op', ']', '列表缺少 ]');
    this.paren -= 1;
    return { type: 'List', items, start: open.start, end: close.end };
  }

  parseObject() {
    const open = this.expect('op', '{');
    this.braces += 1;
    this.skipSeparators();
    const members = [];
    while (!this.atOp('}') && !this.eof()) {
      const keyTok = this.peek();
      if (keyTok.type !== 'ident' && keyTok.type !== 'str' && keyTok.type !== 'kw') {
        fail('S002', '对象成员的键必须是名字或字符串', keyTok.start);
      }
      const key = this.next().value;
      if (this.atOp(':')) {
        this.next();
        this.skipNL();
        const value = this.parseExpr();
        members.push({ kind: 'field', key, value, start: keyTok.start, end: value.end });
      } else if (this.atOp('(')) {
        const params = this.parseParams();
        let returnType = null;
        if (this.atOp('->')) {
          this.next();
          returnType = this.parseType();
        }
        this.skipNL();
        const body = this.parseBlock();
        members.push({
          kind: 'method', key, params, returnType, body,
          start: keyTok.start, end: body.end,
        });
      } else {
        fail('S002', `对象成员「${key}」后面需要 : 或参数表`, keyTok.end);
      }
      this.skipSeparators();
      if (this.atOp(',')) {
        this.next();
        this.skipSeparators();
        continue;
      }
      if (this.atOp('}')) break;
      fail('S002', '对象成员之间需要逗号', this.peek().start);
    }
    const close = this.expect('op', '}', '对象字面量缺少 }');
    this.braces -= 1;
    return { type: 'Object', members, start: open.start, end: close.end };
  }

  parseAtom() {
    const t = this.peek();

    if (t.type === 'num') {
      this.next();
      return { type: 'Num', value: t.value, isFloat: t.isFloat, start: t.start, end: t.end };
    }
    if (t.type === 'str') {
      this.next();
      return { type: 'Str', value: t.value, start: t.start, end: t.end };
    }
    if (t.type === 'tpl') {
      this.next();
      const parts = t.value.map((part) => part.t === 'text'
        ? { type: 'TemplateText', value: part.text }
        : { type: 'TemplateExpr', expr: parseExpressionRange(this.source, part.start, part.end) });
      return { type: 'Template', parts, start: t.start, end: t.end };
    }
    if (t.type === 'rulestr') {
      this.next();
      return { type: 'RuleDice', code: t.value, start: t.start, end: t.end };
    }
    if (t.type === 'dice') {
      this.next();
      return {
        type: 'Dice', count: t.value.count, faces: t.value.faces, mods: t.value.mods,
        literal: true, start: t.start, end: t.end,
      };
    }
    if (t.type === 'kw') {
      if (t.value === 'true' || t.value === 'false') {
        this.next();
        return { type: 'Bool', value: t.value === 'true', start: t.start, end: t.end };
      }
      if (t.value === 'null') {
        this.next();
        return { type: 'NullLit', start: t.start, end: t.end };
      }
      if (t.value === 'self') {
        this.next();
        return { type: 'Ident', name: 'self', start: t.start, end: t.end };
      }
    }
    if (t.type === 'ident') {
      const ahead = this.peekNextPastNL();
      if (ahead.type === 'op' && ahead.value === '=>') {
        this.skipNL();
        return this.parseLambda();
      }
      this.next();
      return { type: 'Ident', name: t.value, start: t.start, end: t.end };
    }
    if (this.atOp('(')) {
      if (this.looksLikeParenLambda()) return this.parseLambda();
      const open = this.next();
      this.paren += 1;
      this.skipNL();
      const expr = this.parseExpr();
      const close = this.expect('op', ')', '括号表达式缺少 )');
      this.paren -= 1;
      return { ...expr, start: open.start, end: close.end };
    }
    if (this.atOp('[')) return this.parseList();
    if (this.atOp('{')) return this.parseObject();

    fail('S002', `这里不是表达式开头：「${t.value ?? '文件末尾'}」`, t.start);
    return null;
  }
}

/** 解析模板插值里的单个表达式，token 下标仍指向整段源码。 */
export function parseExpressionRange(source, start, end) {
  const tokens = tokenize(source, start, end);
  const parser = new Parser(source, tokens);
  const expr = parser.parseExpr();
  parser.skipNL();
  if (!parser.eof()) {
    fail('S002', '模板插值里只能写一个表达式', parser.peek().start);
  }
  return expr;
}

export function parseProgram(source, start = 0, end = source.length) {
  const tokens = tokenize(source, start, end);
  const parser = new Parser(source, tokens);
  const ast = parser.parseProgram();
  if (!parser.eof()) fail('S002', '程序末尾存在无法解析的内容', parser.peek().start);
  staticCheck(ast, source);
  return ast;
}

/* ------------------------------------------------------------ 静态诊断 */

export function walkAst(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walkAst(child, visit);
    return;
  }
  if (typeof node.type === 'string') visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    if (value && typeof value === 'object') walkAst(value, visit);
  }
}

function collectNames(node, out) {
  walkAst(node, (n) => {
    if (n.type === 'Decl' || n.type === 'FnDecl') out.add(n.name);
    if (n.type === 'Lambda' || n.type === 'FnDecl') {
      for (const p of n.params) out.add(p.name);
    }
    if (n.type === 'Object') {
      for (const m of n.members) {
        if (m.kind === 'method') for (const p of m.params) out.add(p.name);
      }
    }
  });
}

function editDistance(a, b) {
  const m = Array.from(a).length;
  const n = Array.from(b).length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = Array.from(a)[i - 1] === Array.from(b)[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function validateDice(node) {
  const mods = node.mods || [];
  const count = node.literal ? node.count : null;
  const faces = node.literal ? node.faces : null;
  if (node.literal && (count < 1 || faces < 1)) {
    fail('D001', `${count}d${faces} 的骰数与骰面都必须是正整数`, node.start);
  }
  const filters = new Set();
  let sawFilter = false;
  let advantage = false;
  for (const mod of mods) {
    const isClamp = mod.name === 'min' || mod.name === 'max';
    const isAdv = mod.name === '优势' || mod.name === '劣势';
    if (isAdv) {
      advantage = true;
      continue;
    }
    if (isClamp) {
      if (sawFilter) fail('D001', 'min 与 max 必须写在取高取低修饰之前', node.start);
      if (mod.n === null || mod.n < 1) {
        fail('D001', `${mod.name} 需要写明一个正整数下限或上限`, node.start);
      }
      continue;
    }
    sawFilter = true;
    const group = ['kh', 'k'].includes(mod.name) ? 'kh'
      : ['kl', 'q'].includes(mod.name) ? 'kl'
        : mod.name === 'dh' ? 'dh' : 'dl';
    if (filters.has(group)) fail('D001', `同一类筛选修饰「${group}」不能连用两次`, node.start);
    filters.add(group);
    const keep = mod.n === null ? 1 : mod.n;
    if (keep < 1) fail('D001', '筛选的骰子数量必须大于 0', node.start);
    if (node.literal && keep > count) {
      fail('D001', `保留或丢弃的骰子数量 ${keep} 超过总骰数 ${count}`, node.start);
    }
  }
  if (advantage && sawFilter) {
    fail('D001', '优势与劣势不能与其他取高取低修饰连用', node.start);
  }
}

function hasMutation(node) {
  let found = false;
  walkAst(node, (n) => {
    if (['Assign', 'AssignExpr', 'While'].includes(n.type)) found = true;
    if (n.type === 'Call' && n.callee?.type === 'Member'
        && ['push', 'pop', 'shift'].includes(n.callee.property)) found = true;
  });
  return found;
}

function checkBody(body, allNames) {
  const declared = new Set();
  for (const stmt of body) {
    if (stmt.type === 'Decl' || stmt.type === 'FnDecl') {
      if (declared.has(stmt.name)) {
        fail('N002', `同一作用域里重复声明了「${stmt.name}」`, stmt.start);
      }
      declared.add(stmt.name);
    }
  }
  const visible = new Set([...GLOBAL_NAMES, ...allNames, ...declared]);
  for (const stmt of body) {
    const nested = [];
    walkAst(stmt, (n) => {
      if (n.type === 'Ident' && n.name !== 'self' && !visible.has(n.name)) {
        let hint = '';
        for (const name of allNames) {
          if (editDistance(n.name, name) <= 1) {
            hint = `；是否想使用「${name}」`;
            break;
          }
        }
        fail('N001', `未声明的名字「${n.name}」${hint}`, n.start);
      }
      if (n.type === 'If' || n.type === 'While') {
        const cond = n.cond;
        if (['Num', 'Str', 'List', 'Object', 'NullLit'].includes(cond?.type)) {
          fail('T002', '条件必须是 Bool，这里写的是字面量值', cond.start);
        }
      }
      if (n.type === 'Dice') validateDice(n);
      if (n.type === 'DiceInfix') validateDice({ ...n, mods: n.mods, literal: false });
      if (n.type === 'Call' && n.callee?.type === 'Ident') {
        const arity = FIXED_ARITY[n.callee.name];
        if (arity && (n.args.items.length < arity[0] || n.args.items.length > arity[1])) {
          fail('C001', `${n.callee.name} 需要 ${arity[0]} 个参数，实际写了 ${n.args.items.length} 个`, n.start);
        }
        if (n.callee.name === 'Int' && n.args.items.length === 1
            && n.args.items[0].expr?.type === 'Str'
            && !/^[+-]?\d+$/.test(n.args.items[0].expr.value)) {
          fail('C001', `Int("${n.args.items[0].expr.value}") 不是十进制整数`, n.start);
        }
        if (n.callee.name === 'formula') {
          const arg = n.args.items[0]?.expr;
          if (arg?.type === 'Lambda' && hasMutation(arg.body)) {
            fail('F001', '公式体里不能赋值、修改对象或执行循环', arg.start);
          }
        }
      }
      if (n.type === 'Block' || n.type === 'If' || n.type === 'While'
          || n.type === 'Lambda' || n.type === 'FnDecl' || n.type === 'Object') nested.push(n);
    });
    // 嵌套块沿用外层全部名字，重复声明在各自的块里单独检查。
    for (const n of nested) {
      if (n.type === 'Block') checkBody(n.body, allNames);
      else if (n.type === 'If') {
        checkBody(n.then.body, allNames);
        if (n.otherwise?.body) checkBody(n.otherwise.body, allNames);
      } else if (n.type === 'While') checkBody(n.body.body, allNames);
      else if (n.type === 'Lambda' || n.type === 'FnDecl') {
        checkBody(n.body.body || [n.body], allNames);
      } else if (n.type === 'Object') {
        for (const m of n.members) {
          if (m.kind === 'method') checkBody(m.body.body, allNames);
        }
      }
    }
  }
}

export function staticCheck(ast) {
  const allNames = new Set();
  collectNames(ast, allNames);
  checkBody(ast.body, allNames);
  return ast;
}

export function astSummary(ast) {
  let statements = ast.body.length;
  let nodes = 0;
  let dice = 0;
  let calls = 0;
  walkAst(ast, (n) => {
    nodes += 1;
    if (n.type === 'Dice' || n.type === 'DiceInfix' || n.type === 'RuleDice') dice += 1;
    if (n.type === 'Call') calls += 1;
  });
  return { statements, nodes, dice, calls };
}
