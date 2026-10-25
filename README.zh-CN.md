<div align="center">

# Backleaf 叶间

**别让划线停在 PDF 里。**

选中一段原文，与 AI 一起追问、澄清和推演，再把真正属于你的理解沉淀成带原文链接的 Markdown 读书笔记。

[English](README.md) · [**简体中文**](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

[![最新版本](https://img.shields.io/github/v/release/zefei124/backleaf?style=flat-square&color=D4537E)](https://github.com/zefei124/backleaf/releases/latest)
![Obsidian 1.11.4+](https://img.shields.io/badge/Obsidian-1.11.4%2B-7C3AED?style=flat-square)
[![MIT License](https://img.shields.io/badge/license-MIT-2F855A?style=flat-square)](LICENSE)
![四语界面](https://img.shields.io/badge/界面-English%20%7C%20中文%20%7C%20日本語%20%7C%20한국어-4A5568?style=flat-square)

[**安装到 Obsidian**](obsidian://show-plugin?id=backleaf) · [看看它如何工作](#从一段原文长成一条思路) · [隐私说明](docs/privacy.zh-CN.md) · [更新日志](CHANGELOG.md)

</div>

---

划线很容易积累，也很容易被忘记。Backleaf 把一次阅读里真正重要的东西留在一起：触发思考的原文、你提出的问题、逐渐展开的对话，以及最终愿意留下的理解。

<img src="docs/assets/backleaf-reading-workflow.png" alt="Obsidian PDF 旁的 Backleaf 对话与我的理解" width="100%">

## 从一段原文，长成一条思路

1. **选中让你停下来的句子。** 在 Obsidian 的 PDF 中划出一段原文。
2. **从原文出发追问。** Backleaf 会把选区、书名、章节、页码和原文链接带进讨论。
3. **决定什么值得留下。** 继续追问到想法变得清楚，再亲自写下或修改“我的理解”。
4. **以后重新进入这段思考。** 对话会保存成普通 Markdown，也可以从历史、笔记或思考树回看。

<!-- 视频准备好后，在这里加入：
[![观看 Backleaf 使用演示](docs/assets/backleaf-demo-cover.png)](VIDEO_URL)
-->

## 它不只是 PDF 旁边的 AI 聊天框

- **语境不会丢。** 每次讨论都保留原文、页码、章节、书名和返回出处的路径。
- **对话会成为真正的笔记。** 引用、问题、讨论和最终理解一起保存在普通 Markdown 中。
- **最后由你来表达。** 可以让 AI 起草，也可以直接修改或完全自己写下理解。
- **Vault 始终是事实来源。** 如果笔记在 Backleaf 外被修改，插件不会悄悄覆盖你的内容。

## 看见自己的阅读路径

思考树会把兼容的读书笔记展开为一条可视路径：从书和章节出发，经过原文、问题与回答，重新找回思考是怎样发生的。

<img src="docs/assets/backleaf-thought-tree.png" alt="Backleaf 思考树展示从原文延伸出的提问和回答" width="100%">

## 安装

1. 打开 Obsidian 的 **设置 → 第三方插件 → 浏览**。
2. 搜索 **Backleaf**。
3. 点击 **安装**，然后启用插件。

> [!NOTE]
> Backleaf 需要 Obsidian 1.11.4 或更高版本。

<details>
<summary>手动安装</summary>

1. 从[最新版本](https://github.com/zefei124/backleaf/releases/latest)下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 创建 `<你的仓库>/.obsidian/plugins/backleaf/` 文件夹。
3. 把三个文件复制进去，重新加载 Obsidian，然后启用 Backleaf。

</details>

## 配置 AI 服务

打开 **设置 → 第三方插件 → Backleaf**，填入 DeepSeek API Key。密钥通过 Obsidian SecretStorage 保存，不会写入 Backleaf 的 `data.json`。

默认接口地址是 `https://api.deepseek.com`。高级设置也支持其他兼容的 HTTPS 接口和本机 HTTP 接口。API 费用由你自己的服务商账户承担。

## 隐私边界

> [!IMPORTANT]
> 只有在你发送消息时，Backleaf 才会向设置中的 AI 接口发起请求。发送内容包括当前选区原文、书名、可用时的章节，以及当前 Backleaf 对话。

Backleaf 不会主动发送整本 PDF、无关的仓库笔记、已保存的读书笔记、本地文件路径或其他本地数据，也不包含客户端遥测、广告或自行更新机制。详见[隐私说明](docs/privacy.zh-CN.md)。

## 联系作者

欢迎告诉我你遇到的问题、想要的功能，或者实际使用感受。

- 邮箱：[hnyu588@gmail.com](mailto:hnyu588@gmail.com)
- 微信：添加时请备注 **Backleaf**

<details>
<summary>查看微信二维码</summary>

<br>

<img src="docs/assets/contact-wechat.png" alt="微信二维码（待上传）" width="220">

上传 `docs/assets/contact-wechat.png` 后，二维码会显示在这里。

</details>

## 参与开发

```bash
npm install
npm run build
npm test
```

发布文件生成在仓库根目录：`main.js`、`manifest.json` 和 `styles.css`。Backleaf 使用 [MIT License](LICENSE)。
