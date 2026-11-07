/* 解析树面板：把解释器生成的 AST 渲染成可折叠的结构化列表。 */

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

const SKIP_KEYS = new Set(['type', 'start', 'end']);
const HEAD_KEYS = ['name', 'op', 'kind', 'code', 'value', 'key', 'property', 'annotation', 'isFloat', 'result'];

function preview(value, max = 64) {
  const s = String(value).replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function summarizeAst(ast) {
  const counts = { nodes: 0, dice: 0, calls: 0, blocks: 0 };
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 80) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node.type === 'string') {
      counts.nodes += 1;
      if (['Dice', 'DiceInfix', 'RuleDice'].includes(node.type)) counts.dice += 1;
      if (node.type === 'Call') counts.calls += 1;
      if (['Block', 'If', 'While', 'Lambda', 'FnDecl'].includes(node.type)) counts.blocks += 1;
    }
    for (const [key, value] of Object.entries(node)) {
      if (SKIP_KEYS.has(key)) continue;
      if (value && typeof value === 'object') walk(value, depth + 1);
    }
  };
  walk(ast);
  return counts;
}

export function astSummaryText(ast) {
  const c = summarizeAst(ast);
  const parts = [`${c.nodes} 个节点`];
  if (c.dice) parts.push(`${c.dice} 处骰点`);
  if (c.calls) parts.push(`${c.calls} 次调用`);
  if (c.blocks) parts.push(`${c.blocks} 个块`);
  return parts.join('，');
}

function isNode(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.type === 'string';
}

function collectChildren(node) {
  const scalars = [];
  const children = [];
  for (const [key, value] of Object.entries(node)) {
    if (SKIP_KEYS.has(key) || value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (isNode(item)) children.push({ label: `${key}[${i}]`, node: item });
        else if (item && typeof item === 'object') {
          children.push({ label: `${key}[${i}]`, node: { type: key, ...item } });
        } else scalars.push({ key: `${key}[${i}]`, value: item });
      });
      continue;
    }
    if (isNode(value)) {
      children.push({ label: key, node: value });
      continue;
    }
    if (typeof value === 'object') {
      children.push({ label: key, node: { type: key, ...value } });
      continue;
    }
    scalars.push({ key, value });
  }
  return { scalars, children };
}

function createNode(node, path, depth = 0) {
  const wrap = el('div', 'ast-node');
  const { scalars, children } = collectChildren(node);
  const hasDetail = children.length > 0 || scalars.length > 0;

  const head = el('div', 'ast-head');
  head.appendChild(el('span', 'ast-toggle', hasDetail && depth < 3 ? '▾' : hasDetail ? '▸' : ''));
  head.appendChild(el('span', 'ast-name', node.type));
  for (const key of HEAD_KEYS) {
    if (key in node && !['object', 'function'].includes(typeof node[key])) {
      head.appendChild(el('span', 'ast-attr-val', `${key}=${preview(node[key], 40)}`));
      break;
    }
  }
  if (children.length) head.appendChild(el('span', 'ast-count', `${children.length} 子节点`));
  head.appendChild(el('span', 'ast-path', path));
  wrap.appendChild(head);

  if (hasDetail) {
    const detail = el('div', 'ast-children');
    for (const item of scalars) {
      const row = el('div', 'ast-attr');
      row.appendChild(el('span', 'ast-attr-key', item.key));
      row.appendChild(el('span', 'ast-attr-eq', '='));
      row.appendChild(el('span', 'ast-attr-val', preview(item.value)));
      detail.appendChild(row);
    }
    children.forEach((child) => {
      detail.appendChild(createNode(child.node, `${path}.${child.label}`, depth + 1));
    });
    detail.hidden = depth >= 3;
    wrap.appendChild(detail);
    head.addEventListener('click', () => {
      detail.hidden = !detail.hidden;
      head.querySelector('.ast-toggle').textContent = detail.hidden ? '▸' : '▾';
    });
  }
  return wrap;
}

export function buildAstTree(ast, container) {
  container.replaceChildren();
  const root = el('div', 'ast-tree-root');
  const head = el('div', 'ast-root-head');
  head.appendChild(el('span', 'ast-root-mark', '▾'));
  head.appendChild(el('span', 'ast-root-title', ast.type === 'HostText' ? 'hostText' : 'program'));
  head.appendChild(el('span', 'ast-root-meta', astSummaryText(ast)));
  root.appendChild(head);
  const list = el('div', 'ast-children');
  const top = ast.type === 'HostText' ? ast.parts : ast.body;
  (top || []).forEach((node, i) => list.appendChild(createNode(node, `program[${i}]`)));
  root.appendChild(list);
  head.addEventListener('click', () => {
    list.hidden = !list.hidden;
    head.querySelector('.ast-root-mark').textContent = list.hidden ? '▸' : '▾';
  });
  container.appendChild(root);
}
