# Iris on a QNAP NAS — build & deploy guide

Single all-in-one container (Hono server + scheduler) on a QNAP running
Container Station. Page fetching runs in the external **argus** service
(deployed from the argus repo — on the same NAS or any reachable host).
All persistent data and configuration live in one shared folder on the NAS
**outside** the container, so recreating the container or updating the image
never wipes anything.

The image is a multi-stage build: compilers stay in the builder stage, the
runner is `node:22-slim` and runs as the non-root `node` user (uid 1000).

## What you need

- QNAP NAS running Container Station (x86_64 model; most QNAPs are).
- SSH enabled on the NAS (Control Panel → Telnet/SSH) so you can run `docker` CLI.
- A Mac/PC with Docker. Your Docker daemon must produce `linux/amd64` images —
  the same target as an x86_64 NAS (no cross-compilation needed). On Apple
  Silicon, pass `--platform linux/amd64`.
- A reachable argus service with an API token (see the argus repo's deploy
  docs); iris needs `ARGUS_BASE_URL` + `ARGUS_API_TOKEN`.

Do **not** copy the repo-root `docker-compose.yml` onto the NAS as-is. That
file is for local `docker compose up --build`: it builds from source and uses
a named `iris-data` volume. The NAS compose below pins a pre-built tag and
bind-mounts `./data`.

## 1. Build the image on your computer

```bash
# from the Iris repository root
docker build -t iris:1.0.0 .
```

On Apple Silicon, force the NAS architecture:

```bash
docker build --platform linux/amd64 -t iris:1.0.0 .
```

No build args are required. `DATABASE_PATH` defaults to the container contract
`/app/data/iris.db`. `ARGUS_BASE_URL` has a build-time default that `.env`
overrides at runtime. `ARGUS_API_TOKEN` is **not** baked into the image — it
must be supplied at runtime or the process fails env validation at boot.

Verify the platform before shipping it to the NAS:

```bash
docker image inspect iris:1.0.0 --format '{{.Os}}/{{.Architecture}}'
# expect: linux/amd64 (or linux/arm64 if you run an ARM QNAP)
```

## 2. Save and transfer the image

```bash
# create a single-file archive (gzipped is roughly half the size)
docker save iris:1.0.0 | gzip > ~/iris-1.0.0.tar.gz

# copy it to your NAS (use your NAS IP/hostname and an existing shared folder)
scp ~/iris-1.0.0.tar.gz admin@my-nas:/share/Container/iris/
```

gzip it; LAN transfer can still take a while. Alternatively push to a registry
(Docker Hub / GHCR) and `docker pull` on the NAS — especially handy for
re-deploys.

## 3. Set up the folder layout on the NAS

Create one shared folder, e.g. `/share/Container/iris/`. Docker will bind-mount
host folders inside the container, so your database and config survive any
container recreate:

```
/share/Container/iris/
├── docker-compose.yml   # pinned to iris:1.0.0, bind-mounts ./data and ./.env
├── .env                 # real secrets (never committed)
└── data/                # SQLite db + WAL files live here (auto-created)
```

### docker-compose.yml (NAS only — do not reuse the repo file)

Use `./data` and `./.env` relative to this file — a **bind mount**, not a named
volume, so the files stay visible and outlive container/volume removal.
`extra_hosts` lets the container reach argus on the same NAS via
`host.docker.internal` (Linux / QNAP does not provide that name by default):

```yaml
services:
  app:
    image: iris:1.0.0          # or your registry tag
    restart: unless-stopped
    extra_hosts:
      - "host.docker.internal:host-gateway"
    env_file: ./.env           # config stays on the NAS, outside the image
    environment:
      # Pin the absolute container path. `env_file` alone is not enough:
      # if your NAS `.env` copied the `.env.example` default
      # `DATABASE_PATH=./data/iris.db` (relative), `drizzle-kit migrate`
      # would resolve it relative to /app/packages/database and crash with
      # "Cannot open database because the directory does not exist". compose
      # `environment:` wins over `env_file:`, so this guarantees the DB lands
      # on the bind-mounted NAS folder. Leave this override in place even if
      # your `.env` also sets it.
      DATABASE_PATH: /app/data/iris.db
      # Cap Node's V8 heap. The server is a single Node process (Hono +
      # scheduler); 256 MB of heap is plenty for SQLite + the in-process
      # scheduler, and bounds memory if a scrape loop runs away.
      NODE_OPTIONS: "--max-old-space-size=256"
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data       # SQLite data -> NAS folder, wiped never
    # Lightweight resource ceiling so iris can't starve the NAS (or argus
    # if it shares the host). 384 MB is a comfortable ceiling for a single
    # Node process + SQLite; the scheduler holds no heavy state in memory.
    mem_limit: 384m
    mem_reservation: 128m
    pids_limit: 100
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:3000/api/rpc/health/check >/dev/null || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 60s
```

If argus is on the same NAS, set `ARGUS_BASE_URL=http://host.docker.internal:<argus-port>`
in `.env`. If argus is on another host, use that host's URL instead — you can
leave `extra_hosts` in place either way.

## 4. Create `.env` next to the compose file

Copy from `.env.example` (repo root) and fill in real values, especially:

```env
NODE_ENV=production
APP_URL=https://iris.my-qnap.local     # or your URL; used in magic-link emails
BETTER_AUTH_SECRET=<openssl rand -base64 32>   # MUST be set in production
# In the Docker image the DB must be at the absolute container path below
# (it is overridden again in docker-compose.yml `environment:` to be safe).
# Do NOT use the `.env.example` default ./data/iris.db here.
DATABASE_PATH=/app/data/iris.db
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=noreply@yourdomain
TELEGRAM_BOT_TOKEN=
SCHEDULER_TICK_MS=30000
ARGUS_BASE_URL=http://host.docker.internal:8000
ARGUS_API_TOKEN=<token matching argus ARGUS_API_TOKENS>
```

`DATABASE_PATH` must point at the mounted dir `/app/data/iris.db`. Do NOT set
`DATABASE_PATH` to a value outside `/app/data`, or the DB lives in container
scratch space and is lost on recreate. (The migrate step resolves the path to
absolute and creates its parent dir, so a relative value no longer crashes
boot — but an absolute `/app/data/iris.db` is still required for the DB to
land on the bind-mounted NAS folder.)

A missing `ARGUS_API_TOKEN` or `BETTER_AUTH_SECRET` fails at boot (env
validation), not later as a confusing argus 401.

## 5. Load the image and start

```bash
ssh admin@my-nas
cd /share/Container/iris

# load the image into the local Docker store (do this inside the NAS shell)
docker load -i /share/Container/iris/iris-1.0.0.tar.gz

# validate
docker images | grep iris

# start
docker compose up -d
docker compose logs -f app
```

Open `http://<NAS-IP>:3000` and log in (first run creates the bootstrap admin
from the SMTP-mailed magic link).

## Reinstalling — wipe the old app and start fresh

If an existing iris install is broken or you just want to start over (this
**deletes all tracked products and history** — config in `.env` is kept), wipe
the container, the old image, and the `data/` folder, then redeploy from a
clean image:

```bash
ssh admin@my-nas
cd /share/Container/iris

# 1. stop and remove the running container (and its anonymous resources)
docker compose down

# 2. remove the old image(s) so Docker can't reuse a stale one
#    list first to see what you have, then remove by image id or repo:tag
docker images | grep iris
docker rmi iris:1.0.0        # repeat for any old tags

# 3. wipe the on-NAS data dir — the SQLite db + WAL files
#    (the entrypoint recreates an empty db on next boot)
rm -rf data/

# 4. (optional) reclaim any leftover anonymous volumes from the old container
docker volume prune -f
```

Now build and ship the fresh image from your computer (steps 1–2 above), then
on the NAS:

```bash
cd /share/Container/iris
# edit docker-compose.yml -> image: iris:1.0.0 (the new tag)
docker load -i iris-1.0.0.tar.gz
docker compose up -d
docker compose logs -f app
```

The entrypoint runs the bundled standalone migrator (no `pnpm`/`drizzle-kit`
in the image — it ships only `better-sqlite3` + the migration `.sql` files)
against the empty bind-mounted `data/`, creating a fresh `iris.db` and
applying all migrations from scratch. Open `http://<NAS-IP>:3000` and
complete the magic-link admin bootstrap again.

## Notes / gotchas

- **Bind mounts, not named volumes**: named volume data lives in the Docker
  graph and is easy to lose track of; bind mounts let you see, back up, and
  keep your DB on the NAS filesystem, and survive `docker compose down`.
  The `iris-data` volume in the repo's local `docker-compose.yml` is replaced
  by the `./data` bind mount here.
- **`data/` must be writable by uid 1000**: the image runs as `USER node`.
  If migrations fail with `EACCES` on `/app/data`, `chown -R 1000:1000 data`
  on the NAS folder (or match whatever uid `node` has in the image).
- **Image size**: the runner is multi-stage and ships ONLY the SPA, the
  bundled `server.cjs`, a tiny standalone `migrate.cjs`, the drizzle
  migration `.sql` files, and the `better-sqlite3` native addon — no pnpm,
  drizzle-kit, esbuild, tsx, typescript, or any dev deps. Final image is
  ~250 MB (most of which is the `node:22-slim` base itself); gzipped for
  transfer it's far smaller.
- **Runtime footprint**: iris is a single Node process (Hono web server +
  in-process scheduler). Page fetching + price extraction run in the
  external argus service, so iris itself is light — the compose caps it at
  384 MB memory / 100 pids and 256 MB of V8 heap (`NODE_OPTIONS`). If you
  also run argus on the same NAS, leave headroom for argus (it carries the
  Camoufox browser, so it is the heavier of the two).
- **First boot**: the entrypoint runs the standalone migrator (idempotent)
  then starts the web server immediately — iris does not wait for argus;
  scrapes retry once argus is reachable.
- **CPU architecture**: QNAPs are x86_64 or arm64. Build to match. The
  Camoufox browser now lives in the argus service; verification matrix for
  the pinned build is stored in the Trellis task `08-08-single-docker-image`.
- **Backups**: the whole `data/` dir is one file (`iris.db`) + WAL — just
  snapshot that folder while the container is stopped, or use QNAP's snapshot.
