import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// 与 CQX 站点共用技术栈与视觉语言，部署在组织的另一个专用子路径。
const SITE = 'https://mythicdice.github.io';
const BASE = '/dsnext/';

export default defineConfig({
  site: SITE,
  base: BASE,
  devToolbar: { enabled: false },
  integrations: [
    starlight({
      title: 'DiceScript Next',
      description: 'DiceScript Next 规定 TRPG 骰点脚本的词法、值类型、对象、Roll、Formula、文本嵌入与静态诊断。',
      favicon: '/favicon.svg',
      customCss: ['/src/styles/custom.css'],
      // 默认浅色；用户显式选择主题时不再覆盖。
      head: [
        {
          tag: 'script',
          content:
            "try{if(!localStorage.getItem('starlight-theme')){localStorage.setItem('starlight-theme','light');document.documentElement.dataset.theme='light';}}catch(e){}",
        },
      ],
      locales: {
        root: { label: '简体中文', lang: 'zh-CN' },
      },
      sidebar: [
        {
          label: '语言基础',
          items: [
            { label: '范围与程序结构', link: '/' },
            { label: '词法、语句与优先级', link: '/lexical/' },
            { label: '值与类型', link: '/values/' },
          ],
        },
        {
          label: '结构',
          items: [
            { label: '对象、函数与作用域', link: '/objects/' },
            { label: '列表与切片', link: '/lists/' },
          ],
        },
        {
          label: '领域',
          items: [
            { label: '骰点与 Roll', link: '/dice/' },
            { label: '延迟公式', link: '/formula/' },
          ],
        },
        {
          label: '宿主与实现',
          items: [
            { label: '文本嵌入与渲染', link: '/text/' },
            { label: '内建函数', link: '/builtins/' },
            { label: '静态诊断', link: '/diagnostics/' },
            { label: '文法与能力对照', link: '/grammar/' },
          ],
        },
        {
          label: '交互',
          items: [{ label: '在线尝试', link: '/try/' }],
        },
      ],
    }),
  ],
});
