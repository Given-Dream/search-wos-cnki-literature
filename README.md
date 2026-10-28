# search-wos-cnki-literature

一个通用 Codex Skill：先向用户确认是否使用默认的 WOS + 知网完整采集，并同时显示分组编号库清单；得到明确答复后，通过 Playwright/CDP 控制 Microsoft Edge，在已确认的数据库中执行可追踪检索。支持布尔构造的网站排在前面，并强制使用各库专用布尔表达式；当前未确认布尔语法的网站排在后面，采用关键词或字段分批检索并合并去重。仅当用户明确同意默认方案或按编号选择 WOS/知网时，才启用其完整采集、筛选与 TXT 导出。

核心原则是：检索主题和分组来自用户提供的策略文件，Skill 本身不绑定具体学科，也不限定 Q1–Q4。

## 功能

- 首次调用只显示“是否使用默认的 WOS + 知网完整采集？”和完整编号清单，随后等待用户；未获明确同意或编号前不启动检索。
- 以 `0` 表示默认 WOS + 知网，或按编号、逗号和升序范围选择一个或多个库；自定义选择不会自动补入 WOS/知网。
- 收录武汉文献情报中心“全文库”21 个入口，并额外保留 WOS，共 22 个稳定编号。
- 编号先列“可构建布尔高级检索式”库，再列“不构建布尔表达式”库；目录校验会拒绝两组交错。
- 布尔库必须使用 `--boolean-query` 和该库自己的字段/运算符语法；同一个表达式不能直接跨库复用。通用 `--query` 已禁用。
- 非布尔路由使用 `--keyword-query` 分批检索，并按 DOI、数据库 ID 或规范化题录合并去重；布尔式不能塞入普通关键词框。
- 分开报告入口可达、需要认证和全文权限；通达性测试不等同于订阅或全文授权验证。
- 从 Markdown 策略中提取任意数量的 WOS/CNKI 分组检索式。
- 当两库标签不同（如 WOS `A/B` 与 CNKI `Q1/Q2`）时，使用显式语义别名表归并为同一规范分组，不按位置猜测。
- 将多行专业检索式规范化为单行，同时保持引号内短语和布尔语义不变。
- 使用脚本连接可见的 Microsoft Edge，不依赖 GUI computer-use。
- 保留登录状态，由用户手动完成登录、机构认证和 CAPTCHA。
- 维普使用专用真实 Edge 配置目录和本机 CDP 接管；自动化只在检索框可见后填写并提交，不伪造指纹或搬运 Cookie。
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
- [`config/database-catalog.json`](config/database-catalog.json)：数据库编号、WHLIB 来源入口和检索模式。
- [`examples/`](examples/)：领域无关的请求、命令和候选数据示例。
- [`test/run_tests.mjs`](test/run_tests.mjs)：端到端测试。

## 环境要求

- Windows 与 Microsoft Edge。
- 可运行现代 ECMAScript Modules 的 Node.js。
- Playwright：脚本会依次尝试 `PLAYWRIGHT_MODULE_URL`、本地 `playwright` 包和 Codex Windows 运行时中的 Playwright。
- 有权限访问所选数据库的账户或机构网络；登录、机构认证和 CAPTCHA 均由用户手动完成。
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

### 2. 确认数据库（强制前置）

首次调用先显示问题和编号清单，并等待用户：

```powershell
node scripts\select_databases.mjs --list
```

用户明确同意默认完整采集后才创建默认计划：

```powershell
node scripts\select_databases.mjs --default --output D:\codex\literature-run\database-selection.json
```

用户不使用默认时，先按其编号创建自定义计划：

```powershell
node scripts\select_databases.mjs --selection 3,5-7 --output D:\codex\literature-run\database-selection.json
```

若只选择一个布尔库，可附加该库专用表达式：

```powershell
node scripts\select_databases.mjs --selection 3 --boolean-query '("rock mechanics" OR geomechanics) AND fracture' --output D:\codex\literature-run\database-selection.json
```

若只选择一个关键词分批库，可附加一个普通关键词批次：

```powershell
node scripts\select_databases.mjs --selection 21 --keyword-query "rock mechanics" --output D:\codex\literature-run\database-selection.json
```

带查询的计划只能选择一个库。多库计划先不带查询创建，再为每个库分别生成并记录检索式或关键词批次。

在收到明确答复前，不得解析或执行检索策略、启动 Edge 或访问数据库。

### 两套检索逻辑

“可构建布尔高级检索式”组必须使用布尔构造：同义词用 `OR`，必需概念块用 `AND`，有证据的排除项才用 `NOT`。随后把逻辑翻译成目标库的字段标签、短语、通配符或高级表单行。目录中的 `booleanSubmission` 指明是采集器、检索 URL、高级表单，还是维普可见检索框。

“不构建布尔表达式”组不得把布尔式当普通文字粘贴。应把策略拆成多个关键词或可见字段批次，分别执行，再合并去重并保留每个批次的查询和结果数。混合选库时，两套检索台账相互独立。

### 3. 准备 WOS/知网检索策略

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

### 4. 提取 WOS/知网策略和运行配置

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

### 5. 启动可见 Edge 会话

**强制使用已打开并保持运行的普通 Edge 桌面窗口。** 默认启动链路为 Windows `Start-Process -WindowStyle Normal`，使用独立配置目录打开原生窗口，并核对浏览器进程的原生窗口句柄、可见状态及所在桌面与当前交互桌面一致；只有通过核对后才能报告“普通 Edge 窗口已打开并保持运行”。调试端口可达或页面能渲染，都不能代替桌面窗口可见性检查。

禁止用无界面或隐藏的 Edge、内嵌浏览器、iframe、本地截图转发及输入转接面板代替这个窗口。登录、Cookie 同意、机构认证和验证码一律在普通 Edge 窗口中由用户手动完成；不再要求用户打开 `http://127.0.0.1:端口/` 面板。CDP 只作为脚本内部连接，不能充当用户操作界面。窗口不可见时停止采集并修复原生启动，不反复要求用户在不可见会话中验证。

```powershell
node scripts\edge_session.mjs `
  --profile-dir D:\codex\.edge-wos-cnki-profile `
  --port 9333 `
  --plan D:\codex\literature-run\database-selection.json
```

保持普通 Edge 窗口及脚本连接运行。手动验证完成后，复用同一会话在后台标签页采集；后台不等于启动隐藏浏览器。不抢占前台焦点，不反复最大化或调整窗口，不操作桌面鼠标键盘，不循环截图。用户可自行最小化窗口或切换到其他工作；脚本不自动将其切回前台。

自定义库中，只有目录明确标注可用 `query-url` 的条目才会打开带编码查询的检索链接；`advanced-form` 和其他 `browser-assisted` 条目打开检索页并保留 `queryPending: true`，等待按目标库语法填写表单或完成认证。打开页面不代表已取得全文权限，也不产生符合 WOS/知网数据契约的候选记录。

#### 维普：专用真实 Edge + CDP

维普可能对全新的 Playwright 上下文返回 403/412，因此不要用无会话 smoke test 的结果判定网站不可用。维普使用手册明确说明检索框支持布尔逻辑；选择编号 17 后，先生成维普专用布尔计划，再启动一个与日常浏览器隔离的可见 Edge：

```powershell
node scripts\select_databases.mjs --selection 17 --boolean-query '("岩石力学" OR 地质力学) AND 断裂' --output D:\codex\literature-run\database-selection.json
node scripts\start_edge_cdp.mjs `
  --profile-dir G:\codex\.edge-cqvip-profile `
  --port 9333 `
  --start-url https://qikan.cqvip.com/
```

首次访问时，在可见窗口中手动完成登录、机构认证或验证码。保持窗口打开，再连接该会话并检查或提交检索词：

```powershell
node scripts\edge_session.mjs `
  --connect-over-cdp http://127.0.0.1:9333 `
  --plan D:\codex\literature-run\database-selection.json

node scripts\cqvip_search.mjs --debugger-url http://127.0.0.1:9333
node scripts\cqvip_search.mjs --debugger-url http://127.0.0.1:9333 --boolean-query '("岩石力学" OR 地质力学) AND 断裂'
```

CDP 只绑定 `127.0.0.1`。`cqvip_search.mjs` 不读取密码、Cookie、令牌或浏览器存储；遇到登录、验证码或 403/412 门控时停止并交给用户处理，不自动绕过。

### 6. 收集 WOS 候选记录

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

### 7. 收集 CNKI 候选记录

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

### 8. 标注相关性与期刊证据

按照 [`references/data-contract.md`](references/data-contract.md) 为候选记录补充：

- `relevanceScore`
- `relevanceEvidence`
- `journalTier`
- `journalScore`
- `journalEvidence`

相关性是准入条件，期刊水平不能让偏题文献入选。`SCI-EXPANDED` 也不能被直接写成 JCR Q1。
若 JCR 无法访问，只能明确使用本地配置的学科期刊优先级（不得称为 JCR 分区），或将该证据标为不可用。

### 9. 筛选、导出并校验

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

- 首次确认问题、布尔组优先的 22 库编号清单和默认/自定义路由
- 强制目标库专用布尔表达式、关键词分批隔离，以及通用 `--query` 阻断
- 检索 URL 编码、高级表单待提交状态与浏览器辅助边界
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

逐库入口通达性测试：

```powershell
node scripts\test_database_access.mjs --all --output D:\codex\literature-run\database-access.json
```

该测试连接前述已核对可见性的原生 Edge 会话，在后台标签页检查入口；默认内部端点为9333，可用 `--debugger-url` 指定已有会话。它不再自动启动新的无界面浏览器，`--headless true` 会被拒绝。该报告只验证入口页导航，并始终将 `institutionalFullTextVerified` 保持为 `false`；全文授权必须另行确认。

完成检索和校验后，停止查询、轮询并按 `Ctrl+C` 断开脚本。普通 Edge 窗口独立运行；用户要求保留时保持打开，否则只关闭本次专用窗口，不影响日常浏览器窗口。

