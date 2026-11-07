/* 解释器一致性自检
 * 核对示例、错例、抽样与引用分离、Roll 轨迹、Formula 延迟、类型约束、
 * 诊断定位与源码复现性。运行：pnpm verify
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { run, VERSION } from '../src/scripts/dsnext-try/interpreter.js';
import { checkSource } from '../src/scripts/dsnext-try/check.js';
import { EXAMPLES, ERROR_EXAMPLES } from '../src/scripts/dsnext-try/examples.js';
import { positionAt } from '../src/scripts/dsnext-try/core.js';
import { describeError } from '../src/scripts/dsnext-try/diagnostics.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptDir = resolve(root, 'src/scripts/dsnext-try');

let passed = 0;
const failures = [];
const check = (label, fn) => {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
  }
};
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

const expectError = (src, code) => {
  try {
    run(src);
  } catch (error) {
    assert(error.code === code, `期望 ${code}，实际 ${error.code}：${error.detail}`);
    return error;
  }
  throw new Error(`期望 ${code}，实际执行成功`);
};

check('语言版本', () => assert(VERSION === '0.1', `版本不是 0.1：${VERSION}`));

for (const [i, example] of EXAMPLES.entries()) {
  check(`示例 ${i + 1} 可执行`, () => {
    const r = run(example.code);
    assert(r.ok, '解释结果没有成功标记');
    assert(typeof r.text === 'string', '缺少渲染文字');
    assert(r.ast && typeof r.ast.type === 'string', '缺少 AST');
    assert(Array.isArray(r.trace), '缺少轨迹');
    assert(r.stats.steps > 0, '执行步数为零');
  });
  check(`示例 ${i + 1} 无中点`, () => {
    assert(!example.code.includes('·'), '示例里出现中点');
  });
}

for (const [i, example] of ERROR_EXAMPLES.entries()) {
  check(`错例 ${i + 1} 诊断码 ${example.expect}`, () => {
    const error = expectError(example.code, example.expect);
    assert(Number.isFinite(error.offset), '诊断缺少源码偏移');
    assert(Number.isFinite(error.utf16Offset), '诊断缺少 UTF-16 偏移');
  });
  check(`错例 ${i + 1} 无中点`, () => {
    assert(!example.code.includes('·'), '错例里出现中点');
  });
}

check('实时检查入口与缓存', () => {
  const src = EXAMPLES[0].code;
  const first = checkSource(src);
  const second = checkSource(src);
  assert(first === second, '相同源码没有命中同一次解释结果');
  assert(first.ok, '示例被判为错误');
  const bad = checkSource(ERROR_EXAMPLES[0].code);
  assert(!bad.ok && bad.error.code === ERROR_EXAMPLES[0].expect, '错例没有进入诊断通道');
  assert(Number.isFinite(bad.error.line) && Number.isFinite(bad.error.column), '诊断缺少行列号');
});

const samples = (r) => r.trace.filter((e) => e.kind === 'roll' && e.trace?.op === 'dice').length;

check('抽样与引用分离', () => {
  const r = run('r := d6\n[r.total, r.total, r.total]');
  assert(samples(r) === 1, '读取变量触发了新的抽样');
  const two = run('[d6, d6].sum()');
  assert(samples(two) === 2, '两个骰点表达式应当各抽样一次');
});

check('Roll 轨迹与字段', () => {
  const r = run('r := 2d20kh1 + 3\n[r.total, r.faces, r.dice, r.detail, r.trace]');
  assert(r.valueType === 'List', 'Roll 字段组合不是列表');
  assert(r.text.includes('2d20kh1'), 'detail 没有保留修饰符');
  const rolls = r.trace.filter((e) => e.kind === 'roll');
  assert(rolls.length >= 2, '运算没有生成带轨迹的新 Roll');
  assert(rolls.some((e) => e.trace?.op === 'arith'), '缺少算术轨迹节点');
  assert(rolls.every((e) => Number.isFinite(e.trace?.id)), '抽样节点缺少身份');
});

check('规则骰轨迹带来源与参数', () => {
  const r = run('r"5a9k2"');
  const roll = r.trace.find((e) => e.kind === 'roll');
  assert(roll?.trace?.rule === 'wod', '规则来源没有写入轨迹');
  assert(roll.trace.params.pool === 5, '规则参数没有写入轨迹');
  assert(roll.trace.params.target === 2, '成功线没有写入轨迹');
});

check('Formula 读取不抽样，eval 与 bind 独立', () => {
  const r = run([
    '伤害 := formula(ctx => 2d6 + ctx.力量)',
    '角色 := { 力量: 4, 攻击: 伤害 }',
    '读取 := 角色.攻击',
    '固定 := 伤害.bind({ 力量: 2 })',
    '[读取, 伤害.eval({ 力量: 4 }), 伤害.eval({ 力量: 4 }), 固定.eval()]',
  ].join('\n'));
  assert(r.trace.filter((e) => e.kind === 'eval').length === 3, 'eval 次数不对');
  assert(samples(r) === 3, '读取公式触发了抽样');
  const list = r.text;
  assert(list.includes('Formula'), '读取字段没有返回 Formula 本身');
});

check('公式缺少上下文属性', () => {
  expectError('伤害 := formula(ctx => 2d6 + ctx.力量)\n伤害.eval({})', 'C001');
});

check('严格 Bool 与显式转换', () => {
  expectError('if 1 { 1 } else { 2 }', 'T002');
  expectError('while 0 { }', 'T002');
  assert(run('Bool(0)').text === 'false', 'Bool(0) 不是 false');
  assert(run('Bool("")').text === 'false', 'Bool("") 不是 false');
  assert(run('Bool(3)').text === 'true', 'Bool(3) 不是 true');
  assert(run('0').text === '0', '0 被吞成空文本');
  assert(run('false').text === 'false', 'false 被吞成空文本');
  assert(run('null').text === '', 'null 没有产生空替换');
});

check('类型推断约束与 Any', () => {
  expectError('hp := 12\nhp = "12"', 'T001');
  assert(run('变化: Any := 12\n变化 = "未知"\n变化').text === '未知', 'Any 没有放宽赋值');
  assert(run('可空: Int? := null\n可空 = 8\n可空').text === '8', '可空类型不能写回 Int');
});

check('对象方法绑定与提取后仍保留接收者', () => {
  assert(run('o := { x: 2, 加(n) { self.x + n } }\no.加(3)').text === '5', 'self 没有绑定');
  assert(run('o := { x: 2, 加(n) { self.x + n } }\nf := o.加\nf(3)').text === '5', '提取方法值丢失接收者');
  expectError('o := { HP: 12 }\no.hp', 'O001');
  assert(run('o := { HP: 12 }\no.get("hp", 0)').text === '0', 'get 没有返回默认值');
});

check('列表区间、切片与集合方法', () => {
  assert(run('[1..5]').text === '[1, 2, 3, 4, 5]', '闭区间不对');
  assert(run('[5..1]').text === '[5, 4, 3, 2, 1]', '反向区间不对');
  assert(run('a := [1..5]\na[1:3] = [8, 9]\na').text === '[1, 8, 9, 4, 5]', '切片赋值不对');
  assert(run('a := [1..5]\na.kh(2)').text === '9', 'kh 结果不对');
  assert(run('a := [1..5]\na.filter(x => x >= 4).len()').text === '2', 'filter 结果不对');
  assert(run('[7] * 3').text === '[7, 7, 7]', '列表重复不对');
  expectError('a := [1, 2]\na[5]', 'C001');
});

check('骰点修饰符顺序与预算', () => {
  expectError('3d6kh9', 'D001');
  expectError('3d0', 'D001');
  expectError('0d6', 'D001');
  expectError('2d20kh1kh1', 'D001');
  expectError('d20优势kh1', 'D001');
  expectError('1001d6', 'R001');
  assert(run('d20优势').valueType === 'Roll', '优势骰没有返回 Roll');
  assert(run('3d20min10').valueType === 'Roll', 'min 截断没有返回 Roll');
});

check('模板插值与转义', () => {
  assert(run('名字 := "艾琳"\n`角色 {名字}`').text === '角色 艾琳', '插值不对');
  assert(run('`字面 {{ 与 }}`').text === '字面 { 与 }', '花括号转义不对');
  assert(run('"字面 {名字}"').text === '字面 {名字}', '普通字符串被误插值');
  expectError('`角色 {名字 := 1}`', 'S002');
});

check('宿主文本执行块', () => {
  const r = run('侦查：{{ 骰 := d100; if 骰 <= actor.侦查 { `成功（{骰.total}）` } else { `失败（{骰.total}）` } }}\n生命：{{ actor.HP }}\n空：{{ null }}');
  assert(r.mode === 'host', '没有进入宿主文本模式');
  assert(r.text.includes('侦查：'), '执行块外的文字丢失');
  assert(r.text.includes('生命：12'), '第二个执行块没有求值');
  assert(r.text.includes('空：'), '空替换把周围文字删掉了');
  assert(r.ast.parts.length === 3, '执行块数量不对');
  assert(r.trace.filter((e) => e.kind === 'block').length === 3, '执行块轨迹数量不对');
});

check('执行块错误不被吞成空结果', () => {
  expectError('结果：{{ 1 + "x" }}', 'T001');
});

check('规则骰与普通标识符不冲突', () => {
  const r = run('b2 := 42\n[b2, r"b2".total]');
  assert(r.text.startsWith('[42, '), '普通标识符被规则骰抢占');
});

check('roll 只接受 String', () => {
  expectError('roll(d20)', 'C001');
  assert(run('roll("2d6+3")').valueType === 'Roll', '动态规则文本没有返回 Roll');
});

check('公式效果限制', () => {
  expectError('formula(ctx => state.HP = 1)', 'F001');
  expectError('formula(ctx => { state.HP = 1; ctx.x })', 'F001');
});

check('诊断位置按 Unicode 标量值计列', () => {
  const src = '角色 := "艾琳"\n力星 = 70';
  const error = expectError(src, 'N001');
  assert(error.line === 2, `行号不对：${error.line}`);
  assert(error.column === 1, `列号不对：${error.column}`);
  const pos = positionAt(src, src.indexOf('力星'));
  assert(pos.line === 2 && pos.column === 1, '位置换算不对');
});

check('同一源码可种子复现', () => {
  const src = '[3d6, 2d20kh1, r"b2"]';
  assert(run(src).text === run(src).text, '相同源码两次执行结果不同');
});

check('一键修复来自真实诊断且可执行', () => {
  let fixCount = 0;
  for (const example of ERROR_EXAMPLES) {
    let error;
    try {
      run(example.code);
      continue;
    } catch (e) {
      error = e;
    }
    const d = describeError(error, example.code);
    assert(d.code === example.expect, `${example.label} 诊断码不对`);
    assert(Array.isArray(d.suggestions) && d.suggestions.length > 0, `${example.label} 缺少建议`);
    if (!d.fix) continue;
    fixCount += 1;
    assert(typeof d.fix.text === 'string' && d.fix.text !== example.code, `${example.label} 的修复没有改动源码`);
    const fixed = run(d.fix.text);
    assert(fixed.ok, `${example.label} 应用修复后仍失败`);
  }
  assert(fixCount >= 5, `可一键修复的错例过少：${fixCount}`);
});

check('在线尝试脚本无中点与报告体', () => {
  const files = readdirSync(scriptDir).filter((f) => f.endsWith('.js')).sort();
  assert(files.length >= 8, `脚本数量不足：${files.length}`);
  const banned = /暂不|尚无|尚未|本站收录|当前状态|原型范围|实现路线图|不规定|由适配器/;
  for (const file of files) {
    const text = readFileSync(resolve(scriptDir, file), 'utf8');
    assert(!text.includes('·'), `${file} 出现中点`);
    const hit = banned.exec(text);
    assert(!hit, `${file} 出现报告体「${hit?.[0]}」`);
  }
});

console.log(`DiceScript Next 解释器自检：${passed} 项通过，${failures.length} 项失败`);
if (failures.length) {
  for (const line of failures) console.error(`  ✗ ${line}`);
  process.exitCode = 1;
}
