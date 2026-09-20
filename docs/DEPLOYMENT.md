# Household Budget Tracker — Production Deployment Guide

Audience: the operator of the household's private server. This guide covers
first boot, secret handling, DNS, TLS, data ownership, admin CLI, upgrades and
rollback. Actual host/device/network acceptance checks (Release checklist at
the bottom) must be performed by the operator with real inputs; this document
never substitutes for them.

This stack is private by design:

- No public registration, no public reverse proxy, no Tailscale Funnel.
- No router NAT/port-forwarding to Budget; no public port 80/443 exposure.
- Internal TLS via Caddy (`tls internal`); clients must trust Caddy's root CA.

## 1. Software requirements

- Docker Compose v2 (`docker compose version`) on the server's OS.
- Python 3.13+ on the host **only** for the backup/restore scripts
  (`scripts/backup.py`, `scripts/restore.py`) — see `docs/BACKUP_RESTORE.md`.
- No other runtime dependencies; the app and proxy run as two containers.

## 2. Configuration (.env)

Copy `.env.example` next to `docker-compose.yml` and set every value (fail-closed:

missing variables refuse to start the stack).

| Variable | Meaning | Production rule |
|---|---|---|
| `APP_ENV` | selects validation level | `production` |
| `DATABASE_URL` | SQLite path inside the backend container | `sqlite:////app/data/budget.db` (POSIX-absolute) |
| `SESSION_SECRET` | signs session/CSRF cookies | ≥ 32 chars, ≥ 8 unique chars, not a repeating pattern; generate with the command below |
| `SESSION_MAX_AGE_DAYS` | login lifetime in days | 1–30 |
| `ALLOWED_ORIGINS` | exact HTTPS origin(s) the SPA is served from | exact origin, HTTPS, no path/query/fragment/credentials/wildcard; hostname must appear in `TRUSTED_HOSTS` |
| `TRUSTED_HOSTS` | exact hostnames the backend accepts as `Host:` | comma-separated exact hostnames; no wildcards, no URLs, no loopback; first entry drives the internal health probe |
| `SECURE_COOKIES` | Secure flag on session/CSRF cookies | `true` in production |
| `BUDGET_HOST` | hostname Caddy serves the SPA and API under | must match a `TRUSTED_HOSTS` entry and an `ALLOWED_ORIGINS` hostname |
| `HTTPS_BIND_ADDRESS` | host address(es) Caddy publishes HTTPS on | intended LAN/tailnet address, never `0.0.0.0` for convenience |
| `HTTPS_PORT` | host port for HTTPS | 443 ideal; any free private port works |

Generate the session secret on the server:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Store `.env` with restrictive permissions (`chmod 600 .env` on Linux; on
Windows, restrict via NTFS ACLs). Never commit it. Rotating the secret alone
does **not** log users out — a restore or rotation must be paired with session
revocation (see `docs/BACKUP_RESTORE.md`).

Example production-shaped values (private LAN + Tailscale on one host):

```text
APP_ENV=production
DATABASE_URL=sqlite:////app/data/budget.db
SESSION_SECRET=<token_urlsafe(48) output>
SESSION_MAX_AGE_DAYS=30
ALLOWED_ORIGINS=https://budget.home.internal
TRUSTED_HOSTS=budget.home.internal
SECURE_COOKIES=true
BUDGET_HOST=budget.home.internal
HTTPS_BIND_ADDRESS=192.168.1.10,100.90.50.6
HTTPS_PORT=443
```

Compose publishes HTTPS on one binding; if you list a comma-separated set of
addresses, verify with `docker compose port` (§5) that every resolved mapping is
intended. Never rely on `0.0.0.0` here for convenience.

## 3. Data and ownership

- The bind mount `./data:/app/data` holds the SQLite database and is the only
  path the backend container may write. Prep ownership **before the first
  start** — a build-time `chown` never changes a host bind mount:
  `sudo chown -R 10001:10001 ./data && sudo chmod 700 ./data`
- Every other application file (code, migrations, CLI) stays root-owned and
  read-only to the runtime user (UID 10001).
- Backups must be stored **outside** the static web content and configured with
  restrictive permissions; see `docs/BACKUP_RESTORE.md`.
- Caddy CA/private state lives in the `caddy_data` / `caddy_config` volumes.
  Never copy the CA private key off-host; distribute only the **public** root
  certificate (§6).

## 4. First boot

```bash
docker compose build
docker compose up -d
docker compose ps           # backend must reach "Up (healthy)"
docker compose logs backend # one-shot: alembic upgrade head, then uvicorn
```

The container entrypoint applies migrations (`alembic upgrade head`) before
uvicorn starts; the Compose healthcheck then probes `127.0.0.1:8000` while
sending the configured trusted `Host:` header — it never weakens host
validation. Migration head for this milestone is `0005_budgets`; verify with:

```bash
docker compose exec backend python - <<'EOF'
from alembic.config import Config
from alembic.script import ScriptDirectory
c = Config("alembic.ini")
c.set_main_option("script_location", "migrations")
print("head:", ScriptDirectory.from_config(c).get_current_head())
EOF
```

## 5. Binding verification (easy to get wrong)

Confirm the resolved host port list matches intent — Compose occasionally
merges/retains bindings you did not expect:

```bash
docker compose port caddy 443
docker compose port backend 8000   # MUST error: backend is expose-only
```

Only Caddy's HTTPS port may appear. Backend 8000 is container-internal; if
`docker compose port backend 8000` prints an address, the stack layout changed
without review.

## 6. Trusting the Caddy root certificate

Copy the public root CA out **once**:

```bash
docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt > caddy-root.crt
```

Install on client OSes (all are one-time, manual steps):

- Windows: run `certutil -addstore -user Root caddy-root.crt` (per-user store).
- macOS: import into Keychain → mark as **Always Trust** → apply to TLS.
- iOS/iPadOS/Android: profile download / user certificate store.
- Linux: distribute into `/usr/local/share/ca-certificates/` and run
  `update-ca-certificates`.

Verify in the browser: the Budget hostname loads with a padlock and **no**
override screen. If you ever see a certificate warning, fix trust — do not
click through it. Rotate + re-distribute the root certificate when Caddy's
internal CA is re-created (fresh `caddy_data` volume).

HSTS remains **off** until hostname + certificate trust is verified on every
household client; then enable staged: first `max-age=86400`, and only after a
full validation period raise to `max-age=31536000` (never
`includeSubDomains`/`preload` in a private deployment). Record the current
stage in the release checklist.

## 7. Admin CLI (bootstrap, members, resets)

Run inside the backend container; passwords are prompted with confirmation:

```bash
docker compose exec -i backend python -m app.cli init-household
docker compose exec -i backend python -m app.cli create-user
docker compose exec -i backend python -m app.cli reset-password
docker compose exec -i backend python -m app.cli cleanup-sessions
```

Prompts, in order: household name; username; display name; password +
confirmation; default-categories choice (yes/no). Feed each answer on its own
line via `stdin` (the example above pipes interactively with
`docker compose exec -i`; use `docker exec -i` in scripts).

`init-household` is run once; `create-user` adds members of the same
household; `reset-password` is the operator's break-glass path — it replaces
the hash and revokes only that user's sessions; the user must re-login.
`cleanup-sessions` drops expired rows.

## 8. Day-2 operations

| Operation | Commands |
|---|---|
| Stop | `docker compose down` (keeps volumes; DB survives) |
| Start | `docker compose up -d` |
| Upgrade | see Upgrading below |
| Rollback | `git checkout <previous tag> && docker compose build && docker compose up -d` — schema rollbacks are **not** automatic; run a fresh **verified backup first** and check whether the previous release migrates safely (Alembic downgrades were not authored for this app: restoring a pre-upgrade snapshot from `scripts/backup.py` is the supported rollback path). |

### Upgrading

1. **Back up before any migration:** run `python scripts/backup.py --database
   <host-data>/budget.db --destination <backup-dir>` from the host (WAL-safe;
   see `docs/BACKUP_RESTORE.md`).
2. `docker compose build`
3. `docker compose up -d` (`alembic upgrade head` runs at container start).
4. `docker compose ps` → backend healthy; `curl -sk
   https://<host>/api/health` returns `{"status":"ok"}`.

If a migration fails mid-upgrade: `docker compose stop backend`, restore the
just-created backup into the offline data path per `docs/BACKUP_RESTORE.md`,
then re-attempt only with the corrected release.

## 9. Network reachability model

- The application is meant to be reachable **only** from the LAN subnet and
  the tailnet (`100.64.0.0/10`-style) — never from the public internet.
- IPv6 and IPv4 both matter: absence of an AAAA record does not prove IPv6
  unreachability; verify the firewall applies to both families' forwarding
  paths (Linux Docker publishing bypasses plain `ufw INPUT` chains; check the
  Docker/packet-filtering backend actually in use on the server).
- Tailscale Grants are **additive**: budget must be one explicit grant; audit
  the existing policy for anything broader. See
  `docs/tailscale-policy.example.json` and its merge instructions.
- Behind Caddy, all clients share one source IP to the backend; the login
  rate limiter buckets that shared socket IP. User-specific buckets remain
  separate. Fine-grained per-client proxy tuning is explicitly out of scope.

## 10. Health / response headers inventory

These headers must be observed on the live deployment (already enforced in
`Caddyfile` / `backend/app/main.py`):

- Every `/api` response, errors included: `Cache-Control: private, no-store`;
  SPA (non-API) responses do not carry it so static caching is still possible.
- Global HTTP headers on all Caddy responses: the static CSP
  (`script-src 'self'`, style `'unsafe-inline'`, no `unsafe-eval`, no nonce
  service), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- `/openapi.json`, `/docs`, `/redoc`: disabled in production (404s).
- Cookies: `budget_session` HttpOnly + Secure + SameSite=Lax; the CSRF cookie
  is Secure and SameSite=Lax (not HttpOnly) by design.

## 11. Release checklist

The release record must link **each row** to a concrete command, observed
result, and evidence (date + command + result). Rows left unchecked keep the
milestone at *release candidate — deployment gates pending*, not *MVP
complete*.

| # | Required evidence | How to check |
|---|---|---|
| 1 | M6 suites + full-household workflow pass | `python -m pytest` (backend); `npm test -- --watch=false`; `npx playwright test` |
| 2 | Production Compose healthy; migration no-op on existing DB; container recreate keeps data | `docker compose ps`; alembic head `0005_budgets`; §8 |
| 3 | Live WAL backup + offline restore succeed; restored sessions denied | `docs/BACKUP_RESTORE.md` drill; fresh-browser 401 proof |
| 4 | Daily host scheduler and permissions verified | systemd timer/cron installed, log path configured, retention 30 days |
| 5 | Allowed LAN device: trusted TLS, app login required | smartphone/laptop via LAN, browser padlock, forced login |
| 6 | Allowed Tailscale device away from LAN: trusted TLS, login required | same via tailnet |
| 7 | Emby-only identity denied for Budget TCP/443 while Emby still works | Grants test block + manual device check |
| 8 | Public IPv4/IPv6 paths: no Budget connection; no port forwarding/Funnel | external vantage + router policy review |
| 9 | Backend 8000 not published nor reachable from LAN/tailnet/public paths | `docker compose port backend 8000` errors; external probes fail |
| 10 | Trusted TLS + correct cookie flags + CSP/headers working; HSTS status recorded | browser devtools against real host |
| 11 | Source §§42–43 + settings/accessibility coverage | link each checklist item to its test/result |

**Boundary:** completing this checklist requires the real server, real
devices, real DNS and tailnet access. Gate any claim of production readiness
on rows 1–11, not on local-only verification.

## 12. Reachable disposable verification

On 2026-09-20, a generated isolated Compose directory exercised the production
shape without touching the repository's `data/`, `.env`, named volumes, or
real network policy. Primary and recovery projects used `APP_ENV=production`,
generated secrets, `lvh.me`, Caddy internal TLS, separate database mounts, and
loopback-only HTTPS bindings on ports `8443` and `8444`.

- Both backend services reached `Up (healthy)`; Caddy was the only published
  service and backend `8000` had no host mapping.
- `curl --insecure --resolve lvh.me:8443:127.0.0.1 https://lvh.me:8443/api/health`
  returned `200` with `{"status":"ok"}` and the private/no-store, CSP,
  nosniff, Referrer-Policy and Permissions-Policy headers.
- `/openapi.json`, `/docs`, `/redoc`, and an unknown API path returned `404`;
  the unknown API response retained the JSON error envelope rather than the
  Angular index.
- Recreating both services without removing their data mounts preserved the
  migrated database and seeded values. The browser and recovery results are
  recorded in `README.md`, `state.md`, and `docs/BACKUP_RESTORE.md`.

This is disposable local evidence only. Real hostname/certificate trust,
LAN/Tailscale reachability, firewall/IPv4/IPv6 denial, Emby-only denial,
HSTS, scheduler permissions and production backup/restore remain unchecked in
the release checklist above.
