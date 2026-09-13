# Android A1 Google 核心独立验收

日期 2026-09-13；实现 `7a9d2ae` + 修复 `f6b584b`；F 独立测试基础提交 `301cfd7`。范围是购买验证/持久化队列/账本/退款/voided 同步，controllers 与 SSV 尚未注册于此候选。

## 结论与已修缺陷

F 在修复前复现最终 fenced CAS 失败却提交账本的问题：grant 事务已生成订单和权益后，lease 失效使 queue 最终 updateMany 返回 0，原代码忽略该结果，产生未关联 queue 的已提交权益。后续可能因 provider order/payment 唯一键冲突而无法恢复。

`f6b584b` 要求最终 CAS count 必须为 1，否则 throw 使整个事务回滚。F 在真实 PostgreSQL 独立复验：过期边界没有残留订单/权益/consume；随后新 lease 重试正常生成一份已关联订单和权益。此缺陷已关闭。

当前核心可继续集成；不意味着可启用 Google 销售。真实 publisher responses、服务帐号权限、Play 测试购买/消费、HTTP owner/scope 校验、RTDN 公网身份验证与 Android 设备流程仍待验证。

## 独立真实 PG 证据

`android-google-independent.acceptance-spec.ts` 共 7 条。数据库、事务、行锁、fence、事件与权益服务均真实；只有 Google transport 返回合成的领域场景，不称为平台成功。

- 旧 worker consume 请求挂起期间，租约到期，由新 worker 处理更新的全额退款；旧 consume 晚到后，订单仍全退、权益仍 REVOKED、queue 仍 NOT_APPLICABLE，不能复活。
- 最终 CAS 丢失回滚全部订单/权益；随后重试可恢复，详见上文。
- 加密配置故障时 RTDN receipt 与 token queue 整体回滚，不能先记去重事件而丢 token；修复后同 event 成功持久化，事件仅含 hash，queue 含可解密 AEAD，未知 owner/product 仍为 null。
- USD 0.99 订单先处理 0.10+0.25 两笔成功部分退款，排除待处理 0.50；重复快照总额仍为 35 分。全额退款后总额固定 99 分，后续 PROCESSED 快照不能恢复权益。
- 旧 voided scan 失去随机 lease 后不能覆盖新 worker 水位或 lease。
- 8 个不同通知同时到达同 token，仅形成 1 条未认领 queue，revision 与 8 条 receipt 全部保存；后续 account id 映射到真实用户后只有 1 份订单/权益，8 条事件全部处理。禁用新销售开关不抛弃既有已付款队列。
- voided 水位超出 30 天时保留原水位、持久化 HISTORY_GAP，不能假装扫描完成。

A 自有 10 条 PG 测试也复验，涵盖 pending、加密去重、崩溃重试、owner 变更拒绝、owner 之前已退款的 tombstone、纳秒顺序、授予失败不 consume、分页失败不推进等。作者测试与 F 独立新增覆盖分别计数。

## 金额与官方语义核对

Orders 的 total 是用户最终支付额（含税与折扣），部分退款使用成功事件 refundDetails.total 的累计快照；不能以 developerRevenue 推断退款。代码使用对应字段、整数 nanos 到币种最小单位的精确换算，对不支持的币种、无法整除的精度和 Int 溢出拒绝处理。Google lastEventTime 保留 RFC3339 原值并按纳秒比较，不作为本地 queue revision。[Google Orders API](https://developers.google.com/android-publisher/api-ref/rest/v3/orders)

用户只由 product purchase 返回的 obfuscatedExternalAccountId 映射，本地未知 owner 不伪造帐号；购买状态、测试环境、单商品、purchaseOption、offer 与 order 的 token/product 一致性分别核验。[Google ProductPurchaseV2](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.productsv2)

## 验证结果

完整 F acceptance：18 suites / 106 tests PASS；Google gateway 签名/AEAD 作者单元测试 2/2 PASS；新增测试 TypeScript/ESLint PASS；247 文件行数检查 PASS。

## 仍有边界

本次没有 Google/Stripe/AdMob 网络调用、生产库或联调 harness 库写入。4401 的旧 auth AppModule 继续运行，不随此次 checkout 重新加载。

核心方法允许既有队列在关闭新销售后完成；新增购买入口必须在 controller/service 层另验 native scope、绑定 owner、销售开关、环境和 package。SSV 签名参数规范化与奖励幂等未在此候选中，不能以本报告替代。货币 whitelist 与真实 Play 可售地区配置须匹配；遇到不支持币种时当前行为是留在可重试失败状态，不发权益。
