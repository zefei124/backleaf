# Backleaf

用 AI 讨论 PDF 选区，并把有价值的对话保存成结构化读书笔记。

[English](README.md) | **简体中文**

Backleaf 让深度阅读留在 Obsidian 中：选中 PDF 原文、在内置对话界面中提问、把讨论保存为 Markdown、回看历史讨论，并随时返回原文位置。

## 功能

- 在 Backleaf 原生对话界面中讨论当前 PDF 选区。
- 携带选区原文、书名、章节、页码和原文链接。
- 支持多轮对话，并可在查看历史后恢复当前讨论。
- 将不同讨论保存到每本书对应的一份结构化读书笔记中。
- 以只读方式查看历史讨论，也可以基于同一原文开始新讨论。
- 更新已保存的理解；如果笔记在外部被修改，Backleaf 会拒绝覆盖。
- 将兼容的读书笔记显示为思考树。
- 根据 Obsidian 界面语言显示英文或简体中文。

## 使用要求

- Obsidian 1.11.4 或更高版本。
- DeepSeek API Key。Backleaf 使用你自己的账号和 API 额度。
- 发起选区讨论时，需要在 Obsidian 中打开 PDF。

## 安装

### 社区插件市场

Backleaf 上架 Obsidian 社区插件目录后：

1. 打开 **设置 → 第三方插件**。
2. 点击 **浏览**，搜索 **Backleaf**。
3. 点击 **安装**，然后启用插件。

### 手动安装

1. 从最新 GitHub Release 下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 创建 `<你的仓库>/.obsidian/plugins/backleaf/` 文件夹。
3. 将三个文件复制到该文件夹。
4. 重新加载 Obsidian，然后在 **设置 → 第三方插件** 中启用 **Backleaf**。

## 设置

1. 打开 **设置 → 第三方插件 → Backleaf**。
2. 填入 DeepSeek API Key。密钥通过 Obsidian SecretStorage 保存，不会写入 Backleaf 的 `data.json`。
3. 如有需要，可以修改模型、API 地址或请求超时时间。

默认接口地址为 `https://api.deepseek.com`。高级设置也支持其他兼容的 HTTPS 接口，以及本机 HTTP 接口。

## 使用方法

1. 打开 PDF 并选中一段文字。
2. 从命令面板或 PDF 上下文操作启动 Backleaf。
3. 在 Backleaf 对话界面中提问。
4. 保存有价值的讨论。Backleaf 会保留原文引用、完整对话，以及可用时的原文链接。
5. 使用 Backleaf 思考树视图打开读书笔记，回看讨论结构。

保存结果始终是普通 Markdown 文件，可以在 Backleaf 之外编辑。如果某条已保存讨论被外部修改，Backleaf 不会直接覆盖，而会提示你先检查冲突。

## 隐私和网络访问

只有在你发送消息时，Backleaf 才会向设置中的 AI 接口发起网络请求。发送内容包括当前选区原文、书名、可用时的章节，以及当前 Backleaf 对话。Backleaf 不会主动发送整本 PDF、无关的仓库笔记、已保存的读书笔记、本地文件路径或其他本地数据。

API Key 从 Obsidian SecretStorage 读取，仅作为身份验证信息发送给你配置的接口。API 费用和数据处理规则由你选择的服务商及接口决定。详见[隐私说明](docs/privacy.zh-CN.md)。

Backleaf 不包含客户端遥测、广告或自行更新机制。

## 从源码构建

```bash
npm install
npm run build
npm test
```

发布文件生成在仓库根目录：`main.js`、`manifest.json` 和 `styles.css`。

## 许可证

Backleaf 使用 [MIT License](LICENSE)。第三方软件和服务仍受各自许可证及条款约束。
