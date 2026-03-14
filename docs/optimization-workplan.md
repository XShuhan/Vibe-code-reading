# Code Vibe Reading 优化分工文档

基于当前项目结构整理。当前核心实现主要分布在：

- `apps/extension/src/views/mapView.ts`：Map 侧边栏树视图
- `apps/extension/src/views/threadsView.ts`：Threads 列表视图
- `apps/extension/src/services/threadService.ts`：问题提交、答案落盘
- `apps/extension/src/commands/askAboutSelection.ts`：`Vibe: Ask About Selection`
- `apps/extension/src/services/vibeController.ts`：Thread / Card / Canvas webview 打开与刷新
- `packages/analyzer`：索引、节点、边、调用关系、文件扫描
- `packages/shared/src/types.ts`：共享数据结构

当前建议按“功能模块”而不是按文件分工。

## 1. Map 体验升级

### 目标

让用户打开一个项目后，先通过 `Map` 就能快速看懂目录结构、核心文件、主要调用链，而不是只看到平铺的文件列表。

### 需要实现的功能

- 文件按目录树展示，而不是根层直接平铺所有文件
- 支持折叠目录、展开文件、展开文件内符号
- 增加“项目概览”或“项目总结”入口
- 展示主代码入口、核心模块、关键函数调用关系
- 支持多种调用关系展示形式
  - 目录树
  - 函数调用树
  - 模块依赖树
  - 可选的简易架构概览卡片

### 当前问题

- `MapViewProvider` 目前顶层只返回 `kind === "file"` 的节点
- 文件是按路径排序，但不是目录树
- 项目打开后没有“项目总览”层
- 调用关系已在 analyzer 中有边数据，但没有更适合用户阅读的展示层

### 建议拆分

#### 1.1 文件树重构

- 把文件路径拆成目录层级
- 在 `Map` 中引入目录节点
- 文件节点下继续展示符号节点

建议关注文件：

- `apps/extension/src/views/mapView.ts`
- `packages/shared/src/types.ts`
- `packages/analyzer` 中 `CodeNode` / `CodeEdge` 的使用点

#### 1.2 项目概览生成

- 索引完成后生成项目摘要
- 内容可包括：
  - 项目主要语言
  - 核心目录
  - 可能的入口文件
  - 核心模块
  - 高调用频率函数
- 可以先做成 `Map` 顶部的虚拟节点，点击后打开 webview 或 card

建议关注文件：

- `apps/extension/src/services/indexService.ts`
- `apps/extension/src/views/mapView.ts`
- `packages/analyzer`

#### 1.3 调用关系可视化

- 识别主流程函数和高频调用函数
- 支持按函数查看 callers / callees
- 支持树状展示一个函数的下游调用链
- 后续可扩展成 canvas/graph 视图

建议关注文件：

- `packages/analyzer/src/ts/callGraph.ts`
- `apps/extension/src/commands/traceCallPath.ts`
- `packages/shared/src/types.ts`

### 验收标准

- 打开一个中大型项目后，`Map` 顶层先看到目录树，而不是平铺文件
- 用户能看到项目概览
- 用户能从核心函数继续展开调用关系

## 2. Thread 输出与 Agent 化升级

### 目标

让 `Threads` 不只是“把问题直接发给模型然后回一段答案”，而是形成更强的代码阅读助手风格：先理解问题，再组织上下文，再输出更稳定、更有解释力的答案。

### 需要实现的功能

- 在 `Ask About Selection` 前增加一个轻量 Agent 层
- Agent 负责判断问题类型
  - 解释代码
  - 分析调用链
  - 分析实现原理
  - 分析风险/问题
  - 总结模块职责
- Agent 根据问题类型拼装更合适的上下文与提示词
- 给 Agent 增加 `skills` 和 `soul`
  - `skills`：代码解释、调用链分析、原理说明、风险提示、重构建议
  - `soul`：输出风格、表达习惯、强调“逻辑 + 原理 + 证据”的讲解方式
- 优化 thread 输出结构，而不是只返回单段 Markdown

### 建议输出结构

- 问题重述
- 结论先行
- 代码在做什么
- 为什么这么做 / 原理是什么
- 调用链或上下游关系
- 风险点 / 不确定点
- Source references

### 当前问题

- `askAboutSelection.ts` 目前只是拿问题 + 选区直接调用 `threadService.askQuestion`
- `threadService.ts` 直接走 `answerGroundedQuestion`
- 还没有任务分流、角色编排、技能注入、风格层
- `ThreadsViewProvider` 目前只做列表，不区分 thread 类型和回答结构

### 建议拆分

#### 2.1 Agent 编排层

- 在命令层和模型层之间增加 `question orchestrator`
- 输入：用户问题、当前选区、当前符号、上下文证据
- 输出：整理后的 agent prompt、调用策略、回答模板

建议关注文件：

- `apps/extension/src/commands/askAboutSelection.ts`
- `apps/extension/src/services/threadService.ts`
- `packages/model-gateway/src/index.ts`

#### 2.2 Skill 体系

- 先做最小 skills 集合：
  - `ExplainSkill`
  - `CallFlowSkill`
  - `PrincipleSkill`
  - `RiskReviewSkill`
  - `ModuleSummarySkill`
- 每个 skill 决定：
  - 用哪些证据
  - 强调什么分析角度
  - 用什么回答模板

建议关注文件：

- 新建 `apps/extension/src/agent/` 或 `packages/agent/`

#### 2.3 Soul / Persona 体系

- 定义统一回答人格
- 风格目标：
  - 不空泛
  - 强调因果逻辑
  - 对代码行为和原理做拆解
  - 结论前置，证据清楚

建议先用常量模板实现，不要一开始做复杂配置系统。

#### 2.4 Thread UI 结构升级

- 让 thread 页面不是简单渲染一段 Markdown
- 可以按块展示：
  - Summary
  - Logic
  - Call Flow
  - Risks
  - References

建议关注文件：

- `apps/extension/src/services/vibeController.ts`
- `apps/extension/src/webview/bridge.ts`
- `apps/webview`

### 验收标准

- 同一个问题的输出更稳定
- 输出更像“代码阅读讲解”而不是泛泛聊天
- 用户可以直接看到逻辑、原理、调用关系、风险点

## 3. Ask About Selection 快捷键

### 目标

降低最常用功能的触发成本，让用户无需每次右键或打开命令面板。

### 需要实现的功能

- 给 `Vibe: Ask About Selection` 增加默认快捷键
- 尽量避免和 VS Code 默认快捷键冲突
- Windows / macOS / Linux 都要考虑

### 当前实现

- 命令已注册：`vibe.askAboutSelection`
- 但 `package.json` 里还没有 `keybindings`

### 建议方案

- macOS：`cmd+shift+alt+a`
- Windows / Linux：`ctrl+shift+alt+a`

建议关注文件：

- `apps/extension/package.json`

### 验收标准

- 选中代码后，按快捷键能直接弹出提问流程
- 不影响默认编辑行为

## 4. 推荐分工方式

### A. Map / 架构可视化组

负责：

- 目录树
- 项目概览
- 调用树 / 模块依赖展示

### B. Agent / Thread 智能问答组

负责：

- 问题分类
- prompt 编排
- skills
- soul
- 输出结构升级

### C. VS Code 交互体验组

负责：

- 快捷键
- 命令交互
- 视图联动
- thread / map 的交互细节优化

## 5. 推荐优先级

### P1

- `Ask About Selection` 快捷键
- Map 目录树
- Thread 输出结构优化

### P2

- 项目概览
- 函数调用树
- Agent 技能分流

### P3

- 更完整的架构图形展示
- 更复杂的 persona / soul 配置
- 多种视图形式切换

## 6. 建议第一轮里程碑

- 里程碑 1：Map 先从“平铺文件”升级到“目录树 + 文件内符号”
- 里程碑 2：Thread 先从“自由回答”升级到“固定结构回答”
- 里程碑 3：增加 Agent 问题分类和 3 个基础 skills
- 里程碑 4：补齐快捷键和交互细节

这样推进更稳，不会一开始就把需求做得太散。
