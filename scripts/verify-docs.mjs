/* DiceScript Next 文档自检
 * 核对 frontmatter、侧栏覆盖、站内相对链接与代码块语言，
 * 并把站点既定的写作红线固定为可执行的检查。
 * 运行：pnpm verify
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = resolve(root, 'src/content/docs');
const config = readFileSync(resolve(root, 'astro.config.mjs'), 'utf8');
const files = readdirSync(docsDir).filter((f) => f.endsWith('.md')).sort();

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

// 报告体、状态声明与职责划分句不得进入技术草案正文。
const BANNED = [
  { label: '中点分隔符', re: /·/ },
  { label: '报告体与状态声明', re: /暂不|尚无|尚未|不含实现计划|非官方|独立设计讨论稿|设计提案|不是已运行|非可运行|本站收录|当前状态|原型范围|实现路线图|尚无解释器/ },
  { label: '职责划分句', re: /由适配器|由调用方|不规定|不定义|交由\s*JS|交给\s*JavaScript|复杂插件由|平台侧渲染|发送\s*API/ },
];

const linkOf = (href) => {
  const clean = href.replace(/^(\.\.\/|\.\/)+/, '').split(/[?#]/)[0];
  return clean === '' ? 'index.md' : `${clean.replace(/\/$/, '')}.md`;
};

for (const file of files) {
  const text = readFileSync(resolve(docsDir, file), 'utf8');

  check(`${file} frontmatter`, () => {
    const fm = /^---\n([\s\S]*?)\n---/.exec(text);
    assert(fm, '缺少 frontmatter');
    assert(/^title:\s*\S/m.test(fm[1]), '缺少 title');
    assert(/^description:\s*\S/m.test(fm[1]), '缺少 description');
  });

  for (const banned of BANNED) {
    check(`${file} 禁用 ${banned.label}`, () => {
      assert(!banned.re.test(text), `出现「${text.match(banned.re)?.[0]}」`);
    });
  }

  check(`${file} 代码块语言`, () => {
    const langs = [...text.matchAll(/^```([^\s`]*)/gm)].map((m) => m[1] || 'text');
    assert(langs.every((l) => l === 'text'), `未登记的语言：${[...new Set(langs)].join(' ')}`);
  });

  check(`${file} 站内链接`, () => {
    const links = [...text.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
    for (const href of links) {
      if (/^(https?:|mailto:|#)/.test(href)) continue;
      assert(!href.startsWith('/'), `绝对链接 ${href} 在子路径下会失效`);
      // 首页在 /dsnext/ 下，回退一层会指向站点根；子页面才使用 ../。
      if (file === 'index.md') {
        assert(!href.startsWith('../'), `首页链接 ${href} 会跳出子路径`);
      }
      const target = linkOf(href);
      assert(existsSync(resolve(docsDir, target)), `${href} 找不到 ${target}`);
    }
  });
}

check('侧栏条目都有对应页面', () => {
  const links = [...config.matchAll(/\{\s*label:\s*'[^']+',\s*link:\s*'([^']+)'\s*\}/g)]
    .map((m) => m[1]);
  assert(links.length >= 10, `侧栏条目过少：${links.length}`);
  for (const href of links) {
    const name = href === '/' ? 'index.md' : `${href.replace(/^\/|\/$/g, '')}.md`;
    assert(existsSync(resolve(docsDir, name)), `${href} 找不到 ${name}`);
  }
  const listed = new Set(links.map((href) =>
    href === '/' ? 'index.md' : `${href.replace(/^\/|\/$/g, '')}.md`));
  const orphans = files.filter((f) => f !== '404.md' && !listed.has(f));
  assert(!orphans.length, `未列入侧栏的页面：${orphans.join(' ')}`);
});

check('子路径配置', () => {
  assert(/const BASE = '\/dsnext\/';/.test(config), 'base 不是 /dsnext/');
  assert(/site: SITE/.test(config), '未配置 site，sitemap 会被跳过');
  assert(!/·/.test(config), '配置里出现中点');
});

console.log(`DiceScript Next 文档自检：${passed} 项通过，${failures.length} 项失败（${files.length} 个页面）`);
if (failures.length) {
  for (const line of failures) console.error(`  ✗ ${line}`);
  process.exitCode = 1;
}
