# toy-library:社区图书借阅系统(玩具被测系统)

一个用于第二项目实证的玩具后端:Node 标准库零依赖、进程内种子+内存态(**重启即重置**),不连任何数据库。领域=社区图书借阅。

## 启动

```
node examples/toy-library/server.js        # 默认端口 9399,可用环境变量 TOY_PORT 覆盖
```

## 速查表(ONBOARDING 第 2 步产物,随契约维护)

| 模块 | 本地端口 | 网关路由前缀 | 已核实例外 |
|------|---------|-------------|-----------|
| library | 9399 | —(无网关,纯本地直连) | — |

鉴权约定:读接口免鉴权;写接口需 `Authorization: Bearer <token>`(登录接口发放,进程内存态,重启失效)。

## API 契约

通用响应包络(除 CSV 导出外):`{code, msg, data}`;`code=200` 成功,`code=401` 凭证问题,`code=500` 业务错误(具体看 msg)。

### 读接口

| 接口 | 参数 | 说明 |
|------|------|------|
| `GET /api/books` | `pageNum`(默认 1)、`pageSize`(默认 20)、`shelf`、`keyword`(书名包含) | 馆藏分页列表;`data:{total,rows[]}`;rows 字段=bookId/title/author/shelf/available/priceFen |
| `GET /api/books/export` | `available`(缺省 true) | 馆藏清单 CSV 流(`text/csv`);表头中文一行+数据行(CRLF);字段=书ID,书名,作者,书架,状态,价格(元),入库时间;含逗号/引号的书名按 CSV 标准引号转义 |
| `GET /api/borrows/{borrowNo}` | — | 借阅单详情;borrowNo/bookId/readerId/status/dueDate/renewCount/fine |

### 写接口(需 Bearer token)

| 接口 | body | 说明 |
|------|------|------|
| `POST /api/auth/login` | `{readerId,secret}` | 合法读者发放 token(种子读者 1001/pass123);错→「读者号或密码错误」 |
| `POST /api/borrows` | `{bookId}` | 建借阅单(状态 10);书不存在→「图书不存在」;库存 0→「库存不足」 |
| `POST /api/borrows/{no}/pickup` | — | 10→20(应还时间=+14 天) |
| `POST /api/borrows/{no}/renew` | — | 20→20 同态迁移:renewCount+1(上限 2),应还时间=+7 天 |
| `POST /api/borrows/{no}/return` | — | 20→30;逾期按天数计罚金(每天 0.50 元),msg 含金额 |
| `POST /api/borrows/{no}/cancel` | — | 10→40,释放库存 |

### 管理接口(模拟 DB 预置,非业务面)

| 接口 | body | 说明 |
|------|------|------|
| `POST /api/_seed/overdue-borrow` | `{bookId}` | 预置一张已逾期 3 天的借出单(状态 20),返回 borrowNo——替代真实项目里「SQL 预置中间态」,报告引用时须注明 |

## 借阅单状态机

```
10 待取书 ──pickup──> 20 借出 ──return──> 30 已归还(终态)
    │                   │
    └─cancel──> 40 已取消(终态)
                20 ──renew──> 20(≤2 次)
```

非契约迁移一律拒绝:「当前状态不允许该操作」。

## 种子数据概览

- 馆藏 47 本:书架 A=1-20、B=21-40、C=41-47;每本库存 1 册
- 其中 6 本不在架(系统外借出):书 ID 5/12/23/31/44/47
- 书名:编号书名(id=6 为《三体,地球往事三部曲之一》,含逗号,作 CSV 转义样本)
- 读者:1001 / pass123(测试读者)

## 目录

```
examples/toy-library/
├── README.md    # 本文件=玩具契约
├── server.js    # 服务+种子
├── cases/       # 用例库(.md 人读 + .json 机器重放)
└── reports/     # 测试报告与证据
```
