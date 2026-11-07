/* 在线尝试的一键填入示例。
 * 正常示例只写脚本本身，错例只写会触发真实诊断的脚本。
 * expect 由 Node 自检逐条核对，界面不为任何示例预置结果。
 */

const lines = (...rows) => rows.join('\n');

export const EXAMPLES = [
  {
    label: '声明、赋值与类型',
    code: lines(
      '倍率 := 3',
      '变化: Any := 12',
      '变化 = "未知"',
      '可空: Int? := null',
      '可空 = 8',
      '[倍率, 倍率 * 2, 变化, 可空, 倍率 ** 2]',
    ),
  },
  {
    label: '普通骰点与 Roll',
    code: lines(
      'r := 2d20kh1 + 3',
      '[r.total, r.faces, r.detail]',
    ),
  },
  {
    label: '修饰符与动态骰数',
    code: lines(
      '等级 := 2',
      '[4d6dl1.total, 3d20min10.total, d20优势.total, (等级 + 1)d(20).total]',
    ),
  },
  {
    label: '函数、闭包与递归',
    code: lines(
      '倍率 := 3',
      '加成 := n => n * 倍率',
      '阶乘(n) -> Int { if n <= 1 { 1 } else { n * 阶乘(n - 1) } }',
      '[加成(5), 阶乘(6)]',
    ),
  },
  {
    label: '对象与 self',
    code: lines(
      '角色 := {',
      '    名字: "调查员",',
      '    HP: 12,',
      '    护甲: 2,',
      '    受伤(n) {',
      '        self.HP = max(0, self.HP - max(0, n - self.护甲))',
      '        self.HP',
      '    },',
      '}',
      '[角色.名字, 角色.受伤(5), 角色["HP"]]',
    ),
  },
  {
    label: '列表、区间与切片',
    code: lines(
      '数组 := [1..5]',
      '数组[1:3] = [8, 9]',
      '[数组, 数组.kh(2), 数组.filter(x => x >= 5).len(), [7] * 3]',
    ),
  },
  {
    label: '规则骰空间',
    code: lines(
      '奖励 := r"b2"',
      '命运 := r"f"',
      '成功数 := r"5a9k2"',
      '追加 := r"4c3m7"',
      '[奖励.total, 命运.total, 成功数.total, 追加.total, 奖励.detail]',
    ),
  },
  {
    label: 'Formula 与 bind',
    code: lines(
      '伤害 := formula(ctx => 2d6 + ctx.力量加值)',
      '角色 := { 力量加值: 4, 攻击: 伤害 }',
      '固定 := 伤害.bind({ 力量加值: 2 })',
      '[角色.攻击.eval(角色), 角色.攻击.eval(角色), 固定.eval()]',
    ),
  },
  {
    label: '模板字符串',
    code: lines(
      '名字 := "艾琳"',
      '骰 := d20',
      '`角色 {名字}：{骰.total} 点，过程 {骰.detail}`',
      '`字面花括号 {{ 与 }} 会原样显示`',
    ),
  },
  {
    label: '宿主文本执行块',
    code: lines(
      '调查员进行侦查：{{ 骰 := d100; if 骰 <= actor.侦查 { `成功（{骰.total}）` } else { `失败（{骰.total}）` } }}',
      '角色生命值：{{ actor.HP }}',
      '一次掷骰：{{ 1d6 + 2 }}',
      '纯空结果：{{ null }}',
    ),
  },
];

export const ERROR_EXAMPLES = [
  {
    label: '对象成员缺逗号',
    expect: 'S002',
    code: lines('角色 := { HP: 12 护甲: 2 }', '角色'),
  },
  {
    label: '字符串未闭合',
    expect: 'S001',
    code: lines('名字 := "艾琳', '名字'),
  },
  {
    label: '模板未闭合',
    expect: 'S001',
    code: lines('名字 := "艾琳"', '`角色 {名字}'),
  },
  {
    label: '未声明名字',
    expect: 'N001',
    code: lines('力量 := 60', '力星 = 70'),
  },
  {
    label: '重复声明',
    expect: 'N002',
    code: lines('x := 1', 'x := 2', 'x'),
  },
  {
    label: '标注声明写成赋值',
    expect: 'S002',
    code: lines('x: Int = 1'),
  },
  {
    label: '类型不兼容',
    expect: 'T001',
    code: lines('hp := 12', 'hp = "12"'),
  },
  {
    label: '条件不是 Bool',
    expect: 'T002',
    code: lines('if 1 { "通过" } else { "未通过" }'),
  },
  {
    label: '参数个数不对',
    expect: 'C001',
    code: lines('abs()'),
  },
  {
    label: '字段不存在',
    expect: 'O001',
    code: lines('角色 := { HP: 12 }', '角色.hp'),
  },
  {
    label: '保留骰数超出',
    expect: 'D001',
    code: lines('3d6kh9'),
  },
  {
    label: '零面骰',
    expect: 'D001',
    code: lines('3d0'),
  },
  {
    label: '公式写了赋值',
    expect: 'F001',
    code: lines('formula(ctx => state.HP = 1)'),
  },
  {
    label: '规则没有注册',
    expect: 'D002',
    code: lines('roll("custom:test")'),
  },
  {
    label: '循环耗尽预算',
    expect: 'R001',
    code: lines('while true { }'),
  },
];
