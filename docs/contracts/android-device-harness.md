# Android 临时真实 API 联调服务（F）

入口：`test/sentence-lab/android-device-harness.ts`。这是本地测试进程，不部署、不导入生产入口；它启动实际 AppModule、实际 guards/validation/filter/Helmet、真实随机 localhost PostgreSQL 数据库。合成用户经实际 AuthService 创建，源会话期限等于 harness 期限。未复制生产数据、Cookie 或密钥。

## 启动

在独立 worktree 根目录执行（必须 ts-node，保留 Nest 构造器的 decorator metadata）：

```sh
TS_NODE_FILES=true node -r ts-node/register test/sentence-lab/android-device-harness.ts --port 4401 --frontend-url https://received-office-chelsea-wisdom.trycloudflare.com --api-public-url https://received-office-chelsea-wisdom.trycloudflare.com --state-dir /tmp/jlpt-f-android-device-20260913 --max-minutes 120
```

HTTPS 域名是本轮临时值，下轮换成主 Agent 提供的新来源。`FRONTEND_URL` 和公开 API 来源必须完全同源：反代 `/api/v1/*` 到 `127.0.0.1:4401`，其余到测试 Web。默认端口 4401，最大期限 120 分钟。只监听 loopback；隧道由主 Agent 管理。省略 state-dir 时创建新的随机临时目录。

准备完成只输出 `F_ANDROID_HARNESS_READY`、端口和 state 文件位置，绝不打印 Cookie/登录秘密。`state.json` 与 `cookie.txt` 均为 0600，目录 0700；文件含本轮测试身份、PID、期限、一次性 loginUrl/loginPath。用本机工具读取并打开该 URL；不要贴到共享日志或报告。状态文件未包含生产凭据。

一次性地址固定在 `/api/v1/__f_test_login/<43字符随机秘密>`，未知地址返回 404，成功后同地址再访问为 404。首次成功设置本轮 HttpOnly、SameSite=Lax、HTTPS Secure Cookie，然后跳到测试 `/today?platform=android&client=android-test`。如需直接回到绑定页，可以添加 `?bindingId=<本轮真实绑定UUID>`；重定向目的地仍固定同源。

## 隔离与边界

- 清除继承的业务环境变量、代理与凭据；只保留本机运行所需变量及可选 `TEST_DATABASE_ADMIN_URL`。后者也由现有 helper 强制 localhost。
- 全量迁移只应用于本轮随机 `jlpt_f_acceptance_test_*` 库；之后 chdir 到新建空目录再延迟加载 AppModule，ConfigModule 不会读取项目 `.env`。
- AI worker 关闭，Gemini/DeepSeek/Stripe/Play/AdMob 无凭据。native commerce 身份绑定开关为 true，Google/AdMob env 与数据库商业开关均为 false；Web sales/rewards false。
- Node HTTP/HTTPS 出站方法以及全局 fetch 在该进程中全部拒绝；入站 API 与本机 PostgreSQL 不受影响。Google OAuth 两条入口另以测试中间件返回 404，避免浏览器误去外部 OAuth。
- 测试登录入口仅存在于本测试脚本的中间件，没有修改 production controllers、guards 或登录策略。不提供目录、身份列表或秘密发现接口。
- 联调不能当作真实 Google 登录/消费/SSV、Google Play 身份或设备端 state 校验通过证据。

## 退出和重新运行

向 state.json 中记录的 PID 发 SIGTERM 或在运行终端 Ctrl-C；也会在 max-minutes 到期自动停止。正常退出关闭 Nest、断开数据库连接、删除本轮随机数据库和 state/cookie/lock 文件。输出 `F_ANDROID_HARNESS_STOPPED` 后，该 Cookie 与 native token 均已无数据库可用。

不要用 SIGKILL，否则正常清理钩子无法执行。如进程意外被强杀，仅使用其先前 state 文件中的精确随机测试库名清理；绝不匹配或批量删除其它库。活跃 harness.lock 防止覆盖另一轮秘密。重新运行会创建新库、新帐号、新 Cookie 与新一次性 URL。

## 本轮脚本自检证据

端口 4403 启动真实 AppModule 后，独立 HTTP 客户端验证 health 200、OAuth 404、未知登录路径 404、一次性登录 302/再次404、Cookie属性和文件0600、实际 `/me` cookie认证、错误 Origin 批准403、完整 PKCE创建/批准/兑换、bearer不能进入Web `/me`、native logout成功后失效。随后 SIGTERM，使用独立 PG 查询确认该随机库已不存在，state/cookie/lock 已删除。脚本 TypeScript 与 ESLint 通过。
