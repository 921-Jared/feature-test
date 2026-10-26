# tools/jacoco — 分支覆盖率工具 jar

JaCoCo 0.8.12 官方发行版,随仓分发使覆盖率功能开箱即用(免装 maven/gradle 拉依赖)。

| 文件 | 用途 |
|------|------|
| `jacocoagent.jar` | javaagent,挂进被测 JVM(`output=tcpserver` 模式常驻取数口) |
| `jacococli.jar` | CLI,dump 计数器 + 生成 HTML/XML/CSV 报告 |

- 许可:**EPL-2.0**(Eclipse Public License 2.0),允许再分发;本仓按原样分发未做修改
- 来源:maven central `org.jacoco:org.jacoco.agent:0.8.12` / `org.jacoco:org.jacoco.cli:0.8.12` 的 fat jar
- 升级方法:下载新版本同名替换即可,`coverage.js` 对 jar 版本无硬依赖
- 适用范围:被测服务为 JVM 进程且能本地直连(agent 挂在被测进程里,远程/网关场景取不到数)
