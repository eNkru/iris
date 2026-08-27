# Iris

自托管的价格追踪与提醒应用。添加商品，让 Iris 帮你盯住价格变化，并在价格变动时收到通知。

![Iris 仪表盘](docs/screenshot.png)

## 功能特性

- **商品仪表盘** — 追踪商品当前价格、价格历史图表，以及每个商品的状态（正常 / 需关注 / 受阻）
- **降价提醒** — 每次价格检查都会评估可配置的提醒规则
- **提醒渠道** — 邮件和 Telegram 通知，以及周期性摘要
- **价格提取** — 价格由 argus 服务提取：优先确定性解析 schema.org JSON-LD，可选在 argus 侧配置 LLM 兜底（Iris 内部不运行任何模型）
- **反爬虫抓取** — 页面通过独立 **argus** 服务托管的反检测 [Camoufox](https://camoufox.com) 浏览器抓取，因此即使页面受到 DataDome / Cloudflare / Akamai 挑战保护也能正常工作
- **魔法链接登录** — 基于 better-auth 的邮箱魔法链接登录，内置初始化的管理员用户
- **调度器** — 进程内调度循环，并通过按商品划分的 single-flight 保护避免重复检查

## 技术栈

| 层级 | 技术 |
| --- | --- |
| Web 应用 | Vite SPA + Hono 服务器，React 19，React Router 7，Tailwind CSS v4，TanStack Query，Recharts |
| API | oRPC + Zod |
| 认证 | better-auth（魔法链接，SMTP） |
| 数据库 | SQLite + Drizzle ORM + better-sqlite3 |
| 运行时 | 单一 Node 镜像（单个 Hono 进程） |
| 价格流水线 | Argus 服务（反检测 Camoufox 抓取 + 价格提取） |
| 通知 | SMTP（nodemailer），Telegram Bot API |

## 仓库结构

pnpm monorepo（pnpm ≥ 11，Node ≥ 20）：

```
apps/
  web/            Vite + Hono 应用 — UI、oRPC 客户端、进程内调度器入口
packages/
  api/            oRPC 路由、过程、中间件
  auth/           better-auth 配置、SMTP 魔法链接邮件、管理员初始化
  database/       SQLite Drizzle 模式、迁移、查询、种子脚本
  prices/         价格流水线（通过 argus 提取 → 提醒规则）、调度器、通知
  utils/          通用工具和环境校验
Dockerfile        单一 Node 镜像（页面抓取由外部 argus 服务承担）
```

## 快速开始（Docker）

推荐的部署方式是一个容器加一个持久化 SQLite 卷。镜像以单个 Node 进程运行 Hono Web 服务器和调度器；启动时会自动执行迁移。页面抓取需要一个可访问的 **argus** 服务（从 argus 仓库部署）——请相应设置 `ARGUS_BASE_URL` 和 `ARGUS_API_TOKEN`。

```bash
cp .env.example .env   # 调整密钥（BETTER_AUTH_SECRET、SMTP、ARGUS_API_TOKEN 等）
docker compose up --build -d
```

然后打开 <http://localhost:3000>。所有应用数据都保存在 Docker 卷 `iris-data` 中。

## 本地开发

```bash
pnpm install
cp .env.example .env

# 创建/更新 ./data/iris.db
pnpm db:migrate
pnpm db:seed

# 从 argus 仓库运行抓取服务（见其 README：
# 本地开发用 ./dev.sh，或用该仓库的 docker compose up）

# 另一个终端，从仓库根目录运行
pnpm dev
```

如需接近生产环境的本地运行方式，使用 `docker compose up --build -d`；不需要 Postgres、Redis，也不再有仓库内的浏览器伴生服务——抓取由外部 argus 服务承担。

### 脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 以开发模式启动 Web 应用 |
| `pnpm build` | 构建所有包 |
| `pnpm typecheck` | 类型检查所有包 |
| `pnpm lint` | 检查所有包 |
| `pnpm db:generate` | 生成 SQLite Drizzle 迁移 |
| `pnpm db:migrate` | 应用迁移 |
| `pnpm db:seed` | 填充数据库 |
| `pnpm db:studio` | 打开 Drizzle Studio |

## 配置

复制 `.env.example` 为 `.env` 并调整。重要变量如下：

| 变量 | 说明 |
| --- | --- |
| `APP_URL` | 应用公网地址（用于魔法链接邮件） |
| `BETTER_AUTH_SECRET` | 会话签名密钥——生产环境务必覆盖（`openssl rand -base64 32`） |
| `DATABASE_PATH` | SQLite 数据库路径（默认 `./data/iris.db`；Docker 使用 `/app/data/iris.db`） |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | 用于魔法链接登录邮件的 SMTP 服务器 |
| `ARGUS_BASE_URL` | argus 服务地址——页面抓取**和**价格提取都由它承担（JSON-LD 优先，可选 LLM 兜底；默认 `http://localhost:8000`） |
| `ARGUS_API_TOKEN` | argus `/v1/*` 路由的 Bearer 令牌；必须与 argus 的 `ARGUS_API_TOKENS` 之一匹配 |
| `TELEGRAM_BOT_TOKEN` | 提醒渠道使用的 Telegram 机器人 |
| `SCHEDULER_TICK_MS` | 调度器查找到期商品的频率（默认 30 秒） |
| `ARGUS_BASE_URL` | argus 抓取服务地址（默认 `http://localhost:8000`） |
| `ARGUS_API_TOKEN` | argus `/v1/*` 路由的 Bearer 令牌；必须与 argus 的 `ARGUS_API_TOKENS` 之一匹配 |

现有 Postgres 数据不会自动迁移。切换部署前，请重新添加商品，或有计划地执行手动导出/导入。

## 特别感谢

特别感谢 [LINUX DO](https://linux.do)。

## 许可证

[MIT](LICENSE)
