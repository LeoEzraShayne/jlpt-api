# 人工删除：逐表计划、可运行演练与生产缺口

2026-09-13；审查基线 `550ea1e`。本轮仅新建本机隔离 PostgreSQL、合成账号；未读取生产环境、邮箱、密钥或真实用户，未调用外部 provider。Web `/delete-account` 是申请入口，本文件及演练不代表生产删除已就绪。

## 操作工具及边界

在 API 仓库根目录运行：

```sh
npx tsx scripts/deletion/run-synthetic.ts
npx tsx scripts/deletion/run-synthetic.ts --apply-synthetic
npx jest --config test/sentence-lab/jest.json --runInBand --runTestsByPath test/sentence-lab/deletion-rehearsal.acceptance-spec.ts
```

第一条默认 dry-run：创建全新隔离库和专用合成账号，输出逐表动作、影响行数、阻断原因，不执行删除/去标识。第二条只在同一流程新建的合成库执行原型事务。两者结束均删除自己创建的随机库。没有现有数据库 URL、用户 ID、邮箱或生产 apply 参数；不读取 `.env`/`DATABASE_URL`。已有测试库也不能直接传入。测试管理员连接仅接受 loopback，使用既有 `acceptanceDatabase` 创建独立随机数据库，绝不复用 A 的库或 harness。

执行能力由进程内 `WeakMap` 绑定到刚创建的 handle、数据库名称及确切合成邮箱。schema SHA-256 与 48 张表清单必须吻合，否则拒绝；SQL 标识符只来自固定代码，用户选择值参数化。事务含短锁/语句超时，遇在途任务、人工审查项或跨账号私有词汇关联则回滚。演练数据库没有持续运行的 AppModule/worker；这不是在线并发隔离已经实现的证据。

输出 `productionReady: false` 与具体 `productionBlockers`。输出的行数是目标范围行数，不是共享表总行数；共享表输出 0 表示不受本次操作影响。输出不含邮箱、账号 ID、令牌或原始文本。工具不会连接邮箱或发送处理结果。

## 48 表逐项归类

以下是提议动作，金融与运营保留策略尚需主任务确认；执行版逐表清单见 `scripts/deletion/table-plan.ts`，运行报告对每张表单独计数。

| 表 | 删除或保留计划 |
|---|---|
| User | 删除显示名称、邮箱、头像、偏好及账号资料；不可仅执行此项 |
| AuthAccount、AuthSession | 删除 Google 关联及 Web 会话，User FK 级联 |
| AndroidBindingRequest、AndroidSession | 显式删除 scalar userId 关联、绑定码哈希、PKCE 数据、原生令牌哈希与 sourceSessionId；没有 User FK |
| StudyPlan、StudyTask、UserGrammarProgress、ReviewSchedule | 删除计划、任务、记忆/复习状态；ReviewSchedule 通过 progressId 间接归属 |
| StudySession、SentenceAttempt、AiReviewJob、AiReviewResult | 删除上下文、用户原句、队列及反馈；先排空/撤销在途租约与网络请求，不能先删后仍发数据 |
| ReviewEvent、DailyStudyStat、StudyActivityDay | 删除个人复习与学习统计 |
| VocabularyEntry | 仅删除 ownerId 为目标的私人词汇；ownerId=null 公共词汇保留；被其他账号引用则阻断审查 |
| VocabularyBookmark、PersonalExpression | 删除收藏、笔记、个人表达与 provenance |
| ContentImport、ContentCandidate、ContentExposure | 删除个人导入、源文件名、候选 payload/notes、曝光记录 |
| VocabularyLearning、VocabularyPractice | 删除个人词汇记忆、答案、生成挑战/评估与队列 |
| VocabularyPracticeAttempt | 显式删除答案/评估/请求键，scalar userId 无 FK |
| QuotaAccount、QuotaPeriod、TaskAuthorization、TaskSubmission | 显式删除额度、任务计次/预留、提交及 payloadHash/resultId；均无 User FK |
| RewardTicket、RewardEvent | 显式删除奖励票据、秘密哈希、SSV userId、事件和余额关联；迟到 SSV 必须不再授予；如需为平台重试保留不可归属的事务去重证据，应另行确认最小字段 |
| PaymentOrder | 提议保留金额、币种、商品、成交/退款状态、provider/environment/order/payment IDs、时间及原始不透明 userId；清除 checkoutUrl、自由 JSON snapshot、客户端 requestKey。原 userId 当前参与 Stripe authoritative owner 验证，直接改值会导致退款校验失败。这是必要账务关联保留的候选，不能称匿名化 |
| EntitlementGrant | 提议保留订单/来源关联与必要权益计账，永久撤销访问，清除自由 metadata。LAUNCH_GIFT sourceKey 含固定邮箱，且去除会影响幂等防重赠，工具阻断这类账号，需单独去标识/权益政策 |
| BillingEvent | 保留 provider/event 唯一去重、类型、orderId/googlePurchaseId、状态与必要时间，清除自由 payload；未知、尚未关联到目标主体的事件不能伪称已定位清除 |
| GooglePlayPurchase | 暂保留加密 token、tokenHash、订单、金额状态证据所需标识和时间；清除自由 evidence，递增 revision 撤销旧 lease。令牌仍可解密用于退款核验，不属于匿名数据；需有删除主体分支才能安全继续对账 |
| AiUsageRecord | 清除 userId、taskKind/taskKey、rawUsage；保留 provider/model、随机请求 ID、tokens/cost/latency/结果码等计费核对量。必须防止迟到 fallback 再写旧关联；关联清除不等于已删除 provider 端数据 |
| ImportBatch、ImportError | 若目标是导入操作员则阻断人工审查。共享课程来源、摘要/错误文本可能含个人信息，不能只把 operatorId 置空或删除整个共享课程 |
| ContentTranslation | GRAMMAR/EXAMPLE/RELATION/SCENARIO 是共享教材译文；未知 entityType 阻断审查，不能自动假设是公共数据 |
| GrammarPoint、GrammarExample、GrammarRelationGroup、GrammarRelationMember | 共享语法与例句保留 |
| ReviewAlgorithmProfile、TrainingScenario | 共享复习参数/场景保留 |
| AiProviderCircuit、BillingConfig、AndroidCommerceSyncState | 全局熔断、计费开关及 RTDN/voided 同步水位保留，不能因一账号删除而重置 |

## 已复现的生产阻断

独立真实 PostgreSQL，实际业务 service；第三方返回值为离线合成 fixture，绝不把它们称为 Stripe/Google 平台删除实测。

1. **Stripe 迟到成功重建孤立权益。** `lockBillingUser` 的 `SELECT ... FOR UPDATE` 在 User 不存在时返回空而不失败。保留的未付款订单随后收到成功事件，`StripeWebhookService` → `EntitlementService.grantOrder` 创建无 FK 的 ACTIVE grant。User 未重建，但删除对象的权益记录恢复。
2. **Google 迟到退款不能完成对账。** 已确认购买保留原 userId；删除 User 后 purchase 的 obfuscated account 无法 resolve，触发 `GOOGLE_OWNER_MISMATCH`。`reconcile` 记录 `GOOGLE_RECONCILIATION_FAILED`，本地订单仍 PAID、refundedAmount=0，尽管合成平台返回 REFUNDED。简单将队列 userId 置空只能进入 AWAITING_OWNER，也不能对账。事务外先 resolve owner、删除同时发生的路径同样缺少提交前存活判断。
3. **AI 迟到请求重新关联。** `MeteredAiClient` 每次网络前写无 FK `AiUsageRecord`，旧 worker 已持有 context 时可在删除后写回旧 userId/taskKey。已有 receipt 去关联可保留完成计费；后续 fallback/repair 的新请求必须拒绝或使用不可关联的计费上下文，不能继续发送已请求删除的学习内容。

SSV 删除票据后晚到不能找到 ticket，因此现有流程拒绝，不能补奖励。若回调在删除前已读取 ticket，事务内仍会再次查询 ticket；被删除则事务失败。不过所有发票据/额度写入入口仍需一致的存活检查，以防旧已鉴权请求越过删除。

## 最小生产设计建议（未实施，待主任务锁定）

1. **删除主体墓碑**：候选新增 `DeletedAccountSubject`，仅 `userId` 主键、可选唯一 `googlePlayAccountIdHash`（原值是高熵随机 ID）、`deletedAt`、随机人工请求审计引用/版本；不保留 email/name/avatar/Google 登录 subject。不能用该表登录或恢复账号。用途限定为拒绝迟到业务写入、将迟到 Play 账务映射到已删除主体。保留期限与清理规则须另行确认，没有建议法定年限。
2. **写入与删除共享锁**：针对不透明 userId 使用统一事务锁（例如 advisory lock，在 User 已不存在时仍有效）。事务内 recheck 活跃账号/墓碑；所有无 FK 写入点及原生绑定提交都遵循相同顺序。删除事务先写墓碑，撤销会话/租约，再完成清理。仅检查函数返回的空 User 行而不统一复查调用点不够；外部 API 不应放进长数据库事务。
3. **账务专用分支**：已删除主体的 Stripe/Google 事件继续验金额、币种、provider/environment、原始订单归属和单调退款；只更新账务及去重，不调用 grant/membership/ensureGift 或再创建额度。Google 以墓碑 hash 核对官方 obfuscated account，已知 token 与未知 token 两条路径都要覆盖；fenced CAS 仍适用。不能把原金融 userId 直接改成新 ID 而绕过 ownership 验证。
4. **未完成购买须明确业务处理**：删除前已经开通的权益是否视为放弃、仍 pending 且删除后才扣款的订单如何退款/人工处理、是否继续 consume，需主任务确定。不能静默没收付款、不发权益却冒充已履约消费，也不能在本轮自动退款。任何转人工状态必须有持久队列/错误码，不丢通知。
5. **AI 与队列终止**：逐请求开始前/计量创建时检查删除状态，后续 repair/fallback 不发网络；在途已发送请求完成时保留去关联 receipt 成本，不能再写用户标识或学习结果。学习 worker 写回使用失效 lease/缺失实体校验，额度路径也必须 fail closed。删除前实际排空完成才能宣称当前应用不再处理该账号内容。
6. **新登录是新账号**：删除认证关联后用户主动再次 Google 登录可创建新账号、新随机 Play account ID，不能自动恢复旧学习/权益。墓碑不保存可用于重建账号的邮箱；避免误称永久禁止同一人注册。已购权益迁移/退款争议另走人工核验。

## 运营完成定义

默认 preview → 核验申请所有权/服务范围 → 审查逐表计数、付款/订阅与必要保留 → 冻结写入并排空 → 事务执行 → 复核每表、迟到事件、重新登录行为 → 由获授权人员报告真实结果。不得以邮件已收到或 SQL 已提交就发送“所有数据已删除”。

应用 DB 清理不覆盖旧功过格独立 DB、本地导出、浏览器/Android 本地数据、邮件申请本身、服务器日志、备份或 Google/Stripe/AI provider 的留存；每项分别核实执行能力、必要保留和结果。运营负责人、保留目的/期限、数据处理商能力与恢复备份后的再清理流程尚未验证。本轮不改变隐私承诺、市场、生产配置、删除 SLA 或退款政策。

## 验证解释

测试对现状缺口使用 `KNOWN BLOCKER` 命名并断言其被复现。套件通过表示审计发现可重复，并不表示安全删除通过。真正修复后这些断言必须转换为“迟到账务能对账、无授予、无用户关联复活”的验收，并增加删除/回调重叠、用户重注册、未知 owner RTDN、pending 付款、SSV、AI fallback、备份演练。生产功能在此之前维持未就绪。
