---
layout: page
---

<script setup>
import {
  VPTeamPage,
  VPTeamPageTitle,
  VPTeamMembers
} from 'vitepress/theme'

const members = [
  {
    avatar: 'https://www.github.com/yyx990803.png',
    name: '孙笑',
    title: '工程师',
    desc: '飞腾平台',
    org: 'Coretek',
    orgLink: 'http://www.coretek.com.cn',
    links: [
      { icon: 'github', link: 'https://github.com/Tidus-Sun' },
    ]
  },
  {
    avatar: 'https://www.github.com/yyx990803.png',
    name: '叶强',
    title: '工程师',
    desc: '龙芯平台',
    org: 'Coretek',
    orgLink: 'http://www.coretek.com.cn',
    links: [
      { icon: 'github', link: 'https://github.com/Tidus-Sun' },
    ]
  },
  {
    avatar: 'https://www.github.com/yyx990803.png',
    name: '陈辉',
    title: '工程师',
    desc: '飞腾|龙芯平台',
    org: 'Coretek',
    orgLink: 'http://www.coretek.com.cn',
    links: [
      { icon: 'github', link: 'https://github.com/Tidus-Sun' },
    ]
  },
  {
    avatar: 'https://www.github.com/yyx990803.png',
    name: '向炼',
    title: '工程师',
    desc: '龙芯平台',
    org: 'Coretek',
    orgLink: 'http://www.coretek.com.cn',
    links: [
      { icon: 'github', link: 'https://github.com/Tidus-Sun' },
    ]
  },
  {
    avatar: 'https://www.github.com/yyx990803.png',
    name: '王德泽',
    title: '工程师',
    desc: '飞腾|龙芯平台',
    org: 'Coretek',
    orgLink: 'http://www.coretek.com.cn',
    links: [
      { icon: 'github', link: 'https://github.com/Tidus-Sun' },
    ]
  },
  {
    avatar: 'https://www.github.com/yyx990803.png',
    name: '高宇',
    title: '工程师',
    desc: '飞腾平台',
    org: 'Coretek',
    orgLink: 'http://www.coretek.com.cn',
    links: [
      { icon: 'github', link: 'https://github.com/Tidus-Sun' },
    ]
  },
  {
    avatar: 'https://www.github.com/yyx990803.png',
    name: '李月花',
    title: '工程师',
    desc: '飞腾|龙芯平台',
    org: 'Coretek',
    orgLink: 'http://www.coretek.com.cn',
    links: [
      { icon: 'github', link: 'https://github.com/Tidus-Sun' },
    ]
  },
  {
    avatar: 'https://www.github.com/yyx990803.png',
    name: '何万红',
    title: '工程师',
    desc: '龙芯平台',
    org: 'Coretek',
    orgLink: 'http://www.coretek.com.cn',
    links: [
      { icon: 'github', link: 'https://github.com/Tidus-Sun' },
    ]
  },
  {
    avatar: 'https://www.github.com/yyx990803.png',
    name: '陈尚庆',
    title: '工程师',
    desc: '飞腾|龙芯平台',
    org: 'Coretek',
    orgLink: 'http://www.coretek.com.cn',
    links: [
      { icon: 'github', link: 'https://github.com/Tidus-Sun' },
    ]
  },
  {
    avatar: 'https://www.github.com/yyx990803.png',
    name: '许建',
    title: '工程师',
    desc: '飞腾|龙芯平台',
    org: 'Coretek',
    orgLink: 'http://www.coretek.com.cn',
    links: [
      { icon: 'github', link: 'https://github.com/Tidus-Sun' },
    ]
  },
  {
    avatar: 'https://www.github.com/yyx990803.png',
    name: '尹军',
    title: '工程师',
    desc: '开发工具',
    org: 'Coretek',
    orgLink: 'http://www.coretek.com.cn',
    links: [
      { icon: 'github', link: 'https://github.com/Tidus-Sun' },
    ]
  },
  {
    avatar: 'https://www.github.com/yyx990803.png',
    name: '李杰',
    title: '工程师',
    desc: '龙芯平台',
    org: 'Coretek',
    orgLink: 'http://www.coretek.com.cn',
    links: [
      { icon: 'github', link: 'https://github.com/Tidus-Sun' },
    ]
  },
]
</script>

<VPTeamPage>
  <VPTeamPageTitle>
    <template #title>
      我们的团队
    </template>
    <template #lead>
      道系统6团队成员
    </template>
  </VPTeamPageTitle>
  <VPTeamMembers
    size="small"
    :members="members"
  />
</VPTeamPage>
