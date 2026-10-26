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
- `bodyFile`:相对 cases.json 的路径;UTF-8 直读,自动带 `Content-Type: application/json`(中文 body 首选,等价 curl --data-binary)
- `body`:内联 JSON(小体量可用);与 `bodyFile` 二选一
- `expect` 四类断言全可选,组合使用;全过才算 PASS

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
node <skill目录>/run-cases.js <cases.json> [--env local|gateway] [--filter TC01] [--token xxx] [--out 报告片.md] [--history 记录目录] [--timeout 10000]
```

- `--env`:选 envs 里的一个作为本次默认 env(覆盖 defaultEnv,用例级 env 仍最优先);值不在 envs 里=用法错误退 2,不会静默回退
- `--filter`:正则匹配用例 id(如 `TC01`、`TC0[35]`),单跑失败用例/重跑子集
- `--token`:填充 `{{TOKEN}}` 占位符与 Authorization 头;也可用环境变量 `FT_TOKEN`
- `--out`:产出 markdown 报告片(PASS/FAIL 表+FAIL 明细附请求/响应截断),直接粘进测试报告
- `--history <目录>`:跑完把逐用例结果追加为 JSONL(`<目录>/<用例文件名>.jsonl`,字段=run 时间戳/spec/env/git 短 SHA/id/name/result/ms/fail 已脱敏);目录需已存在(与 --out 同口径,写错开跑前退 2);git 字段取用例文件所在仓的当前提交,不是 git 仓则记 null。**用途=数据驱动回归选样**:跑几轮之后"哪些用例该进抽样回归"看数据说话(谁老 FAIL、谁耗时异常),不靠印象挑
- 退出码:0=全过,1=有 FAIL/ERR,2=用法或文件错误——**可接 CI/定时任务**
- 输出每条 `[PASS]/[FAIL]/[ERR]`+失败明细;ERR=连不上/超时/重定向(3xx,请求没到业务接口)/请求构造失败(如 bodyFile 不存在),断言不通过算 FAIL 不算 ERR;**占位符未解析/query 值为对象/GET 带 body 属用法错误:发请求前整体退 2,不产生用例行**

自测:`node test/mock-server.js` 起离线 mock,再 `node run-cases.js test/mock.cases.json --token test-token-abc`(预期 7 PASS / 4 FAIL 共 11 条——FAIL 是设计出来的负例,退出码 1)。

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

产出:`coverage.md`(三档数字+未覆盖分支方法 TOP20)+ `html/`(逐行红绿)+ xml/csv。某真实项目实证:15 条只读用例对核心 Service 类分支覆盖 34.2%,对着 TOP20 补写路径用例后到 86.8%——**覆盖率把"以为测了"和"实际测了"的边界画出来**(该例里写路径方法全是零覆盖,与"写接口不进 JSON"红线吻合,是洞见不是矛盾)。

已知边界(踩过的坑,工具已内建防御):
- 类零覆盖时 JaCoCo XML 里是自闭合 `<class/>` 标签,朴素正则会把 `/>` 当开标签收尾一路吞到别的类的 `</class>`(实测 113 个自闭合标签吞出 4 个错位块)——工具用负向前瞻排除
- 人工拼接/二次加工过的 XML 里注释含 `</class>` 字面会提前截断——工具读入即剥注释
- CSV 聚合列序固定:BRANCH_MISSED=第 6 列、BRANCH_COVERED=第 7 列

## 实战纪律(红线不因自动化而松动)

- **写接口进 cases.json 仍要过用户确认**——runner 只是执行器,不改变"写操作先点头"的红线;高危接口(钱/退款/删存量/批量/模拟回调)不进 JSON,保持手工+确认
- token 不写进 cases.json(会随报告/仓库流转),用 `--token` 或 `FT_TOKEN` 传入;介意 argv 进程列表泄露就用 `FT_TOKEN` 环境变量
- 清理 SQL 仍交用户执行;`--out` 报告片里注明"待清理"
- 首测探索阶段可用手工 curl(灵活),**定稿后把用例同步进 cases.json**——回归成本从"人肉重放"降到一条命令
