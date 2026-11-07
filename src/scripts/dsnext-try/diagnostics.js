/* 诊断知识库与教学式报错卡片。
 * 位置、说明与修复都来自本次真实解释结果，全部用 DOM API 构建。
 */

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

const FRIENDLY = '下面标出了位置、说明了规则，并给出可以直接照抄的写法。';

const CATALOG = {
  S001: {
    title: '词法没有闭合',
    summary: '字符串、反引号模板或模板插值缺少结束符号，也可能是转义写法不完整。',
    rule: '单引号与双引号是普通字符串，反引号是插值模板。`#` 到行末是注释。模板里的字面花括号写作 `{{` 与 `}}`，插值写作 `{expr}`。字符串必须以同一行的同一引号闭合。',
    lesson: '词法器逐字符扫描，引号没闭合就会一直读到行尾或文件末尾，所以报错位置通常在字符串的开头。',
    suggestions: [
      '补上配对的引号或反引号',
      '模板插值 `{expr}` 需要对应的 `}`',
      '检查反斜杠转义是否写完整',
    ],
    example: { label: '完整模板', code: '名字 := "艾琳"\n`角色 {名字}`' },
  },
  S002: {
    title: '语法结构不完整',
    summary: '语句边界、括号、参数表、对象成员或声明写法不符合文法。',
    rule: '语句以换行或 `;` 分隔；两个完整表达式不能只靠空格相连。对象成员必须用逗号分隔，末尾逗号允许。带类型标注的声明写 `x: Int := 1`，`x: Int = 1` 不合法。',
    lesson: '`{...}` 由上下文区分：赋值号后是对象字面量，`if`、`while` 与函数后是流程块。解析器按这个边界决定如何配对花括号。',
    suggestions: [
      '在两条语句之间换行或写分号',
      '检查括号、参数表与对象成员之间的逗号',
      '带类型标注的声明把 `=` 改成 `:=`',
    ],
    example: { label: '带标注的声明', code: 'x: Int := 1\nx = 2' },
  },
  N001: {
    title: '名字没有声明',
    summary: '读到了一个未声明的名字，赋值也不会自动创建名字。',
    rule: '`:=` 是唯一的声明操作符，`=` 只给已存在的名字赋值。`actor`、`state` 与内建函数由环境提供，不需要脚本声明；其他名字必须先写 `:=`。',
    lesson: '名字按词法作用域查找；控制流块里声明的名字只在该块有效。诊断会尝试给出一个拼写相近的已声明名字。',
    suggestions: [
      '把赋值改成 `:=` 来声明这个名字',
      '检查是否与已声明的名字只差一两个字',
      '需要跨块使用时把声明放到外层',
    ],
    example: { label: '先声明再赋值', code: '力量 := 60\n力量 = 70' },
  },
  N002: {
    title: '同一作用域重复声明',
    summary: '同一个词法作用域里出现了两次 `:=` 声明同一个名字。',
    rule: '同一层作用域内名字只能声明一次；内层同名遮蔽允许。给已有绑定换值写 `=`，不是再写一次 `:=`。',
    lesson: '重复声明通常是把「换值」误写成「新建」，明确区分两者可以让类型约束一直有效。',
    suggestions: ['把第二次 `:=` 改成 `=`', '确实要新值时换一个名字'],
    example: { label: '声明后赋值', code: 'x := 1\nx = 2\nx' },
  },
  T001: {
    title: '类型不兼容',
    summary: '运算或赋值使用了不允许的类型组合。',
    rule: '`Int` 与 `Float` 按数值提升运算，`/` 得到 `Float`，`%` 只作用于 `Int`。声明时推断出的类型会约束后续赋值；字符串不自动转数字，需要写 `Int("12")`。需要动态类型就用 `x: Any := ...`。',
    lesson: '推断得到的局部类型是约束，不是每次赋值都随意变化的提示。`Any` 会把检查留到运行时，不等于屏蔽错误。',
    suggestions: [
      '用 `Int(x)`、`Float(x)`、`String(x)` 显式转换',
      '把绑定标注为 `Any` 或可空类型',
      '检查 `Roll` 是否忘记取 `.total`',
    ],
    example: { label: '显式转换', code: 'hp := 12\nhp = Int("12")' },
  },
  T002: {
    title: '条件不是 Bool',
    summary: '`if`、`while`、三目、`&&`、`||` 与 `!` 要求操作数是 `Bool`。',
    rule: '`true` 与 `false` 是字面量，`Bool` 不是 `Int` 的别名。条件不会隐式应用真值转换：写 `if Bool(1) {}` 而不是 `if 1 {}`。',
    lesson: '`&&` 与 `||` 短路并返回 `Bool`；`??` 只识别 `null`，不会把所有假值都合并掉。',
    suggestions: [
      '把条件写成比较表达式，如 `x >= 10`',
      '需要真值转换时显式写 `Bool(x)`',
      '检查是否把 `??` 误当成逻辑或',
    ],
    example: { label: '严格 Bool 条件', code: 'x := 12\nif x >= 10 { "通过" } else { "未通过" }' },
  },
  C001: {
    title: '参数或转换不合法',
    summary: '调用的参数个数、参数类型或显式转换的输入不符合规定。',
    rule: '内建函数有明确的形参数量。`roll(text)` 只接受 `String`，传 `Roll` 会报类型错误；`f.eval(ctx)` 的上下文必须是 `Object`；列表下标越界与空列表的 `pop`、`shift`、`rand` 同样报错。',
    lesson: '`Int("abc")` 一类静态可判定的转换错误会在解析阶段给出；其余在求值时按同一诊断码报告。',
    suggestions: [
      '对照内建函数的形参数量表',
      '把动态规则文本写成字符串传给 `roll`',
      '检查下标、切片边界与空列表',
    ],
    example: { label: '合法调用', code: 'abs(-3)\nroll("2d6+3").total' },
  },
  O001: {
    title: '字段或方法不存在',
    summary: '读取了一个对象、列表、Roll 或 Formula 上不存在的名字。',
    rule: '对象用 `.key` 或 `["key"]` 读取同一个字段，键必须是 `String`；缺失字段用 `obj.get("key", default)`，判断存在用 `obj.has("key")`。`Roll` 提供 `total`、`faces`、`dice`、`trace`、`detail`。',
    lesson: '未知字段读取直接报错，不安静返回 `null`。诊断会在拼写相近时给出候选字段名。',
    suggestions: [
      '检查大小写，例如 `HP` 与 `hp`',
      '缺失时用 `obj.get("key", 0)`',
      '确认值是不是 `Roll`，需要数值就取 `.total`',
    ],
    example: { label: '带默认值的读取', code: '角色 := { HP: 12 }\n角色.get("hp", 0)' },
  },
  D001: {
    title: '骰点写法不合法',
    summary: '基础骰点的数量、骰面或修饰符组合不符合规定。',
    rule: '`NdM` 的骰数与骰面都必须是正整数，`0d6` 与 `d0` 无效。修饰符顺序为 `min`／`max` 截断 → `kh`／`kl`／`dh`／`dl` 筛选 → 汇总；同类筛选不能连用两次，`优势`／`劣势` 不与取高取低连用。',
    lesson: '保留或丢弃的数量不能超过总骰数。`r"..."` 里的规则骰走独立子文法，普通标识符不会被抢占。',
    suggestions: [
      '把 `kh`／`kl` 的数量改到总骰数以内',
      '检查骰面是否写成 0 或负数',
      '规则写法改用 `r"..."` 或 `roll("...")`',
    ],
    example: { label: '合法的取高骰', code: '3d6kh1' },
  },
  D002: {
    title: '规则没有注册',
    summary: '规则骰文本指向了当前环境未提供的规则。',
    rule: '`r"..."` 与 `roll(text)` 只解释已登记的规则：`b`／`p`、`f`、`XaYkZ`、`XcYmZ` 以及基础 `NdM`。`custom:` 前缀需要宿主提供对应规则实现。',
    lesson: '自定义规则不能改变主语言的标识符解析，也要返回标准的 `Roll`。',
    suggestions: [
      '改用已登记的规则写法',
      '基础骰点直接写 `2d6+3`',
      '检查 `roll` 的字符串有没有拼错',
    ],
    example: { label: '已登记的规则', code: 'roll("2d6+3")' },
  },
  F001: {
    title: '公式效果违规',
    summary: '公式体里出现了赋值、对象变更、循环或其他不允许的效果。',
    rule: '`formula(fn)` 的公式体允许读取 `ctx`、读取捕获的不变常量、调用纯函数与随机抽样；禁止赋值、持久状态写入、列表修改与循环。静态检查覆盖可判定的部分，求值时再次校验。',
    lesson: '公式只能延迟计算，不能借 `.eval()` 偷偷改状态。需要副作用就在普通函数里写。',
    suggestions: [
      '把赋值移到公式外面',
      '用 `ctx` 传入需要的值，而不是改 `state`',
      '需要循环时改用普通命名函数',
    ],
    example: { label: '纯计算公式', code: '伤害 := formula(ctx => 2d6 + ctx.力量)\n伤害.eval({ 力量: 4 })' },
  },
  R001: {
    title: '超出执行限额',
    summary: '执行步数、递归深度、骰子总数或区间长度超过了预算。',
    rule: '默认限额为 20,000 步、64 层递归、单次 1,000 枚骰、4,000 枚累计骰、10,000 项的闭区间。限额耗尽是诊断，不会静默截断结果。',
    lesson: '无限循环与超大骰池会被预算挡住，页面不会因此卡住。',
    suggestions: [
      '给 `while` 写明确的退出条件',
      '减少骰子枚数或闭区间长度',
      '把递归改成有边界的迭代',
    ],
    example: { label: '有边界的循环', code: 'i := 0\n总数 := 0\nwhile i < 5 { 总数 = 总数 + i; i = i + 1 }\n总数' },
  },
  P001: {
    title: '值不可序列化',
    summary: '公式捕获了没有恢复适配器的宿主原生值。',
    rule: '可序列化的脚本值包括原生值、列表、对象、函数、Roll 与 Formula。宿主原生值需要注册标识与适配器，没有适配器时报诊断，不伪造数据。',
    lesson: '保存 `Roll` 不重新抽样，恢复 `Formula` 不提前求值。',
    suggestions: ['把宿主原生值换成可序列化的脚本值'],
    example: null,
  },
  H001: {
    title: '渲染失败',
    summary: '`to_text()` 没有返回 `String`，或者在渲染边界产生了不允许的效果。',
    rule: '`to_text()` 只能做确定性无副作用计算，且必须返回 `String`。它只在渲染边界调用，普通读取、比较与赋值都不触发。',
    lesson: '渲染错误进入诊断通道，不会改成空字符串继续假装成功。',
    suggestions: ['让 `to_text()` 返回字符串', '把掷骰或状态写入移出 `to_text()`'],
    example: { label: '合法的 to_text', code: '卡片 := { 名字: "艾琳", to_text() { `角色 {self.名字}` } }\n卡片' },
  },
  E_UNKNOWN: {
    title: '解释未能完成',
    summary: '解释器抛出了一个未归类的错误。',
    rule: 'v0.1 的诊断码固定为 `S001`、`S002`、`N001`、`N002`、`T001`、`T002`、`C001`、`O001`、`D001`、`D002`、`F001`、`R001`、`P001`、`H001`。',
    lesson: '可以先对照原始诊断信息，或清空后从示例重新开始。',
    suggestions: ['清空编辑器，从一键填入示例重新开始'],
    example: null,
  },
};

function appendRich(parent, value) {
  const parts = String(value).split(/(`[^`]+`)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('`') && part.endsWith('`')) {
      parent.appendChild(el('code', 'diag-code', part.slice(1, -1)));
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  }
}

function lineBounds(source, offset) {
  const at = Math.max(0, Math.min(offset, source.length));
  const start = source.lastIndexOf('\n', Math.max(0, at - 1)) + 1;
  const nl = source.indexOf('\n', at);
  return { start, end: nl < 0 ? source.length : nl };
}

/** 根据真实诊断信息生成可一键应用的修复，只改有明确依据的写法。 */
function makeFix(code, detail, error, source) {
  const { start, end } = lineBounds(source, error?.offset ?? 0);
  const line = source.slice(start, end);
  const replaceLine = (next, label) => ({
    label,
    text: source.slice(0, start) + next + source.slice(end),
  });

  if (code === 'S002' && /带类型标注/.test(detail) && /\s=\s/.test(line)) {
    return replaceLine(line.replace(/\s=\s/, ' := '), '把 = 改成 :=');
  }
  if (code === 'S002' && /对象成员之间需要逗号/.test(detail)) {
    const at = Math.max(0, Math.min(error?.offset ?? 0, source.length));
    const before = source.slice(0, at);
    const gap = /\s*$/.exec(before)?.[0] ?? '';
    if (gap.length) {
      const insertAt = at - gap.length;
      return {
        label: '补一个逗号',
        text: source.slice(0, insertAt) + ',' + gap + source.slice(insertAt),
      };
    }
  }
  if (code === 'D001' && /保留或丢弃的骰子数量/.test(detail)) {
    const next = line.replace(/((?:kh|kl|k|q|dh|dl))(\d+)/, '$11');
    if (next !== line) return replaceLine(next, '把筛选数量改为 1');
  }
  if (code === 'N001') {
    const hint = /是否想使用「([^」]+)」/.exec(detail)?.[1];
    const bad = /未声明的名字「([^」]+)」/.exec(detail)?.[1];
    if (hint && bad && line.includes(bad)) {
      return replaceLine(line.replace(bad, hint), `改成「${hint}」`);
    }
  }
  if (code === 'T001' && /=\s*"(\d+)"/.test(line)) {
    const next = line.replace(/=\s*"(\d+)"/, '= Int("$1")');
    return replaceLine(next, '加显式转换');
  }
  if (code === 'T002' && /^if\s+1\b/.test(line)) {
    const next = line.replace(/^if\s+1\b/, 'if Bool(1)');
    return replaceLine(next, '显式写 Bool');
  }
  return null;
}

function refine(code, detail, error, source) {
  const out = { suggestions: [], example: null, fix: makeFix(code, detail, error, source) };
  const nameHint = /是否想使用「([^」]+)」/.exec(detail)?.[1];
  if (code === 'N001' && nameHint) {
    out.suggestions.push(`诊断给出的候选是「${nameHint}」，确认是不是拼写笔误。`);
  }
  if (code === 'C001' && /roll 需要 String/.test(detail)) {
    out.suggestions.push('已经掷出的 `Roll` 不会再抽样；需要新样本就重新求值骰点表达式。');
  }
  const fieldHint = /是否想写「([^」]+)」/.exec(detail)?.[1];
  if (code === 'O001' && fieldHint) {
    out.suggestions.push(`对象里存在相近的字段「${fieldHint}」，注意大小写。`);
  }
  if (code === 'D001' && /骰面都必须是正整数/.test(detail)) {
    out.example = { label: '合法骰面', code: '3d6' };
  }
  if (code === 'S002' && /对象成员之间需要逗号/.test(detail)) {
    out.example = { label: '对象成员用逗号分隔', code: '角色 := { HP: 12, 护甲: 2 }\n角色' };
    out.suggestions.push('在同一行的两个成员之间补一个逗号，末尾成员后面允许留逗号。');
  }
  if (code === 'R001' && /执行步数/.test(detail)) {
    out.suggestions.push('检查 `while` 的条件是不是恒为 `true`，或者循环体里忘记更新计数变量。');
  }
  if (code === 'F001') {
    out.example = { label: '纯计算公式', code: '伤害 := formula(ctx => 2d6 + ctx.力量)\n伤害.eval({ 力量: 4 })' };
  }
  return out;
}

function displayWidth(value) {
  let width = 0;
  for (const ch of value) width += ch.codePointAt(0) > 0x2e80 ? 2 : 1;
  return width;
}

/** 带行号与高亮标记的源码片段。列号按 Unicode 标量值计数。 */
function buildLocation(error, source) {
  if (!Number.isFinite(error?.line) || !Number.isFinite(error?.column)) return null;
  const all = source.split('\n');
  const index = Math.max(0, Math.min(all.length - 1, error.line - 1));
  const text = all[index];
  const codePoints = Array.from(text);
  const start = Math.max(0, Math.min(
    codePoints.slice(0, Math.max(0, error.column - 1)).join('').length,
    text.length,
  ));
  const rest = text.slice(start);
  const stop = /[\s,;:()[\]{}=+\-*/%<>!&|?]/.exec(rest);
  const length = Math.min(40, Math.max(1, stop?.index ?? rest.length));
  const end = Math.max(start + 1, Math.min(start + length, text.length));
  const atEnd = start >= text.length;

  const rows = [];
  for (let n = Math.max(0, index - 1); n <= Math.min(all.length - 1, index + 1); n += 1) {
    if (n === index) {
      rows.push({
        number: n + 1,
        isError: true,
        before: text.slice(0, start),
        mark: atEnd ? '␃' : text.slice(start, end),
        after: atEnd ? '' : text.slice(end),
      });
    } else {
      rows.push({ number: n + 1, isError: false, before: all[n], mark: '', after: '' });
    }
  }
  return {
    line: error.line,
    column: error.column,
    offset: error.codePointOffset ?? 0,
    rows,
    caret: displayWidth(text.slice(0, start)),
    eof: atEnd,
  };
}

export function describeError(error, source) {
  const code = error?.code || 'E_UNKNOWN';
  const base = CATALOG[code] || CATALOG.E_UNKNOWN;
  const detail = error?.detail || error?.message || String(error);
  const extra = refine(code, detail, error, source);
  return {
    code,
    title: base.title,
    friendly: FRIENDLY,
    summary: base.summary,
    detail,
    raw: error?.message || String(error),
    rule: base.rule,
    lesson: base.lesson,
    suggestions: [...extra.suggestions, ...base.suggestions],
    example: extra.example || base.example,
    fix: extra.fix,
    location: buildLocation(error, source),
  };
}

function section(title) {
  const box = el('section', 'diag-section');
  box.appendChild(el('h3', 'diag-h3', title));
  return box;
}

/** handlers: { onLocate, onApplyFix(text), onLoadExample(code) } */
export function buildDiagnosisCard(d, handlers = {}) {
  const card = el('div', 'diag');

  const head = el('div', 'diag-head');
  head.appendChild(el('span', 'diag-badge', '!'));
  const headText = el('div', 'diag-head-text');
  headText.appendChild(el('div', 'diag-title', d.title));
  headText.appendChild(el('div', 'diag-sub', d.friendly));
  head.appendChild(headText);
  const chips = el('div', 'diag-chips');
  chips.appendChild(el('span', 'diag-chip diag-chip-code', d.code));
  chips.appendChild(el('span', 'diag-chip', d.location
    ? `第 ${d.location.line} 行第 ${d.location.column} 列`
    : '结构校验阶段'));
  head.appendChild(chips);
  card.appendChild(head);

  const what = section('发生了什么');
  const whatP = el('p', 'diag-p');
  appendRich(whatP, d.summary);
  what.appendChild(whatP);
  const detailP = el('p', 'diag-detail');
  detailP.appendChild(el('span', 'diag-detail-label', '原始诊断  '));
  detailP.appendChild(document.createTextNode(d.detail));
  what.appendChild(detailP);
  card.appendChild(what);

  if (d.location) {
    const where = section('位置');
    const frag = el('div', 'diag-frag');
    for (const row of d.location.rows) {
      const line = el('div', row.isError ? 'diag-line is-error' : 'diag-line');
      line.appendChild(el('span', 'diag-ln', String(row.number)));
      const code = el('span', 'diag-src');
      if (row.before) code.appendChild(document.createTextNode(row.before));
      if (row.mark) code.appendChild(el('span', 'diag-hl', row.mark));
      if (row.after) code.appendChild(document.createTextNode(row.after));
      line.appendChild(code);
      frag.appendChild(line);
      if (row.isError) {
        const caret = el('div', 'diag-caret');
        caret.appendChild(el('span', 'diag-ln', ''));
        caret.appendChild(el('span', 'diag-src', `${' '.repeat(d.location.caret)}▲ 这里`));
        frag.appendChild(caret);
      }
    }
    where.appendChild(frag);
    where.appendChild(el('p', 'diag-note', d.location.eof
      ? '␃ 表示问题出在行尾或文本末尾，通常需要补上缺失的符号。'
      : `码点偏移 ${d.location.offset}；高亮部分就是解释器停下来的位置。`));
    card.appendChild(where);
  }

  const rule = section('这条规则');
  const ruleBox = el('div', 'diag-rule');
  appendRich(ruleBox, d.rule);
  rule.appendChild(ruleBox);
  const lesson = el('p', 'diag-p diag-lesson');
  appendRich(lesson, d.lesson);
  rule.appendChild(lesson);
  card.appendChild(rule);

  const how = section('怎么改');
  const list = el('ol', 'diag-steps');
  for (const item of d.suggestions) {
    const li = el('li');
    appendRich(li, item);
    list.appendChild(li);
  }
  how.appendChild(list);
  if (d.example) {
    const box = el('div', 'diag-example');
    box.appendChild(el('div', 'diag-example-label', `正确写法：${d.example.label}`));
    box.appendChild(el('code', 'diag-example-code', d.example.code));
    how.appendChild(box);
  }
  card.appendChild(how);

  const actions = el('div', 'diag-actions');
  const locate = el('button', 'diag-btn', '在编辑器中定位');
  locate.type = 'button';
  locate.addEventListener('click', () => handlers.onLocate?.());
  actions.appendChild(locate);
  if (d.fix) {
    const apply = el('button', 'diag-btn diag-btn-primary', `应用此修复：${d.fix.label}`);
    apply.type = 'button';
    apply.addEventListener('click', () => handlers.onApplyFix?.(d.fix.text));
    actions.appendChild(apply);
  }
  if (d.example) {
    const load = el('button', 'diag-btn', '载入正确写法');
    load.type = 'button';
    load.addEventListener('click', () => handlers.onLoadExample?.(d.example.code));
    actions.appendChild(load);
  }
  card.appendChild(actions);

  const raw = el('details', 'diag-raw');
  raw.appendChild(el('summary', '', '原始诊断信息'));
  raw.appendChild(el('pre', '', d.raw));
  card.appendChild(raw);

  return card;
}

export function buildCompactError(d, onLocate) {
  const box = el('div', 'diag-compact');
  box.appendChild(el('span', 'diag-chip diag-chip-code', d.code));
  box.appendChild(el('strong', '', d.title));
  box.appendChild(el('p', '', d.location
    ? `第 ${d.location.line} 行第 ${d.location.column} 列，${d.detail}`
    : d.detail));
  const btn = el('button', 'diag-btn', '查看完整诊断');
  btn.type = 'button';
  btn.addEventListener('click', () => onLocate?.());
  box.appendChild(btn);
  return box;
}
