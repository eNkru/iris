# Iris

Self-hosted price tracking & alert app. Add products, let Iris watch their prices, and get notified when something changes.

![Iris dashboard](docs/screenshot.png)

## Features

- **Product dashboard** — track products with current price, price history charts, and per-product status (OK / needs attention / blocked)
- **Price-drop alerts** — configurable alert rules evaluated on every price check
- **Alert channels** — Email and Telegram notifications, plus periodic summaries
- **Price extraction** — prices are extracted by the argus service: deterministic schema.org JSON-LD parsing first, with an optional LLM fallback configured on the argus side (no model runs inside Iris)
- **Anti-bot fetching** — pages are fetched through an anti-detect [Camoufox](https://camoufox.com) browser hosted by the standalone **argus** service, so pages behind DataDome / Cloudflare / Akamai challenges still work
- **Magic-link auth** — email magic-link login via better-auth, with a bootstrapped admin user
- **Scheduler** — an in-process scheduler loop with a per-product single-flight guard

## Stack

| Layer | Tech |
| --- | --- |
| Web app | Vite SPA + Hono server, React 19, React Router 7, Tailwind CSS v4, TanStack Query, Recharts |
| API | oRPC + Zod |
| Auth | better-auth (magic link, SMTP) |
| Database | SQLite + Drizzle ORM + better-sqlite3 |
| Runtime | One Node image (single Hono process) |
| Price pipeline | Argus service (anti-detect Camoufox fetch + price extraction) |
| Notifications | SMTP (nodemailer), Telegram Bot API |

## Repository layout

pnpm monorepo (pnpm ≥ 11, Node ≥ 20):

```
apps/
  web/            Vite + Hono app — UI, oRPC client, in-process scheduler entrypoint
packages/
  api/            oRPC router, procedures, middleware
  auth/           better-auth setup, SMTP magic-link mailer, admin bootstrap
  database/       SQLite Drizzle schema, migrations, queries, seed script
  prices/         price pipeline (extract via argus → alert rules), scheduler, notifications
  utils/          shared helpers and environment validation
Dockerfile        Single Node image (page fetching is external: argus)
```

## Quick start (Docker)

The recommended deployment is one container with one persistent SQLite volume. The image runs the Hono web server and scheduler as a single Node process; migrations run automatically on startup. Page fetching requires a reachable **argus** service (deployed from the argus repo) — set `ARGUS_BASE_URL` and `ARGUS_API_TOKEN` accordingly.

```bash
cp .env.example .env   # adjust secrets (BETTER_AUTH_SECRET, SMTP, ARGUS_API_TOKEN, …)
docker compose up --build -d
```

Then open <http://localhost:3000>. All application data is stored in the `iris-data` Docker volume.

## Local development

```bash
pnpm install
cp .env.example .env

# create/update ./data/iris.db
pnpm db:migrate
pnpm db:seed

# run the argus fetch service from the argus repo
# (see its README: ./dev.sh for local development,
#  or docker compose up in that repo)

# in another terminal, from the repository root
pnpm dev
```

For a production-like local run, use `docker compose up --build -d`; no Postgres, Redis, or in-repo browser sidecar is required — argus is the external fetch service.

### Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the web app in dev mode |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Typecheck all packages |
| `pnpm lint` | Lint all packages |
| `pnpm db:generate` | Generate SQLite Drizzle migrations |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` | Seed the database |
| `pnpm db:studio` | Open Drizzle Studio |

## Configuration

Copy `.env.example` to `.env` and adjust. The important ones:

| Variable | Description |
| --- | --- |
| `APP_URL` | Public URL of the app (used in magic-link emails) |
| `BETTER_AUTH_SECRET` | Session signing secret — always override in production (`openssl rand -base64 32`) |
| `DATABASE_PATH` | SQLite database path (default `./data/iris.db`; Docker uses `/app/data/iris.db`) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | SMTP server for magic-link login emails |
| `ARGUS_BASE_URL` | URL of the argus service, which owns page fetching **and** price extraction (JSON-LD first, optional LLM fallback; default `http://localhost:8000`) |
| `ARGUS_API_TOKEN` | Bearer token for argus `/v1/*` routes; must match one of argus's `ARGUS_API_TOKENS` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot for the alert channel |
| `SCHEDULER_TICK_MS` | How often the scheduler looks for due products (default 30 s) |

Existing Postgres data is not migrated automatically. Re-add tracked products or perform a deliberate manual export/import before switching deployments.

## Special Thanks

Special thanks to [LINUX DO](https://linux.do).

## License

[GPL-3.0](LICENSE)
