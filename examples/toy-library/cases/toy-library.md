# toy-library 用例库(图书借阅)

> 第二项目实证(RE-50)的用例库。`.md` 给人读(含首测发现),`.json` 给机器重放(锁定件 `run-cases.js` 直跑)。
> 被测系统:`examples/toy-library/server.js`(Node 标准库,内存态,**重启即重置**);契约见 `examples/toy-library/README.md`。

## 机器可重放(15 条,cases/toy-library.json)

重放命令(**不带 --token**,读接口免鉴权,写守卫负例要求真无 token):

```
node <skill目录>/run-cases.js examples/toy-library/cases/toy-library.json --allow-write --out examples/toy-library/reports/<日期>-replay.md
```

| id | 用例 | 说明 |
|----|------|------|
| TL01-03 | 登录正/负例 | 正例断 token 前缀 tk-;错密码/缺 secret 均应拒「读者号或密码错误」 |
| TL04 | 分页正常档 | data.total=47, rows[0].bookId=1(本项目包络=**data 嵌套**,断言路径全带 data. 前缀) |
| TL05 | 缺省档 | 本项目默认 pageSize=20(第一项目=50;行数断言 runner 无数组长度断言,留 TL05 人工核 rows=20) |
| TL06 | 越界 pageNum=999 | 空 rows、total 仍 47(第一项目=返尾页,方向相反) |
| TL07/08 | 非法分页参数 | pageSize=abc 与 0 均 code500「分页参数非法」(第一项目=静默回落/空 rows) |
| TL09/10 | 三段判据两档 | 档 20 与档 40 的 total 相等=47 |
| TL11 | shelf=A 过滤 | total=20 |
| TL12 | 中文 keyword | 「三体」命中 1 本(UTF-8 链路由 runner 构造消灭) |
| TL13 | 不在架书在列表 | A 架第 5 本(id=5)available=false |
| TL14 | 写接口无 token | code401「未登录或凭证无效」 |
| TL15 | 写接口伪 token | code401(用例显式声明 Authorization 头,防 runner 注入) |

2026-10-20 首测重放:15 PASS / 0 FAIL / 0 ERR(exit=0),报告片 `reports/2026-10-20-replay.md`。

## 手工用例(11 条,不进 JSON)

**为什么不进 JSON**:状态机/并发用例每次执行都会推进单据状态与扣减库存,重放会漂移(库存耗尽后负例变正例);导出 CSV 的文本断言 runner 不支持(与第一项目导出组同款工具缺口);并发时序本身不可重放。这些按 SKILL.md 纪律走手工+确认,执行记录见 `reports/2026-10-20-首测报告.md`。

| 组 | 用例 | 期望 |
|----|------|------|
| 状态机 SM1 | 建单 bookId=7 | status=10,borrowNo=BR###;GET 回查一致 |
| SM2 | pickup | 10→20,dueDate=+14 天 |
| SM3 | renew ×3 | 第 1/2 次 20→20(renewCount=1/2,dueDate=+7 天),第 3 次「续借次数已达上限」 |
| SM4 | return×2 | 首次 20→30 fine=0.00;终态再操作「当前状态不允许该操作」 |
| SM5 | 逾期归还 | `_seed/overdue-borrow`(管理接口,模拟 DB 预置)造逾期 3 天单→return→fine=1.50(3×0.50) |
| SM6 | cancel | 10→40;列表回查该书 available 回 true(库存释放) |
| SM7 | 20 态取消 | 已取书单 cancel 应拒「当前状态不允许该操作」(20 态无 cancel 出边) |
| 写守卫 WR3 | bookId=5(不在架) | 「库存不足」 |
| 并发 WR4 | 库存 1 册双发 | 一胜一败;胜者单回查 status=10;该书 available=false |

## 维护口径

- 老文件零回写维护:契约变了重测重写(与 SKILL.md 防膨胀红线一致)
- 写接口执行授权=已批准的 RE-50 方案(2026-10-20);玩具数据内存态,清理=重启服务,无清理 SQL
