# feature-test

AI 接口级测试 skill:开发者写完一个新功能,AI 完成接口级测试并出报告——用例设计(三档)→ 执行(三探+断言纪律)→ 证据分级报告 → 机器可重放回归 → 前端对接导入件。

适用于 Claude Code 类 AI 编程助手的 skill 机制(放 `<skills目录>/feature-test/`),面向 RuoYi 系 Spring Cloud 微服务项目(示例领域:充电桩管理系统)。

## 这是什么

- **[SKILL.md](SKILL.md)**:入口。定位、5 步核心流程、断言三件套、证据四级标注、红灯清单(≤100 行,按流程走时全读)
- **[patterns/](patterns/)**:场景配方库,按需加载。每文件头注明**适用语境 + 实证状态**
- **[RUN-CASES.md](RUN-CASES.md) + run-cases.js**:机器可重放回归 runner(node,自包含)
- **[test/](test/)**:离线自测 mock 系统(mock-server.js + mock.cases.json),不依赖任何真实服务即可验证 runner 本身

## 安装

1. 复制整个目录到 skills 安装路径(如 `~/.claude/skills/feature-test/`)
2. 无构建、无依赖(仅 node;测试执行还需 curl)
3. 自测:`node test/mock-server.js &` 起本地 mock,按 [RUN-CASES.md](RUN-CASES.md) 跑 mock.cases.json,期望 7 PASS / 4 FAIL(4 条是故意设计的应 FAIL 用例)/ 0 ERR

## 使用

对 AI 说「测一下 xx / 帮忙测 xx 接口 / 回归 xx / 出 Apifox 件」即可触发;完整流程见 [SKILL.md](SKILL.md)。新项目首次接入按 [ONBOARDING.md](ONBOARDING.md) 五步走。

## 适用边界(诚实声明)

本 skill 的全部配方**仅在单一项目(一个充电桩微服务项目+本地 mock 系统)上实证过**,不是通用已验证结论:

- 各 patterns 文件头的「实证状态」逐条标注了实证程度(实测/源码推导/部分实证/未实证),换项目首用须按文内判据复测
- 项目相关数值(缺省 pageSize、reasonable 默认、TokenSupport 行号等)是对被测项目及其依赖版本(pagehelper 5.3.2 等)的实测,不保证你的项目同形
- 使用本 skill 时,AI 只允许向 localhost 与你指定的测试网关发请求;数据库操作一律出 SQL 交人执行;生产环境永远不碰(详见 SKILL.md 红灯清单)

## 安全剥离说明

本仓库为可发布版,由内部全量版剥离而来:真实网关地址、本机路径、类名+行号锚点、测试数据指纹等敏感值已替换为占位符——

| 占位符 | 含义 | 实值来源 |
|--------|------|---------|
| `<被测网关地址>` | 测试网关 host:port | 你的项目档案/用例库 envs.gateway |
| `<项目用例库>` | cases/ 与 reports/ 的根目录 | 自定,如独立测试平台目录 |
| `<skill目录>` | 本 skill 安装路径 | 安装时确定 |
| `<功能id>`/`<total值>`/`<单号形态>` | 测试数据指纹 | 各项目实测时回填 |
| `<日期>` | 报告/回归报告文件名中的日期段 | 落盘当天(YYYY-MM-DD) |
| `{GW}` | 网关基址占位(SKILL.md 正文) | 同 `<被测网关地址>` |

被剥离的完整指纹存于维护方本地全量版档案(不入本仓库)。

## 目录结构

```
feature-test/
├── SKILL.md                    # 入口:5 步流程+断言纪律+红灯清单
├── README.md                   # 本文件
├── ONBOARDING.md               # 新项目接入五步
├── RUN-CASES.md                # 回归 runner 用法
├── LICENSE                     # MIT 许可证
├── run-cases.js                # 机器重放 runner(node)
├── apifox-fetch-template.js    # Apifox 导入件生成模板(复制后改 6 个常量)
├── .github/workflows/ci.yml    # CI:mock 自测+玩具重放+敏感词双扫描
├── examples/toy-library/       # 玩具级第二项目示例(零依赖 node 服务)
│   ├── server.js / README.md
│   ├── cases/                  # 用例(.json 机器重放 + .md 人读)
│   └── reports/                # 首测/重放报告
├── patterns/                   # 场景配方(按需加载)
│   ├── 网关直连.md / 登录与token.md / 分页探测.md / 导出断言.md
│   ├── 回调探活.md / 状态机测试.md / 跨模块Feign双部署.md
│   └── knownDeviation.md / Windows环境坑.md / 实证登记.md
└── test/                       # 离线自测 mock(不依赖真实服务)
    ├── mock-server.js / mock.cases.json / bodies/ / mock-result.md
```

## 许可证

本项目以 MIT 许可证发布（见根目录 [LICENSE](LICENSE) 文件）。本仓库为脱敏发布版，不含任何真实项目指纹/内网信息。
