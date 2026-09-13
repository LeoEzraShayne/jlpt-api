# 人工账号删除执行工具与安全修复

2026-09-13。此文取代 `630f058` 阶段的仅合成原型结论；逐表分类仍见 `scripts/deletion/table-plan.ts`。本轮所有执行均为新建本机随机数据库中的合成账号，没有连接生产、删除真实账号、发送邮件或部署。

## 已实现的行为

`User.deletedAt` 标识不可登录的匿名占位主体。清除原邮箱、名称、头像、角色/偏好及登录关联，删除全部 Web/Android 会话和绑定、个人学习/队列/额度/奖励数据。仅保留不透明 userId、随机匿名邮箱、删除时间及既存账务对账需要的高熵随机 Google accountId；该随机标识不包含 Google 登录 subject，不能用于登录。旧 Google 登录关联已删，用户主动再次登录会创建新账号，不恢复旧学习、购买或绑定身份。

订单/账务保留候选按具体申请由操作员审核。保留 provider、环境、订单/支付 ID、币种金额、交易/退款状态和必要时间；去除 checkoutUrl、客户端 requestKey、自由 snapshot/payload/metadata。AI usage 清除 userId/taskKey/taskKind/rawUsage，计费计数可保留。Google 退款核验仍需加密 token 与随机购买主体关联，属于可关联的账务留存，不能称完全匿名。没有设定法定年限或自动保留期限。

数据库 guards 覆盖直接用户所有权、间接 AI/复习记录、原生 session/绑定、额度/奖励等 INSERT/UPDATE。已删除主体资料不可改回；普通共享课程和无主体的全局配置不受影响。财务回调允许更新旧账，但任何 grant 均不可恢复 ACTIVE。新 AI receipt 在网络前被拒绝；已入场的请求可完成去关联的计费记录，学习结果不能写回，后续 repair/fallback 的新 receipt 被拒绝。已传给 provider 的内容不因本地删除被远端撤回。

Stripe 迟到成功只对账，不创建权益；未全额退款的已删除主体账务事件标记 `DELETED_ACCOUNT_MANUAL_REVIEW`。Google 即使首次 token 在删除后才到达，也能根据留存的随机主体定位账务；已删除主体不新消费购买，记录 `GOOGLE_DELETED_ACCOUNT_MANUAL_REVIEW`/`MANUAL_REVIEW` 供人工处置，后续退款照常核实。没有自动退款或静默宣称已履约。已在途的消费调用不能被数据库撤回，需在人工账务审查中核实平台实态。SSV 票据已删除，迟到回调不能补奖励余额。

## 人工操作接口（本轮未运行生产命令）

不读取 `.env`，不自动使用应用 `DATABASE_URL`，不自动选择账号。需由获授权操作员显式配置专用 `ACCOUNT_DELETION_DATABASE_URL`，通过 `--user-id` 选择已核验的账号。默认只预览。数据库凭据不能放入命令行、文档或报告。

```sh
npx tsx scripts/deletion/run-operator.ts --user-id ACCOUNT_ID --report NEW_PRIVATE_PREVIEW_FILE
```

预览输出 48 表分类、计数、`planDigest`、在途工作计数与人工阻断项；不输出账号邮箱、原文或凭据。共享表计数 0 表示不受操作影响。schema hash 或表清单改变则拒绝，需重新逐表审查。

执行另需已核验人工 review JSON，字段如下。下例是格式说明，不能直接当作真实审批记录；日期、依据、范围与权益影响必须针对申请填写，没有默认值。

```json
{
  "userId": "ACCOUNT_ID",
  "requestRef": "PRIVATE_REQUEST_REFERENCE",
  "ownershipVerified": true,
  "scope": "JLPT",
  "retentionBasis": "经核实的具体必要留存依据与最小范围",
  "nextRetentionReview": "YYYY-MM-DD",
  "rightsEndAcknowledged": true,
  "pendingPaymentHandling": "MANUAL_REVIEW_NO_AUTO_REFUND",
  "planDigest": "预览报告中的64位摘要"
}
```

```sh
npx tsx scripts/deletion/run-operator.ts --user-id ACCOUNT_ID --review-file PRIVATE_REVIEW_FILE --report NEW_PRIVATE_RESULT_FILE --apply
```

必须新建结果文件，权限 `0600`，先写 STARTED 意图和 review hash，再执行事务并追加实际结果。重复的报告路径拒绝；默认预览不会删数据。计划计数发生变化则回滚、要求重新审查。程序异常或报告只含 STARTED 时不能回复“已完成”；在账号锁下复查 tombstone 及结果。重复已完成请求返回原 `deletedAt`，不重置时间/匿名身份、不再执行清理。报告及人工申请本身也需要受控保留和复查，本程序不会发送邮件。

`productionReady: false` 表示本轮未验收实际运营/生产执行，不能用合成测试越过运营核验。review 中留存说明不是法律判断；无明确依据的字段不得因为 schema 有它就一律保留。

## 并发与作用范围

删除采用 `READ COMMITTED`，先取得保留 User 行的排他锁，再读取每表计数和执行。如此能看到等待锁期间前一交易提交的 grant；`REPEATABLE READ` 的旧快照可能漏记这类行，因此不使用。计费/原生绑定显式采用同一 User-first 锁序列。低层数据库 guard 取得 User 共享锁，作为绕过服务方法的保护；若已有旧业务先锁子行再触发 guard 与删除产生反向等待，PostgreSQL 可能回滚一个事务。锁/语句超时及任何死锁均必须失败/重审，不降低隔离或跳过 guard 重试。

操作工具先作 tombstone，再依依赖顺序删除子行，避免 FK 的 SET NULL 回写到已删除主体。旧 Google 租约通过 revision 增加被隔离；其他任务实体删除使完成写回失效。已入场外部请求计数会报告，不能把本地提交当作 provider 已终止/远端已删除的证明。

当前明确阻断：导入操作员关联的共享 ImportBatch/ImportError、未知 ContentTranslation entityType、跨用户引用的私人词汇、LAUNCH_GIFT。它们需要单独最小数据/幂等赠送政策审查，工具不猜测或直接级联删除别人的内容。没有删除旧功过格独立数据库、本地导出、邮件、日志/备份或 provider 端数据。

## 增量迁移与回退

`20260913063000_account_deletion_guard` 只加可空 deletedAt 和针对写入的函数/触发器；已有用户默认 null，原字段/全局开关/课程/账务值不改变。先应用 migration，再启动候选 API；新代码调用迁移提供的 `lock_account_subject`，不能在缺此函数的旧 schema 上运行。

尚未创建任何 tombstone 时，可停止写入进程、回退到兼容旧 schema 的旧版本，再执行 `docs/operations/account-deletion-rollback.sql`。它取得 User 表锁，并在存在任一 tombstone 时拒绝；成功才移除本迁移 guards/函数/列，不删除数据。该脚本也只在隔离合成库演练过。

已经执行过删除后，只能保留保护并向前修复，不能删除 deletedAt、把匿名 User 恢复可登录、重新绑定旧 Google 登录或整体恢复旧备份。尤其不能回退到会对已删除主体自动消费 Google 购买的旧 worker。任何灾难恢复需重放已执行的删除状态，具体备份流程尚待运营验证。

## 本轮验收

真实本机 PostgreSQL 独立随机库，第三方响应为离线合成 fixture，无真实平台调用。覆盖默认预览、review/摘要失效、逐表清理、事务失败回滚、重复请求、会话失效与新账号、迟到 Stripe/Google/SSV、数据库原生写保护、入场 AI 成本去关联与新调用拒绝、实测 pg_stat_activity 锁等待的删除/授予竞态、迁移保留与禁止破坏保护的回退。旧 `KNOWN BLOCKER` 断言已改为安全行为断言。

另以实际 `run-operator.ts` 子进程连接新建合成数据库，验证默认预览、缺少 review 拒绝、按审核摘要执行、`0600` JSONL 结果、重复报告路径拒绝和执行后的 tombstone。没有用生产连接测试此命令。

验证命令：`npm test -- --runInBand`（428 项单元）；`npm run test:integration`（72 项真实隔离学习集成）；`npx jest --config test/sentence-lab/jest.json --runInBand --testPathIgnorePatterns 'content|source-correction'`（当前 W3/Android/删除真实隔离验收，内容快照专用套件不在本轮）；定向 ESLint、`npm run build`、`npx tsc --noEmit`、`npm run check:lines`、`git diff --check`。删除专项包含 20 项（原型修复、锁竞态、迁移和真实 CLI）。

最终整批运行曾出现一次既有 `http.acceptance-spec.ts` 的 HTTP 解析错误（153/154）；未修改代码立即单独复跑该套件 4/4 通过。此前整批 152/152 通过，后加死锁和 CLI 用例各自通过。保留此未复现记录，不能伪称每次整批运行都成功。

部署、真实申请运营、法律依据/必要保留复查、旧服务/备份/provider 删除不属于已完成项。
