# Example requests

## From a topic

使用 `$search-wos-cnki-literature` 调研衬砌岩洞储能相关论文，覆盖储氢、压缩空气储能和天然气储存。

先展示分组草案，再为用户选择的数据库生成检索式。以下示例中的共同研究对象为衬砌岩洞（lined rock cavern, LRC）。「人工硐室」等较宽的词需要结合衬砌及储存用途判断。

| ID | 研究问题 | 必需概念和筛选边界 |
| --- | --- | --- |
| `G0_LRC` | LRC 的总体研究有哪些？ | LRC 作为主要研究对象，保留总体设计、关键技术和基础工作 |
| `G1_HYDROGEN` | LRC 怎样用于储氢？ | LRC ∩ 储氢，保留直接研究储氢工况、性能或失效的工作 |
| `G2_CAES_GAS` | LRC 怎样用于压气储能或天然气储存？ | LRC ∩（压缩空气储能 ∪ 天然气储存），按介质标明适用范围 |
| `G3_THERMOMECH` | 运行载荷怎样影响洞室结构？ | LRC ∩（热力耦合 ∪ 循环响应），覆盖与运行有关的温度、应力和变形 |
| `G4_LINER_SEAL` | 衬砌和界面怎样承担密封与传力？ | LRC ∩（衬砌承载 ∪ 密封 ∪ 界面），保留与洞室承载、渗漏及耐久有关的工作 |
| `G5_TEST_DEMO` | 哪些研究提供试验或工程证据？ | LRC ∩（试验 ∪ 工程验证），分别记录材料试验、相似模型和现场运行证据 |

在 `semantic-groups.md` 中补齐每组的词块及边界。对 WOS 和知网采用同一组 ID，按各库字段语法组织表达式。如果用户把范围限定为储氢，将该限定保留在各个适用分组中。

## From a prepared strategy

Use `$search-wos-cnki-literature` to execute the supplied Markdown strategy in WOS and CNKI through scripted Microsoft Edge. Semantically align different WOS/CNKI source labels with an explicit group map, distinguish transient/verification states from confirmed zero results, repair confirmed zero-result queries with block counts and title evidence, and independently select no more than 10 highly relevant records per database/group. Prefer the latest three years, allow documented high-impact older exceptions, rank excess records by verified journal evidence, and export UTF-8 BOM TXT files containing Title, Year, Authors, and DOI.

Expected deliverables are one WOS and one CNKI TXT for every strategy group, collection-state sidecars, a screening summary, `selection-report.json`, and a query-adjustment log.

