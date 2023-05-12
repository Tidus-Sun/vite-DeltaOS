import { defineConfig } from 'vitepress';

// refer https://vitepress.vuejs.org/config/introduction for details
export default defineConfig({
  lang: 'zh-CN',
  title: '道系统6维基小百科',
  description: '科银京成道系统6产品组维基百科',

  markdown: {
    theme: 'material-theme-darker',
    lineNumbers: true,
    config: (md) => {
      // use more markdown-it plugins!
      md.use(require('markdown-it-katex'));
      md.use(require('markdown-it-footnote'));
    },
  },

  themeConfig: {
    //siteTitle: '1111111111111111111111',
    logo: { light: '/pic/libuv-color.svg', dark: '/pic/deno-color.svg' },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/Tidus-Sun/vite-DeltaOS' },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: '版权所有 © 2023-present Coretek Tidus',
    },
    docFooter: {
      prev: '上一页',
      next: '下一页',
    },
    search: {
      provider: 'local',
    },
    nav: [
      { text: '目录', link: '/简介' },
      { text: '公共知识', link: '/公共知识/', activeMatch: '/公共知识/' },
      { text: '飞腾平台', link: '/飞腾平台/', activeMatch: '/飞腾平台/' },
      { text: '龙芯平台', link: '/龙芯平台/', activeMatch: '/龙芯平台/' },

      {
        text: '常用链接',
        items: [
          { items: [{ text: '内部仓库', link: 'http://192.168.11.72' }] },
          { items: [{ text: 'GitHub', link: 'https://github.com' }] },
        ],
      },
    ],

    sidebar: {
      '/': [
        {
          text: '介绍',
          collapsed: false,
          items: [{ text: '道6小百科是什么？', link: '/简介' }],
        },
        {
          text: '公共知识',
          collapsed: false,
          items: [
            {
              //text: '公共知识',
              items: [
                {
                  text: '计算机体系结构',
                  collapsed: false,
                  items: [
                    {
                      text: '磁盘分区表结构分析',
                      link: '/公共知识/计算机体系结构/磁盘分区表结构分析/磁盘分区表结构分析.md',
                    },
                  ],
                },
                {
                  text: '网络',
                  collapsed: false,
                  //items: [{ text: '网络', link: '/公共知识/网络/' }],
                },
                {
                  text: '编译',
                  collapsed: false,
                  //items: [{ text: '网络', link: '/公共知识/网络/' }],
                },
                {
                  text: '文件系统',
                  collapsed: false,
                  //items: [{ text: '网络', link: '/公共知识/网络/' }],
                },
                {
                  text: '道系统6',
                  collapsed: false,
                  items: [
                    {
                      text: '道系统6的ARMv7中断初始化及处理流程分析',
                      link: '/公共知识/道系统6/道系统6的ARMv7中断初始化及处理流程分析.md',
                    },
                    {
                      text: '道系统6的ARMv7异常处理流程分析',
                      link: '/公共知识/道系统6/道系统6的ARMv7异常处理流程分析.md',
                    },
                  ],
                },
              ],
            },
            // ...
          ],
        },
        {
          text: '飞腾平台',
          collapsed: false,
          items: [
            {
              text: 'QEMU虚拟机启动64位道系统',
              link: '/飞腾平台/QEMU虚拟机启动64位道系统.md',
            },
            // ...
          ],
        },
        {
          text: '龙芯平台',
          collapsed: false,
          items: [
            {
              text: '804性能问题分析报告',
              link: '/龙芯平台/804性能问题分析报告/804性能问题分析报告.md',
            },
            {
              text: '804串口问题分析报告',
              link: '/龙芯平台/804串口问题分析报告/804串口问题分析报告.md',
            },
            // ...
          ],
        },
      ],

      '/公共知识/': [
        {
          text: '公共知识',
          collapsed: false,
          items: [
            {
              //text: '公共知识',
              items: [
                {
                  text: '计算机体系结构',
                  collapsed: false,
                  items: [
                    {
                      text: '磁盘分区表结构分析',
                      link: '/公共知识/计算机体系结构/磁盘分区表结构分析/磁盘分区表结构分析.md',
                    },
                  ],
                },
                {
                  text: '网络',
                  collapsed: false,
                  //items: [{ text: '网络', link: '/公共知识/网络/' }],
                },
                {
                  text: '编译',
                  collapsed: false,
                  //items: [{ text: '网络', link: '/公共知识/网络/' }],
                },
                {
                  text: '文件系统',
                  collapsed: false,
                  //items: [{ text: '网络', link: '/公共知识/网络/' }],
                },
                {
                  text: '道系统6',
                  collapsed: false,
                  items: [
                    {
                      text: '道系统6的ARMv7中断初始化及处理流程分析',
                      link: '/公共知识/道系统6/道系统6的ARMv7中断初始化及处理流程分析.md',
                    },
                    {
                      text: '道系统6的ARMv7异常处理流程分析',
                      link: '/公共知识/道系统6/道系统6的ARMv7异常处理流程分析.md',
                    },
                  ],
                },
              ],
            },
            // ...
          ],
        },
      ],

      '/飞腾平台/': [
        {
          text: '飞腾平台',
          collapsed: false,
          items: [
            {
              text: 'QEMU虚拟机启动64位道系统',
              link: '/飞腾平台/QEMU虚拟机启动64位道系统.md',
            },
            // ...
          ],
        },
      ],

      '/龙芯平台/': [
        {
          text: '龙芯平台',
          collapsed: false,
          items: [
            {
              text: '804性能问题分析报告',
              link: '/龙芯平台/804性能问题分析报告/804性能问题分析报告.md',
            },
            {
              text: '804串口问题分析报告',
              link: '/龙芯平台/804串口问题分析报告/804串口问题分析报告.md',
            },
            // ...
          ],
        },
      ],
    },
  },
});
