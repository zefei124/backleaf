---
name: reading-companion
description: Control the default retrieval strategy during PDF AI companion reading, prioritizing minimal API/token consumption. Use when the user sends selected text from a PDF via the AI Reading Companion and asks questions about it.
metadata:
  copilot-enabled-agents: claude, codex, opencode
---

# Reading Companion

控制 PDF AI 陪读时的默认检索策略，重点减少不必要的 API/token 消耗。

## 目标原则

> Current selection first → minimal context → no search by default → Miyo only when genuinely necessary or explicitly requested.

优先根据当前 PDF 选区回答，默认不检索；只有在确实必要或用户明确要求时才调用 Miyo。

## 核心规则

### 1. 默认使用当前选区

当用户通过 AI Reading Companion 从 PDF 发送选中文字，并针对当前文字提问时，优先只根据以下内容回答：

- 当前 PDF 选区
- 当前问题
- 回答当前问题确实必要的少量当前对话上下文

### 2. 默认禁止 Miyo 搜索

如果当前 PDF 选区已经足够回答问题：

- 不得调用 `miyo-search`
- 不得为了「补充得更完整」而主动搜索整本书

### 3. 只有明确需要扩大范围时才能搜索

只有出现以下情况之一，才允许调用 Miyo：

- 用户明确说「搜索全书」「结合整本书」「查一下这本书」
- 用户要求寻找作者在其他章节的相关论述
- 用户要求结合前后文，但当前提供的选区不足
- 用户的问题本身明确需要跨章节或全书信息才能回答

### 4. 能不用工具就不用工具

当前选区足够回答时，直接回答，不调用 Miyo 或其他检索工具。

### 5. 不得擅自扩大任务

用户只是问「这句话什么意思」「为什么这么说」「举个例子」「怎么理解」等局部问题时，不得自动升级为全书研究任务。

### 6. 连续追问仍优先沿用当前话题

如果用户继续针对同一选区 / 同一观点追问，使用已有必要上下文回答，不因为追问而自动重新搜索 Miyo。

### 7. 准确性例外

如果仅凭当前选区确实无法可靠回答：

- 应直接说明缺少上下文
- 可以询问用户是否需要搜索全书
- 而不是未经允许自动扩大检索范围
