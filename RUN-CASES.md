# RUN-CASES.md:机器可重放用例 + runner 使用说明

SKILL.md 的自动化回归参考(按需加载,平时不读)。执行者是 `run-cases.js`(本 skill 目录,node 22 零依赖)。

## Contents
- cases.json 格式
- 断言表达式速查
- runner 用法与输出
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
node <skill目录>/run-cases.js <cases.json> [--env local|gateway] [--filter TC01] [--token xxx] [--out 报告片.md] [--timeout 10000]
```

- `--env`:选 envs 里的一个作为本次默认 env(覆盖 defaultEnv,用例级 env 仍最优先);值不在 envs 里=用法错误退 2,不会静默回退
- `--filter`:正则匹配用例 id(如 `TC01`、`TC0[35]`),单跑失败用例/重跑子集
- `--token`:填充 `{{TOKEN}}` 占位符与 Authorization 头;也可用环境变量 `FT_TOKEN`
- `--out`:产出 markdown 报告片(PASS/FAIL 表+FAIL 明细附请求/响应截断),直接粘进测试报告
- 退出码:0=全过,1=有 FAIL/ERR,2=用法或文件错误——**可接 CI/定时任务**
- 输出每条 `[PASS]/[FAIL]/[ERR]`+失败明细;ERR=连不上/超时/重定向(3xx,请求没到业务接口)/请求构造失败(如 bodyFile 不存在),断言不通过算 FAIL 不算 ERR;**占位符未解析/query 值为对象/GET 带 body 属用法错误:发请求前整体退 2,不产生用例行**

自测:`node test/mock-server.js` 起离线 mock,再 `node run-cases.js test/mock.cases.json --token test-token-abc`(预期 7 PASS / 4 FAIL 共 11 条——FAIL 是设计出来的负例,退出码 1)。

## 实战纪律(红线不因自动化而松动)

- **写接口进 cases.json 仍要过用户确认**——runner 只是执行器,不改变"写操作先点头"的红线;高危接口(钱/退款/删存量/批量/模拟回调)不进 JSON,保持手工+确认
- token 不写进 cases.json(会随报告/仓库流转),用 `--token` 或 `FT_TOKEN` 传入;介意 argv 进程列表泄露就用 `FT_TOKEN` 环境变量
- 清理 SQL 仍交用户执行;`--out` 报告片里注明"待清理"
- 首测探索阶段可用手工 curl(灵活),**定稿后把用例同步进 cases.json**——回归成本从"人肉重放"降到一条命令
