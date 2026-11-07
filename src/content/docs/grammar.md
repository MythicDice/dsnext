---
title: "文法与能力对照"
description: "核心 EBNF、文法边界、与 DiceScript 的能力映射和刻意不保留的隐式语义。"
---

核心文法描述语句、声明、表达式与对象成员的形状。词法细节、插值字符串内部、规则骰子文法与布局分隔符由[词法、语句与优先级](../lexical/)及[骰点与 Roll](../dice/)的条款补充；条款与文法草图冲突时以条款为准。

```text
Program        = { Separator | Statement, { Separator, Statement } } ;
Statement      = Declaration | Assignment | FunctionDecl
               | WhileStmt | JumpStmt | Expr ;
Declaration    = Identifier, [ ":", Type ], ":=", Expr ;
Assignment     = LValue, "=", Expr ;
LValue         = Identifier, { ".", Identifier | "[", Expr, "]" } ;
FunctionDecl   = Identifier, "(", [ Params ], ")", [ "->", Type ], Block ;
Params         = Param, { ",", Param } ;
Param          = Identifier, [ ":", Type ] ;
WhileStmt      = "while", Expr, Block ;
JumpStmt       = "break" | "continue" | "return", [ Expr ] ;
Block          = "{", { Separator | Statement }, "}" ;
ObjectLiteral  = "{", [ Member, { ",", Member }, [ "," ] ], "}" ;
Member         = Identifier, ":", Expr
               | Identifier, "(", [ Params ], ")", [ "->", Type ], Block ;
ListLiteral    = "[", [ Expr, { ",", Expr } ], "]"
               | "[", Expr, "..", Expr, "]" ;
Expr           = Conditional ;
Conditional    = NullCoalesce, [ "?", Expr, ":", Expr ] ;
NullCoalesce   = OrExpr, { "??", OrExpr } ;
Call           = Primary, { ".", Identifier | "[", Expr, "]"
               | "(", [ Args ], ")" | "[", Expr, ":", Expr, "]" } ;
DiceExpr       = [ Number ], "d", Number, { DiceModifier } ;
RuleDice       = "r", String ;
Type           = Identifier, [ "?" ] ;
Separator      = ";" | LineBreak ;
```

`Primary` 包含字面量、标识符、圆括号表达式、`ListLiteral`、`ObjectLiteral`、匿名函数与 `DiceExpr`、`RuleDice`。`DiceModifier` 按 `min`／`max` → `kh`／`kl`／`dh`／`dl` 的固定顺序出现，同类筛选不重复。

## 文法边界

| 结构 | 判定 |
| --- | --- |
| `{...}` | `:=` 后为对象字面量，`if`／`while`／函数后为块 |
| `d20foo` | 标识符，不拆成骰点表达式 |
| `r"..."` | 规则骰字面量，内部交给规则骰文法 |
| `[a..b]` | 列表闭区间，`..` 不是中缀运算符 |
| `x: Int := 1` | 带标注的声明；`x: Int = 1` 不合法 |

`formula`、`roll`、`Int` 等是内建值或函数名，不是关键字。最小保留字为 `if`、`else`、`while`、`break`、`continue`、`return`；`true`、`false`、`null` 是字面量，`self` 是方法里的特殊绑定。

## 能力映射

下表把 DiceScript 的常见能力映射到本语言的写法：

| 能力 | 本语言写法 |
| --- | --- |
| `d20`、`3d6`、动态 `XdY` | 同一基础骰语法，产出 `Roll` |
| `k`／`kh`、`q`／`kl`、`dl`、`dh`、`min`、`max` | 同名修饰符，顺序固定 |
| CoC `b`／`p`、Fate `f`、WoD `XaYmZkNqM` | `r"b2"`、`r"f"`、`r"5a9k2"` 与规则对象 |
| 数组区间、重复、切片、切片赋值 | `[1..5]`、`[x] * n`、`a[i:j]`、`a[i:j] = list` |
| 数组的 `kh`／`kl` | `a.kh(n)`、`a.kl(n)` 方法 |
| 字典与下标读取 | `Object`、`.a`、`["a"]`，键只允许 String |
| `.keys`／`.values`／`.items`／`.has`／`.get` | 同名 `Object` 方法，直接读取即原始字段 |
| computed `&(expr)`、`&a`、`loadRaw*` | `formula(ctx => expr)` 与 `.eval(ctx)` |
| 字典与函数的 `this` | 方法里的 `self`、普通参数与闭包 |
| `if`／`else`、`while`、`return`、三目 | 同名控制结构，`if` 是表达式，条件必须是 `Bool` |
| `??` 空值合并 | 同名运算，只合并 `null` |
| 模板字符串与外部模板 | 反引号 `{expr}` 与执行块 `{{ code }}` |
| 末表达式输出 | 执行块返回值替换 |
| 全类型序列化 | 原生值、闭包、对象图、`Formula`、`Roll` 的结构化编码 |
| 计算细节显示 | `Roll.detail`、`Roll.trace` |
| 角色卡属性与持久状态 | 注入的 `actor`、`state` 对象 |
| 算力上限 | 统一执行预算 |

## 兼容准则

「能力覆盖」指同一规则计算可以用本语言的写法表达，不等于旧脚本源码无需改写。以下隐式语义刻意不保留：

- `&(expr)` 读取即求值、`loadRaw*` 的双读取路径；改为显式 `.eval()`。
- 未声明名字的全局赋值、字典键的隐式数字转字符串、条件与非 `Bool` 值的隐式真值转换。
- `&&`／`||` 返回操作数；本语言返回 `Bool`。
- 规则骰写法与普通标识符共用词法空间、`this` 的动态绑定、注释宏改写文法。
- `{%...%}` 与分隔符驱动的旧模板标记。

> **注意**
>
> 同一段脚本里可以混用基础骰语法与规则骰字面量：`b2 := 12` 是普通声明，`r"b2"` 才是 CoC 奖励骰。
