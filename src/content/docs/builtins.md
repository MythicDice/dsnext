---
title: "内建函数"
description: "数值与转换函数、List 方法、Object 方法、Roll 与 Formula 入口和规则骰对象。"
---

内建函数是脚本可直接调用的最小常用集合，每个入口的形参数量固定，运行时类型错误可诊断。非随机纯函数不消耗随机源。

## 数值与转换

| 函数 | 说明 |
| --- | --- |
| `abs(x)` | 绝对值；`Int`、`Float`、`Roll` 合法，`Roll` 保留轨迹 |
| `floor(x)`、`ceil(x)` | 取整，返回 `Int` |
| `round(x)` | 四舍五入，恰好半值远离 0，返回 `Int` |
| `min(a, b, ...)`、`max(a, b, ...)` | 比较数值并返回对应参数的值，`Roll` 保留轨迹 |
| `Int(x)`、`Float(x)` | 数值与字符串转换，把 `Roll` 转成纯数值 |
| `String(x)` | 转成普通文本数据，对象的文本表示 |
| `Bool(x)` | 显式真值转换 |
| `repr(x)` | 稳定的排查用表示，不保证可作源码重新加载 |
| `bitXor(a, b)` | `Int` 按位异或 |
| `typeOf(x)` | 规范化类型名字符串 |

`/` 返回 `Float`，除 0 报错；`%` 是 `Int` 余数；`Int(Float)` 朝零截断；整数溢出与无穷大报错。

## List 方法

| 方法 | 效果 |
| --- | --- |
| `a.len()`、`a.length` | 长度 `Int` |
| `a.sum()` | 求和，含 `Roll` 时保留轨迹 |
| `a.kh(n=1)`、`a.kl(n=1)` | 取最高／最低 n 项后求和，不改列表 |
| `a.shuffle()` | 随机重排的新列表，不改 `a` |
| `a.rand()`、`a.randSize(n)` | 随机取一项／不放回取 n 项，不改列表 |
| `a.push(x)` | 尾部追加，修改并返回 `a` |
| `a.pop()`、`a.shift()` | 移除末尾／首项并返回被移除的值 |
| `a.map(f)` | 逐项映射后的新列表 |
| `a.filter(f)`、`a.count(f)` | `f` 必须返回 `Bool`；返回新列表或项数 |

`kh`、`kl` 处理 `Int`、`Float`、`Roll` 项，相等时按原始索引稳定决胜。空列表的 `sum()` 是 `Int(0)`，空列表的 `rand()`、`pop()`、`shift()` 报错。列表构造与切片规则见[列表与切片](../lists/)。

## Object 方法

| 方法 | 效果 |
| --- | --- |
| `o.len()` | 自有键数量 `Int` |
| `o.has(key)` | 只查自身字段，返回 `Bool` |
| `o.get(key, default=null)` | 字段存在返回实际值，否则返回默认值 |
| `o.keys()`、`o.values()`、`o.items()` | 按插入顺序返回键、值、`[key, value]` 列表 |

`o.keys()` 一类方法被同名字段遮蔽时，用 `Object.keys(o)` 等静态函数访问内建行为；`Object` 是内建值，不是关键字。`values()` 不自动求值 `Formula` 字段。

## Roll 与 Formula 入口

| 入口 | 说明 |
| --- | --- |
| `roll(text: String)` | 按规则骰文法解析并计算，返回 `Roll` |
| `r.total`、`r.faces`、`r.dice`、`r.trace`、`r.detail` | 结果与计算过程 |
| `formula(fn)` | 创建可序列化的 `Formula` |
| `f.eval(ctx)`、`f.bind(obj)` | 显式求值、绑定默认上下文 |

`roll(d20)` 报类型错误，参数只接受 `String`。规则骰对象 `coc.bonus(n)`、`coc.penalty(n)`、`fate.roll()`、`wod.roll(count, again, target)` 提供常见规则的等价入口；其他规则经 `r"..."` 与 `roll(String)` 进入同一个文法空间。

> **注意**
>
> 内建集合里没有 `print`、`say`、`console`，也没有 HTTP、文件、线程、异步、DOM 或任意正则驱动的顶层语法改写入口。文本输出只通过执行块的返回值与模板插值。
