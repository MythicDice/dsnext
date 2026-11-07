/* 实时检查的唯一入口。
 * 编辑器、状态栏、结果、解析树与轨迹面板都读取同一次真实解释结果，
 * 界面不预置错误状态，也不针对某段示例文本特判。
 */
import { run } from './interpreter.js';
import { locate } from './core.js';

let cached = { src: null, result: null };

export function checkSource(src) {
  if (cached.src === src && cached.result) return cached.result;
  let result;
  try {
    result = { ok: true, result: run(src), error: null };
  } catch (error) {
    result = { ok: false, result: null, error: locate(src, error) };
  }
  cached = { src, result };
  return result;
}
