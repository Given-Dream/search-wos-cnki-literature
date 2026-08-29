# search-wos-cnki-literature

一个通用 Codex Skill：通过 Playwright/CDP 脚本控制 Microsoft Edge，在 Web of Science 与中国知网执行任意主题的分组检索，调整零结果或低精度检索式，并按可核验规则筛选、导出 TXT 文献记录。

核心原则是：检索主题和分组来自用户提供的策略文件，Skill 本身不绑定具体学科，也不限定 Q1–Q4。

## 功能

- 从 Markdown 策略中提取任意数量的 WOS/CNKI 分组检索式。
- 当两库标签不同（如 WOS `A/B` 与 CNKI `Q1/Q2`）时，使用显式语义别名表归并为同一规范分组，不按位置猜测。
- 将多行专业检索式规范化为单行，同时保持引号内短语和布尔语义不变。
- 使用脚本连接可见的 Microsoft Edge，不依赖 GUI computer-use。
- 保留登录状态，由用户手动完成登录、机构认证和 CAPTCHA。
- 根据结果行、稳定计数和视口内真实可见控件判断页面状态；不会把“暂无数据，请稍后重试”或隐藏验证码节点当作零结果/活动滑块。
- 导出并解析 WOS field-tagged full record。
- 使用 CNKI 国标引文获取 DOI 和正式出版年份，无需 EndNote。
- 分别对每个 `(分组, 数据库)` 候选池筛选，不设置任意的 WOS/CNKI 配额比例。
- 支持近三年规则、旧文高影响例外、期刊等级证据和确定性排序。
- 导出带 UTF-8 BOM 的 TXT，保证包含 `Title`、`Year`、`Authors`、`DOI`。
- 自动校验数量、字段、DOI、年份、重复记录和编码。

## 目录结构

```text
search-wos-cnki-literature/
├── SKILL.md
├── agents/openai.yaml
├── assets/
├── config/
├── examples/
├── references/
├── scripts/
└── test/
```

- [`SKILL.md`](SKILL.md)：Codex 执行入口与工作流。
- [`references/`](references/)：检索调整、浏览器流程、筛选规则和数据契约。
- [`scripts/`](scripts/)：Edge、WOS、CNKI、筛选、导出和校验脚本。
- [`assets/`](assets/)：策略、TXT 和调整日志模板。
- [`config/default.json`](config/default.json)：默认筛选配置。
- [`examples/`](examples/)：领域无关的请求、命令和候选数据示例。
- [`test/run_tests.mjs`](test/run_tests.mjs)：端到端测试。

## 环境要求

- Windows 与 Microsoft Edge。
- 可运行现代 ECMAScript Modules 的 Node.js。
- Playwright：脚本会依次尝试 `PLAYWRIGHT_MODULE_URL`、本地 `playwright` 包和 Codex Windows 运行时中的 Playwright。
- 有权限访问的 WOS 与 CNKI 账户或机构网络。
- GitHub CLI（仅安装或维护仓库时需要）。

本 Skill 不读取密码、Cookie、令牌或浏览器存储，不自动绕过 CAPTCHA，也不规避数据库访问控制。

## 安装为 Codex Skill

使用已登录的 GitHub CLI 克隆到 Codex Skills 目录：

```powershell
gh auth login
gh repo clone Given-Dream/search-wos-cnki-literature C:\Users\<用户名>\.codex\skills\search-wos-cnki-literature
```

重新启动或刷新 Codex 后，可以通过 `$search-wos-cnki-literature` 调用。

## 快速开始

### 1. 运行测试

```powershell
node test\run_tests.mjs
```

### 2. 准备检索策略

策略文件使用数据库标题、分组标题和代码块：

````markdown
# Web of Science

## GROUP_A 第一组语义说明

```text
TS=(concept A) AND TS=(concept B)
```

# CNKI

## GROUP_A 第一组语义说明

```text
TKA%=('概念A') AND TKA%=('概念B')
```
````

分组可以是 `GROUP_A`、`METHOD_CLUSTER`、`主题A` 等安全 ID，不限定数量。多个同组同库代码块会被视为替代检索式，分别执行后合并候选记录。

### 3. 提取策略和运行配置

```powershell
node scripts\extract_strategy.mjs `
  --strategy D:\path\search-strategy.md `
  --output D:\codex\literature-run `
  --config-template config\default.json
```

如果两库使用不同分组标签，先按语义填写 [`assets/group-map-template.json`](assets/group-map-template.json)，再增加：

```powershell
--group-map D:\path\group-map.json
```

提取器会拒绝未配对的标签，避免把平行分组误拆成两套组。只有确实允许单库分组时才使用 `--allow-unpaired-groups`。

生成内容包括：

- `literature-run/queries/*.txt`
- `literature-run/queries.json`
- `literature-run/config.json`

执行检索前应检查提取结果；脚本负责结构提取，不替代科学语义判断。

### 4. 启动可见 Edge 会话

```powershell
node scripts\edge_session.mjs `
  --profile-dir D:\codex\.edge-wos-cnki-profile `
  --port 9333
```

保持进程运行。若出现登录、机构认证或滑块验证，请在 Edge 中手动完成。

### 5. 收集 WOS 候选记录

```powershell
node scripts\wos_collect.mjs `
  --query-file D:\codex\literature-run\queries\GROUP_A_WOS_1.txt `
  --output D:\codex\literature-run\raw\GROUP_A_WOS.txt `
  --meta-output D:\codex\literature-run\raw\GROUP_A_WOS.meta.json `
  --limit 200 `
  --label GROUP_A

node scripts\parse_wos_export.mjs `
  D:\codex\literature-run\raw\GROUP_A_WOS.txt `
  --group GROUP_A `
  --output D:\codex\literature-run\candidates\GROUP_A_WOS.json
```

WOS 在部分中国机构网络中会跳转到 `webofscience.clarivate.cn`。代理规则可能需要同时覆盖：

```text
DOMAIN-SUFFIX,webofscience.com,DIRECT
DOMAIN-SUFFIX,clarivate.cn,DIRECT
```

### 6. 收集 CNKI 候选记录

```powershell
node scripts\cnki_collect.mjs `
  --query-file D:\codex\literature-run\queries\GROUP_A_CNKI_1.txt `
  --output D:\codex\literature-run\candidates\GROUP_A_CNKI.json `
  --state-output D:\codex\literature-run\raw\GROUP_A_CNKI.state.json `
  --limit 300 `
  --label GROUP_A

node scripts\cnki_verify_journals.mjs `
  --input D:\codex\literature-run\candidates\GROUP_A_CNKI.shortlist.json `
  --output D:\codex\literature-run\evidence\cnki-journals.json
```

CNKI 采集器会请求站点自身的 GB/T 引文数据，并提取 DOI、正式年份、引用量和下载量。

状态文件必须一并检查：

- `complete`：候选池采集完成。
- `partial`：分页或抽取提前停止，必须重试或披露。
- `confirmed-empty`：稳定的显式零计数。
- `transient-error` / `indeterminate-timeout`：页面失败，不是零结果，脚本不会写空候选池覆盖已有数据。
- `manual-verification`：仅在验证码控件真实出现在可视区域时暂停，需用户手动完成。

先按相关性、年份、文献类型和 DOI 形成短名单，再核验这些短名单期刊的知网导航证据，避免无意义地遍历大量期刊。

### 7. 标注相关性与期刊证据

按照 [`references/data-contract.md`](references/data-contract.md) 为候选记录补充：

- `relevanceScore`
- `relevanceEvidence`
- `journalTier`
- `journalScore`
- `journalEvidence`

相关性是准入条件，期刊水平不能让偏题文献入选。`SCI-EXPANDED` 也不能被直接写成 JCR Q1。
若 JCR 无法访问，只能明确使用本地配置的学科期刊优先级（不得称为 JCR 分区），或将该证据标为不可用。

### 8. 筛选、导出并校验

```powershell
node scripts\select_and_export.mjs `
  --config D:\codex\literature-run\config.json `
  --output D:\codex\literature-run\final `
  --input D:\codex\literature-run\candidates\GROUP_A_WOS.annotated.json `
  --input D:\codex\literature-run\candidates\GROUP_A_CNKI.annotated.json

node scripts\validate_outputs.mjs `
  --config D:\codex\literature-run\config.json `
  --input D:\codex\literature-run\final
```

## 默认筛选规则

- 每个分组的 WOS 与 CNKI 分别取数，每库每组最多 10 篇。
- 默认最低相关性分数为 `0.8`。
- 优先选择执行年份及此前两年，即滚动近三年。
- 旧文必须进入同库同组候选池指标前 10%：WOS 使用引用量；CNKI 使用引用量或下载量。
- WOS 默认要求 DOI、Article 和 `SCI-EXPANDED`。
- CNKI 默认要求 DOI 和期刊类型，并优先采用 GB/T 引文中的正式年份。
- 超过上限时，依次按期刊等级、可比期刊指标、相关性、年份、引用量、下载量和 DOI 排序。

所有规则均可在 [`config/default.json`](config/default.json) 中调整。

## 输出

每个策略分组生成：

```text
<GROUP>_WOS.txt
<GROUP>_CNKI.txt
```

同时生成：

- `筛选说明与数量核验.txt`
- `selection-report.json`

每条 TXT 记录至少包含：

```text
Title: ...
Year: ...
Authors: ...
DOI: ...
```

## 检索式调整

先区分“稳定的显式零结果”和“页面未完成/暂态失败”。后者不得触发检索式调整。确认零结果后，也不应直接删除核心语义块；按照 [`references/query-workflow.md`](references/query-workflow.md) 依次检查语法、单块数量、逐步交集和已检索标题，再进行有证据的扩展或收紧。调整记录可使用 [`assets/query-adjustment-log-template.tsv`](assets/query-adjustment-log-template.tsv)。

## 示例

[`examples/request.md`](examples/request.md)、[`examples/commands.ps1`](examples/commands.ps1) 和 [`examples/candidates.sample.json`](examples/candidates.sample.json) 均使用领域无关的占位概念。

## 验证状态

当前测试覆盖：

- 通用 Markdown 策略提取
- 多行检索式单行规范化
- 跨库异名分组的显式语义映射与未配对阻断
- CNKI 暂态无数据、可视验证码和隐藏/离屏验证码判定
- 任意分组与自动分组
- WOS/CNKI 独立上限
- 近三年和旧文高影响例外
- WOS/CNKI 文献类型门槛
- CNKI GB/T 正式年份
- UTF-8 BOM 和必填字段校验

完成检索和校验后，应在运行 `edge_session.mjs` 的终端按 `Ctrl+C` 结束会话，避免浏览器继续保留后台页面活动。

