# RUN-CASES.md:机器可重放用例 + runner 使用说明

SKILL.md 的自动化回归参考(按需加载,平时不读)。执行者是 `run-cases.js`(本 skill 目录,node 20+(22 开发实测)零依赖)。

## Contents
- cases.json 格式
- 断言表达式速查
- runner 用法与输出(含 --history 执行记录)
- 分支覆盖率(coverage.js,只对 JVM 被测服务有效)
- 实战纪律(与 SKILL.md 红线的关系)

## cases.json 格式

存放:`<项目用例库>\cases\<功能名>.json`(实测路径见本地项目档案;与同名 .md 用例文档并存,.md 给人读,.json 给机器重放)。

```json
{
  "envs": {
    "local":   { "baseURL": "http://127.0.0.1:9301" },
    "gateway": { "baseURL": "http://网关IP:端口", "pathPrefix": "/station", "tokenHeader": "Authorization" }
  },
  "defaultEnv": "local",
  "cases": [
    {
      "id": "TC01",
      "name": "列表正常查询",
      "env": "local",
      "request": {
        "method": "GET",
        "path": "/hyperthermia-setting/list",
        "query": { "pageNum": 1, "pageSize": 10, "name": "中文" },
        "headers": {}
      },
      "expect": {
        "http": 200,
        "code": 200,
        "msgContains": "操作成功",
        "json": { "data.total": ">0", "data.rows[0].ruleName": "=默认高温计费规则" }
      }
    }
  ]
}
```

字段说明:
- `envs.<名>.baseURL` 必填;`tokenHeader` 默认 Authorization;`pathPrefix` 可选=该环境统一插在 baseURL 后的路由前缀(网关场景填模块路由如 `/station`,用例 path 保持服务本位写法,同一份用例切环境不改行);env 里也可放 `"token": "{{TOKEN}}"` 占位
- `env`(用例级)覆盖 `defaultEnv`
- `query`:GET/POST 均可;**中文由 runner 做 UTF-8 编码,不要自己在 path 里拼中文**
- `bodyFile`:相对 cases.json 的路径;UTF-8 直读,自动带 `Content-Type: application/json`(中文 body 首选,等价 curl --data-binary);文件不存在=构造预检退 2(零请求)
- `body`:内联 JSON(小体量可用);与 `bodyFile` 二选一
- `expect` 四类断言全可选,组合使用;全过才算 PASS。**零断言(expect 缺失/`null`/`{}`/四类一个没写)在构造预检即退 2,不再存在"HTTP 200 即 PASS"的假绿**(仅 401/403 的兜底 FAIL 仍保留);单写 code/msgContains/json 之一的合法用例不受影响

## 断言表达式速查

| 表达式 | 含义 | 例 |
|--------|------|-----|
| `=v` | 等值(数值/字符串自动识别) | `=默认高温计费规则` |
| `=true` / `=false` | 布尔字面量(data 为布尔时的写法) | `=true` |
| `!=v` | 不等 | `!=0` |
| `>n <n >=n <=n` | 数值比较 | `>0` |
| `contains:s` | 字符串包含 | `contains:操作成功` |

JSON 路径:点路径+数组下标,如 `data.rows[0].ruleName`。路径不存在=该断言 FAIL(明细写"路径不存在")。

## runner 用法

```bash
node <skill目录>/run-cases.js <cases.json> [--env local|gateway] [--filter TC01] [--token xxx] [--out 报告片.md] [--history 记录目录] [--timeout 10000] [--allow-write] [--dry-run] [--check-only]
```

- `--env`:选 envs 里的一个作为本次默认 env(覆盖 defaultEnv,用例级 env 仍最优先);值不在 envs 里=用法错误退 2,不会静默回退
- `--filter`:正则匹配用例 id(如 `TC01`、`TC0[35]`),单跑失败用例/重跑子集
- `--token`:填充 `{{TOKEN}}` 占位符与 Authorization 头;也可用环境变量 `FT_TOKEN`
- `--out`:产出 markdown 报告片(PASS/FAIL 表+FAIL 明细附请求/响应截断),直接粘进测试报告;格式示例见 [test/mock-result.md](test/mock-result.md)
- `--history <目录>`:跑完把逐用例结果追加为 JSONL(`<目录>/<用例文件名>.jsonl`,字段=run 时间戳/spec/env/git 短 SHA/id/name/result/ms/fail 已脱敏);**每行 env=该用例实际使用的 env**(混合环境逐行各记各的,可追溯;终端汇总与 --out 仍标跑过的全部 env 合集);目录需已存在(与 --out 同口径,写错开跑前退 2);git 字段取用例文件所在仓的当前提交,不是 git 仓则记 null。**用途=数据驱动回归选样**:跑几轮之后"哪些用例该进抽样回归"看数据说话(谁老 FAIL、谁耗时异常),不靠印象挑
- `--allow-write`:写方法门禁的放行开关。选中集含 POST/PUT/DELETE/PATCH 而未给本 flag 时,**零请求退 2**,列出是哪几条写用例——"写接口按轮确认"不再靠 id 命名约定,执行器按 method 硬拦;`--allow-write` 是"本轮已确认"的执行动作,不是永久授权
- `--dry-run`:构造预检通过后只打印选中清单(`method URL id name`,URL 已脱敏),零请求、`--out`/`--history` 不写,退出码 0;含写用例时附提示"实际执行需 --allow-write"。**用途=开跑前最后一眼**——确认 filter 选中的真是你以为的那批
- `--check-only`:构造预检通过即停,只报"预检通过 N 条",零请求、不写产物,退出码 0(预检失败仍退 2 并列坏用例)。**用途=写用例入库前的离线机检**:不知道 env 通不通也能先验文件本身,不必真发写请求
- 退出码:0=全过(`--dry-run`/`--check-only` 预检通过即 0),1=有 FAIL/ERR,2=用法或文件错误(含写方法用例未给 `--allow-write`)——**可接 CI/定时任务;CI 默认只跑无真实业务副作用的套件**:只读用例,以及隔离、可自动重置的本地 mock/内存服务用例(含写接口负例,如本仓 toy-library,CI 里显式带 `--allow-write`);真实或共享测试环境中的写用例必须人工触发并在本轮开跑前确认
- 未知参数一律退 2(`--dryrun` 这类手滑不再被静默忽略——把"以为的预演"变成真发请求是最坏的一种静默降级)
- 输出每条 `[PASS]/[FAIL]/[ERR]`+失败明细;ERR=连不上/超时/重定向(3xx,请求没到业务接口),断言不通过算 FAIL 不算 ERR;**用法错误两级均零请求退 2、`--out`/`--history` 均不写**:文件级(cases 数组/id/envs 定义及 baseURL/pathPrefix/CLI 参数错)开跑前整体退 2;用例级走**构造预检**——发第一个请求前对本次 `--filter` 选中的用例逐条离线全检(**defaultEnv 或用例 env 引用不存在的环境**、path 缺失或不以 / 开头/query 值为对象/GET·HEAD 带 body/bodyFile 不存在/占位符未解析/**零断言 expect**),任一失败列出全部坏用例整体退 2;请求构造类错误已全部前移进构造预检,不再出现跑一半才炸;`--filter` 只要求选中用例过预检,未选中的坏用例不阻断单条回归

自测:`node test/mock-server.js` 起离线 mock,再 `node run-cases.js test/mock.cases.json --token test-token-abc --allow-write`(预期 7 PASS / 4 FAIL 共 11 条——FAIL 是设计出来的负例,退出码 1;带 `--allow-write` 是因为自测套件里有一条 POST 用例)。边界自测:`node test/boundary-test.js`(自起 mock 独立端口,十场景:预检零请求/零断言拦截/--filter 隔离/history 真实 env/预检无产物/token 脱敏/写门禁/零请求模式/env头字面量脱敏/key族头名脱敏,全过退出码 0)。

## 分支覆盖率(coverage.js,只对 JVM 被测服务有效)

黑盒回归回答"跑了多少条用例",覆盖率回答"盖住了多少分支"——**补用例对着未覆盖分支 TOP20 打,不看用例条数**。工具=仓库根 `coverage.js`(node 零依赖),jar 随仓分发见 [tools/jacoco/README.md](tools/jacoco/README.md)。

**前提**:被测服务启动命令加 javaagent(计数器挂在被测 JVM 里,所以**只对本地进程有效,网关/远程实例取不到数**,如实标注别硬跑):

```bash
java ... -javaagent:<仓库目录>/tools/jacoco/jacocoagent.jar=output=tcpserver,port=6300,address=localhost,includes=<业务包>.*
```

三步(顺序固定,reset 保证取到的数只含本轮用例):

```bash
node coverage.js reset  --agent localhost:6300                    # 1. 清零计数器
node run-cases.js <cases.json> --token <token> ...                 # 2. 跑用例
node coverage.js report --agent localhost:6300 \
     --classfiles <被测模块target/classes目录> \
     --classes <类名关键词> --out <输出目录>                        # 3. dump+报告+聚合
```

report 输出三档口径(全部只看 BRANCH 计数):
- **全模块**:单一功能回归时数字很低是正常的(分母是整个服务)
- **业务层**:包名含 service/controller 段,且排除 Req/Resp/Vo/Entity/Dto/Convert 等装配类——lombok equals/hashCode 的分支不是业务分支,**不排除会把数字稀释成噪音**(同一份数据,不排装配类 5.3%,排除后 34.2%,数字差 6 倍全在分母——这是这套口径最容易被追问的点)
- **--classes 匹配类**:报功能级数字用这档

产出:`coverage.md`(三档数字+未覆盖分支方法 TOP20)+ `html/`(逐行红绿)+ xml/csv。某真实项目实证:15 条只读用例对核心 Service 类分支覆盖 34.2%,对着 TOP20 补写路径用例后到 86.8%——**覆盖率把"以为测了"和"实际测了"的边界画出来**(首轮仅执行 15 条只读用例,写路径方法自然是零覆盖;随后补写路径用例,覆盖率才提到 86.8%)。

已知边界(踩过的坑,工具已内建防御):
- 类零覆盖时 JaCoCo XML 里是自闭合 `<class/>` 标签,朴素正则会把 `/>` 当开标签收尾一路吞到别的类的 `</class>`(实测 113 个自闭合标签吞出 4 个错位块)——工具用负向前瞻排除
- 人工拼接/二次加工过的 XML 里注释含 `</class>` 字面会提前截断——工具读入即剥注释
- CSV 聚合列序固定:BRANCH_MISSED=第 6 列、BRANCH_COVERED=第 7 列

## 实战纪律(红线不因自动化而松动)

- **写接口按轮确认**——凡对真实/共享测试环境的执行(手工或重放)含写用例,开跑前确认;写进 cases.json 是入库不是永久授权;隔离、可自动重置的本地 mock/内存服务(如本仓 mock 自测与 toy-library)不在此列;runner 只是执行器,不改变"写操作先点头"的红线——**runner 侧门禁**:选中集含写方法用例必须显式 `--allow-write`,否则零请求退 2(按 method 判,不靠 id 命名);高危接口(钱/退款/删存量/批量/模拟回调)不进 JSON,保持手工+确认
- token 不写进 cases.json(会随报告/仓库流转),用 `--token` 或 `FT_TOKEN` 传入;介意 argv 进程列表泄露就用 `FT_TOKEN` 环境变量
- 清理 SQL 仍交用户执行;`--out` 报告片里注明"待清理"
- 首测探索阶段可用手工 curl(灵活),**定稿后把用例同步进 cases.json**(runner 支持且非高危的才进,长度断言/xlsx/multipart 等不适用场景留 .md 并注明原因)——回归成本从"人肉重放"降到一条命令
