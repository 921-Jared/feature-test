# 用例重放结果(格式示例)

> 注:本文件为 `run-cases.js --out` 报告片的**格式示例,非真实跑测记录**;路径与时间为示意占位。自测产生真实记录的方法见 RUN-CASES.md「runner 用法」。

- 用例文件: `<skill目录>\test\mock.cases.json`  env: `mock+mockp`  时间: 示例时间戳
- 汇总: 7 PASS / 4 FAIL / 0 ERR,共 11 条

| 用例 | 名称 | 结果 | 明细 |
|------|------|------|------|
| TC01 | 正常查询+JSON路径断言(含中文等值) | PASS | — |
| TC02 | 业务code不符→应FAIL | FAIL | 业务 code 期望 200,实际 500 |
| TC03 | POST中文body文件回显→UTF-8链路 | PASS | — |
| TC04 | GET中文query回显→UTF-8链路 | PASS | — |
| TC05 | msgContains不符→应FAIL | FAIL | msg 期望包含 "系统繁忙",实际 操作成功 |
| TC06 | 数值断言不符→应FAIL | FAIL | JSON data.total: 期望 >100,实际 5 |
| TC07 | token占位符替换→Authorization回显 | PASS | — |
| TC08 | 布尔断言 data=true→=true 应PASS | PASS | — |
| TC09 | 布尔断言 data=true 判 !=true 应FAIL(防假PASS) | FAIL | JSON data: 期望 !=true,实际 true |
| TC10 | env级pathPrefix→网关路由前缀场景 | PASS | — |
| TC11 | 布尔断言 data=false→=false 应PASS(补false方向) | PASS | — |

## TC02 业务code不符→应FAIL

```json
{
  "method": "GET",
  "path": "/badcode"
}
```

HTTP 200,响应前 1500 字:
```
{"code":500,"msg":"系统繁忙,请稍后再试!"}
```

## TC05 msgContains不符→应FAIL

```json
{
  "method": "GET",
  "path": "/ok"
}
```

HTTP 200,响应前 1500 字:
```
{"code":200,"msg":"操作成功","data":{"total":5,"rows":[{"ruleName":"默认高温计费规则"}]}}
```

## TC06 数值断言不符→应FAIL

```json
{
  "method": "GET",
  "path": "/ok"
}
```

HTTP 200,响应前 1500 字:
```
{"code":200,"msg":"操作成功","data":{"total":5,"rows":[{"ruleName":"默认高温计费规则"}]}}
```

## TC09 布尔断言 data=true 判 !=true 应FAIL(防假PASS)

```json
{
  "method": "GET",
  "path": "/flag",
  "query": {
    "val": "true"
  }
}
```

HTTP 200,响应前 1500 字:
```
{"code":200,"msg":"操作成功","data":true}
```