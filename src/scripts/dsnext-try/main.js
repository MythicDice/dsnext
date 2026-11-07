/* 在线尝试主控制器：编辑器、示例、结果、解析树与轨迹共用一次真实解释结果。 */
import { EditorView, basicSetup } from 'codemirror';
import { VERSION } from './interpreter.js';
import { checkSource } from './check.js';
import { EXAMPLES, ERROR_EXAMPLES } from './examples.js';
import {
  dsExtensions,
  setEditorError,
  clearEditorError,
  locateEditorError,
} from './editor.js';
import { buildAstTree, astSummaryText } from './ast-view.js';
import { describeError, buildDiagnosisCard, buildCompactError } from './diagnostics.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

const editorHost = $('#editor');
const exampleBar = $('#examples');
const statusDot = $('#status-dot');
const statusText = $('#status-text');
const charCount = $('#char-count');
const resultCard = $('#result-card');
const resultValue = $('#result-value');
const resultMeta = $('#result-meta');
const resultRolls = $('#result-rolls');
const previewPane = $('#preview-pane');
const previewError = $('#preview-error');
const astPane = $('#ast-pane');
const astToolbar = $('#ast-toolbar');
const astSummary = $('#ast-summary');
const astTree = $('#ast-tree');
const astJson = $('#ast-json');
const astError = $('#ast-error');
const tracePane = $('#trace-pane');
const traceSummary = $('#trace-summary');
const traceList = $('#trace-list');
const traceJson = $('#trace-json');
const traceError = $('#trace-error');
const tabs = Array.from(document.querySelectorAll('.pane-tab'));
const astSwitchButtons = Array.from(document.querySelectorAll('.ast-switch-btn'));

if (!editorHost || !resultValue || !previewError || !astTree) {
  throw new Error('在线尝试页面缺少必要的容器节点');
}

const params = new URLSearchParams(location.search);
const requestedEx = Number(params.get('ex'));
const requestedErr = Number(params.get('err'));
const validEx = Number.isInteger(requestedEx)
  && requestedEx >= 1 && requestedEx <= EXAMPLES.length;
const validErr = Number.isInteger(requestedErr)
  && requestedErr >= 1 && requestedErr <= ERROR_EXAMPLES.length;
const initialEx = validEx ? requestedEx - 1 : 0;
const initialErr = validErr ? requestedErr - 1 : -1;
const initialKey = validErr ? `err${initialErr}` : `ex${initialEx}`;
const initialDoc = validErr ? ERROR_EXAMPLES[initialErr].code : EXAMPLES[initialEx].code;
const initialTab = ['ast', 'trace'].includes(params.get('view')) ? params.get('view') : 'preview';

let renderTimer;
let loadingExample = false;
let astView = 'tree';
let currentError = null;
let lastJson = '';

const view = new EditorView({
  doc: initialDoc,
  extensions: [
    basicSetup,
    ...dsExtensions,
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      if (!loadingExample) {
        clearExampleParam();
        setActiveExample(null);
      }
      scheduleRender();
    }),
  ],
  parent: editorHost,
});

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderNow, 60);
}

function setStatus(kind, message) {
  statusDot.className = `status-dot ${kind}`;
  statusText.textContent = message;
}

function setActiveExample(key) {
  Array.from(exampleBar.children).forEach((btn) => {
    btn.classList.toggle('is-active', key !== null && btn.dataset.index === key);
  });
}

function clearExampleParam() {
  const url = new URL(location.href);
  if (!['ex', 'err'].some((name) => url.searchParams.has(name))) return;
  for (const name of ['ex', 'err']) url.searchParams.delete(name);
  history.replaceState(null, '', url);
}

function setTab(name) {
  tabs.forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  previewPane.hidden = name !== 'preview';
  astPane.hidden = name !== 'ast';
  tracePane.hidden = name !== 'trace';
}

function setAstView(name) {
  astView = name;
  astSwitchButtons.forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.astView === name);
  });
  const inError = currentError !== null;
  astTree.hidden = inError || name !== 'tree';
  astJson.hidden = inError || name !== 'json';
}

function replaceDocument(text) {
  loadingExample = true;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: 0 },
  });
  loadingExample = false;
  clearExampleParam();
  setActiveExample(null);
  clearTimeout(renderTimer);
  renderNow();
}

function loadDocument(text, key, param, value) {
  loadingExample = true;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: 0 },
  });
  loadingExample = false;
  setActiveExample(key);
  const url = new URL(location.href);
  url.searchParams.delete('ex');
  url.searchParams.delete('err');
  url.searchParams.set(param, String(value));
  history.replaceState(null, '', url);
  clearTimeout(renderTimer);
  renderNow();
}

function chip(text) {
  return el('span', 'meta-chip', text);
}

function eventLabel(kind) {
  if (kind === 'roll') return '抽样';
  if (kind === 'eval') return '公式求值';
  if (kind === 'block') return '执行块';
  return kind;
}

function renderResult(r, src) {
  resultValue.textContent = r.text === '' ? '（无结果）' : r.text;
  resultValue.classList.toggle('is-empty', r.text === '');
  resultMeta.replaceChildren(
    chip(`类型 ${r.valueType}`),
    chip(r.mode === 'host' ? '宿主文本' : '脚本'),
    chip(`${r.stats.statements} 条语句`),
    chip(`${r.stats.samples} 次抽样`),
    chip(`${r.stats.steps} 步`),
  );

  const rolls = r.trace.filter((e) => e.kind === 'roll');
  resultRolls.replaceChildren();
  resultRolls.hidden = rolls.length === 0;
  for (const event of rolls.slice(0, 12)) {
    const row = el('div', 'roll-row');
    row.appendChild(el('span', 'roll-id', `#${event.id}`));
    row.appendChild(el('span', 'roll-total', event.total));
    row.appendChild(el('span', 'roll-detail', event.detail));
    resultRolls.appendChild(row);
  }

  const summary = astSummaryText(r.ast);
  lastJson = JSON.stringify(r.ast, null, 2);
  buildAstTree(r.ast, astTree);
  astJson.textContent = lastJson;
  astSummary.textContent = summary;

  traceList.replaceChildren();
  const events = r.trace.length ? r.trace : [];
  traceSummary.textContent = `${events.length} 条记录，${rolls.length} 次抽样`;
  if (!events.length) {
    traceList.appendChild(el('div', 'trace-empty', '这段脚本没有抽样或执行块记录'));
  }
  for (const event of events) {
    const row = el('div', 'trace-row');
    row.appendChild(el('span', 'trace-kind', eventLabel(event.kind)));
    if (event.id !== undefined) row.appendChild(el('span', 'trace-id', `#${event.id}`));
    row.appendChild(el('span', 'trace-detail', event.detail || ''));
    const pos = positionLabel(src, event.offset || 0);
    row.appendChild(el('span', 'trace-pos', pos));
    traceList.appendChild(row);
  }
  const traces = events.filter((e) => e.kind === 'roll' && e.trace).map((e) => e.trace);
  traceJson.textContent = JSON.stringify(traces, null, 2);

  currentError = null;
  clearEditorError(view);

  resultCard.hidden = false;
  previewError.hidden = true;
  astToolbar.hidden = false;
  astError.hidden = true;
  traceError.hidden = true;
  setAstView(astView);

  setStatus('ok', `执行成功，${summary}（v${VERSION}）`);
  charCount.textContent = `${Array.from(src).length} 码点`;
}

function positionLabel(src, offset) {
  const before = src.slice(0, Math.max(0, Math.min(offset, src.length)));
  const line = before.split('\n').length;
  return `第 ${line} 行`;
}

function showFailure(error, src) {
  const diagnosis = describeError(error, src);
  const hasPosition = Number.isFinite(error?.utf16Offset);
  const pos = hasPosition ? error.utf16Offset : 0;
  currentError = { diagnosis, pos, hasPosition };

  if (hasPosition) setEditorError(view, pos);
  else clearEditorError(view);

  const handlers = {
    onLocate: () => locateEditorError(view, pos),
    onApplyFix: (text) => replaceDocument(text),
    onLoadExample: (code) => replaceDocument(code),
  };
  previewError.replaceChildren(buildDiagnosisCard(diagnosis, handlers));
  const showFull = () => setTab('preview');
  astError.replaceChildren(buildCompactError(diagnosis, showFull));
  traceError.replaceChildren(buildCompactError(diagnosis, showFull));

  resultCard.hidden = true;
  previewError.hidden = false;
  astToolbar.hidden = true;
  astTree.hidden = true;
  astJson.hidden = true;
  astError.hidden = false;
  traceList.replaceChildren();
  traceJson.textContent = '';
  traceSummary.textContent = '';
  traceError.hidden = false;

  const where = diagnosis.location
    ? `第 ${diagnosis.location.line} 行第 ${diagnosis.location.column} 列`
    : '结构校验阶段';
  setStatus('error', `${diagnosis.code} ${where}：${diagnosis.title}`);
  charCount.textContent = `${Array.from(src).length} 码点`;
}

function renderNow() {
  const src = view.state.doc.toString();
  resultValue.textContent = '';
  resultMeta.replaceChildren();
  resultRolls.replaceChildren();
  previewError.replaceChildren();
  astTree.replaceChildren();
  astJson.textContent = '';
  astError.replaceChildren();
  traceList.replaceChildren();
  traceJson.textContent = '';
  traceError.replaceChildren();
  const result = checkSource(src);
  if (result.ok) renderResult(result.result, src);
  else showFailure(result.error, src);
}

const countLabel = document.querySelector('.examples-count');
if (countLabel) {
  countLabel.textContent = `示例 ${EXAMPLES.length}，错例 ${ERROR_EXAMPLES.length}`;
}

EXAMPLES.forEach((example, index) => {
  const btn = el('button', 'ex-btn');
  btn.type = 'button';
  btn.dataset.index = `ex${index}`;
  btn.appendChild(el('span', 'ex-num', String(index + 1)));
  btn.appendChild(el('span', 'ex-label', example.label));
  btn.addEventListener('click', () => loadDocument(example.code, `ex${index}`, 'ex', index + 1));
  exampleBar.appendChild(btn);
});

exampleBar.appendChild(el('div', 'examples-break'));

ERROR_EXAMPLES.forEach((example, index) => {
  const btn = el('button', 'ex-btn ex-btn-error');
  btn.type = 'button';
  btn.dataset.index = `err${index}`;
  btn.appendChild(el('span', 'ex-num', '!'));
  btn.appendChild(el('span', 'ex-label', example.label));
  btn.addEventListener('click', () => loadDocument(example.code, `err${index}`, 'err', index + 1));
  exampleBar.appendChild(btn);
});

tabs.forEach((tab) => {
  tab.addEventListener('click', () => setTab(tab.dataset.tab));
});
astSwitchButtons.forEach((btn) => {
  btn.addEventListener('click', () => setAstView(btn.dataset.astView));
});

$('#copy-ast-btn').addEventListener('click', async (event) => {
  const btn = event.currentTarget;
  if (!lastJson) return;
  try {
    await navigator.clipboard.writeText(lastJson);
    btn.textContent = '已复制';
    setTimeout(() => { btn.textContent = '复制 JSON'; }, 1500);
  } catch {
    btn.textContent = '复制失败';
    setTimeout(() => { btn.textContent = '复制 JSON'; }, 1500);
  }
});

$('#clear-btn').addEventListener('click', () => replaceDocument(''));

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    clearTimeout(renderTimer);
    renderNow();
  }
});

setActiveExample(initialKey);
setTab(initialTab);
renderNow();
