# Household Budget Tracker — Production Deployment Guide

Audience: the operator of the household's private server. This guide covers
first boot, secret handling, DNS, TLS, data ownership, admin CLI, upgrades and
rollback. Actual host/device/network acceptance checks (Release checklist at
the bottom) must be performed by the operator with real inputs; this document
never substitutes for them.

> **Release hold — readiness review, 2026-09-20:** M6 has open implementation
> defects as well as unverified deployment gates. See §13 for the findings,
> evidence and closure criteria. The corrected examples below still do not
> close §13 or substitute for real-host, device, scheduler and network checks.

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
| `HTTPS_BIND_ADDRESS` | the single host address Caddy publishes HTTPS on | intended LAN or tailnet address, never `0.0.0.0` for convenience |
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
HTTPS_BIND_ADDRESS=192.168.1.10
HTTPS_PORT=443
```

Use one address per Compose port mapping. Do not comma-separate
`HTTPS_BIND_ADDRESS`: the root Compose file interpolates it into one mapping,
and a comma-separated value is not an IP address.

For more than one interface, use a Compose v2.24.4+ override with the
`!override` tag so the base port list is replaced rather than merged:

```yaml
# docker-compose.multi-bind.yml
services:
  caddy:
    ports: !override
      - "192.168.1.10:443:443"
      - "100.90.50.6:443:443"
```

Render and inspect the result before starting; it must contain exactly those
two host mappings and no stale base mapping:

```text
docker compose -f docker-compose.yml -f docker-compose.multi-bind.yml config
docker compose -f docker-compose.yml -f docker-compose.multi-bind.yml port caddy 443
```

On older Compose versions, use one address or upgrade before attempting this
override. Never layer a plain `ports:` list over the base file because Compose
can retain the base mapping as well. Never rely on `0.0.0.0` for convenience.

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
  the existing policy for anything broader. The example is a syntax-validated
  fragment, not an applied policy; review the complete tailnet policy before
  merging it. See `docs/tailscale-policy.example.json`.
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
milestone at *release candidate — repository fixes recorded, deployment gates
pending*, not *MVP complete*. The §13 findings are closed at repository level
(2026-09-21) with named test/probe evidence; the host-gated rows in §11 and the
residual platform items recorded in §13 still require the real environment.

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

## 13. Findings from MVP readiness review — 2026-09-20 (repository-level corrections recorded 2026-09-21; release acceptance open)

**Status:** repository-level corrective checks for all 11 findings were
recorded on 2026-09-21 and are marked `[x]` below with the test or probe that
proves each one. Repository-level closure is **not** release acceptance:
POSIX/Windows host behavior, the real recovery drill, the scheduler and the
§11 network/device rows remain open, and the MVP is not accepted until §11
passes and the user completes release review. Findings the original review
runtime-reproduced are labeled as such; source-reviewed inference and
platform-gated cases are named explicitly in each closure line. Earlier
statements in `state.md` and the milestone handoffs that only external
deployment gates remained overstated completion; this correction pass replaces
them with the implementation, local-evidence and actual-host distinctions
recorded below.

### Verification performed during the original review

- `cd backend && python -m pytest`: **286 passed, 244 deprecation warnings**.
- `cd frontend && npm test -- --watch=false`: **13 files / 71 tests passed**.
- `cd frontend && npm run build`: **passed**.
- `cd frontend && npx playwright test`: **16 passed**, including desktop/mobile
  household workflows against a disposable real backend.
- Inspected fresh populated dashboard screenshots at 1280px and 390px.
- Ran additional disposable Python/Compose probes and authenticated browser
  checks described below. No real financial data, production stack or network
  policy was modified. The assessment databases and services were removed.
- Did not repeat the earlier production-shaped Compose recovery drill or
  perform any actual-host/device acceptance checks.

### Correction-pass evidence and remaining gates

- Frontend correction work: `npm test -- --watch=false` — **13 files /
  77 tests passed**; production build — **passed**; full Playwright —
  **16 passed**. The changed-path disposable smoke passed at both 390px and
  1280px (the smoke screenshots were disposable and are not retained).
- Recovery/deployment documentation correction: Compose rendering proved the
  required recovery data path fails closed when omitted, resolves away from
  production `data/`, keeps backend 8000 unpublished, uses recovery Caddy
  volumes, and renders the explicit loopback recovery port. The `!override`
  multi-bind example rendered exactly two host mappings without retaining the
  base mapping.
- Backup/restore implementation corrections are present, including completed
  snapshot schema/FK checks, corrupt-target abort, ownership-preserve-or-abort,
  non-regular sidecar refusal, checkpoint/directory flushing and retained
  rollback artifacts. Backend correction evidence:
  `cd backend && python -m pytest -q` — **303 passed, 5 skipped** (the skips
  are POSIX-only symlink/ownership/mode guards on this Windows host; their
  real-host proof remains §11 work).
- POSIX ownership/symlink/durability, Windows ACL, real recovery, scheduler,
  client trust and network checks remain actual-environment gates; §11 is not
  accepted.

### Recovery, production validation and operator instructions

1. **[x] Recovery instructions do not isolate production data — release blocker.**
   `BACKUP_RESTORE.md`, “Recovery stack (separate from production)”, changes the
   Compose project name but uses `docker-compose.yml` with its hardcoded
   `./data:/app/data` bind mount. A read-only `docker compose ... -p
   budget-recovery config --format json` probe resolved that same checkout data
   directory, not an isolated recovery directory. The example also starts the
   backend before its purported offline migration step.
   **Close when:** the documented drill resolves to explicitly separate data
   mounts and performs restore/migration before starting the recovery backend.
   **Repository-level closure recorded 2026-09-21.** `docker-compose.recovery.yml`
   binds `${RECOVERY_DATA_DIR:?}` (omitting it fails Compose with exit 1) and render
   inspection showed the backend mount resolves to the recovery directory, never the
   checkout `data/`; `BACKUP_RESTORE.md` orders render → stop/verify → restore →
   one-shot `alembic upgrade head`/`current` → `up -d`. Remaining host-gated item: an
   actual recovery run with host ownership/ACL proof (§11).

2. **[x] Restore accepts source/target aliases — reproduced release blocker.**
   In `scripts/restore.py`, using the same disposable database for `--backup`
   and `--database` returned success, changed the source snapshot's hash and
   removed its sessions. Path resolution also follows symlinks rather than
   rejecting unsafe targets.
   **Close when:** identical paths, filesystem aliases and symlink targets are
   rejected before modification, with source snapshot bytes preserved.
   **Repository-level closure recorded 2026-09-21.**
   `test_restore_rejects_identical_paths` and `test_restore_rejects_aliased_paths`
   (runnable and passing on this Windows host) prove refusal before modification with
   the source snapshot's bytes and sessions preserved; the POSIX symlink case is
   covered by `test_restore_rejects_symlink_target`, which skips here and remains an
   §11 host row.

3. **[x] Restore staging and preservation violate the approved safety contract.**
   Source review of `scripts/restore.py` found system-temp staging rather than
   target-filesystem staging; non-private shared staging-directory creation;
   permissions tightened only after publication; no target UID/GID preservation;
   second-resolution pre-restore names published with overwrite-capable
   `os.replace`; a raw-copy fallback for corrupt targets instead of a safe
   abort; and no explicit file/directory flush step where supported.
   **[INFERENCE]:** separate filesystems can make replacement fail, POSIX
   staging may expose sensitive data, root-run restoration can leave the
   service unable to open its database, and same-second preservation can
   overwrite a prior recovery file. These platform/collision cases were not
   runtime-reproduced in this review.
   **Close when:** restore meets the approved M6 plan §2.4 requirements for
   private same-filesystem staging, ownership, unique verified preservation,
   corrupt-target refusal and durable publication. Manual post-restore `chown`
   is not equivalent to the approved preserve-or-abort behavior.
   **Repository-level closure recorded 2026-09-21.** `scripts/restore.py` now stages
   private same-filesystem copies, publishes unique no-clobber preserves, aborts on
   corrupt targets, preserves-or-aborts on ownership/mode, refuses non-regular
   sidecars, checkpoints the offline target, flushes files/directories and retains a
   named recovery directory on rollback or cleanup failure. Covered by
   `test_restore_stages_privately_on_target_filesystem`,
   `test_restore_preservation_names_unique_same_second`,
   `test_restore_corrupt_target_aborts_without_replacement`,
   `test_restore_post_publication_cleanup_failure_names_retained_dir` and the sidecar
   parking/rollback regressions; `test_restore_preserves_target_mode_and_owner` and
   the dangling-path case skip on Windows and remain §11 host rows.

4. **[x] Backup verification and bounded execution are incomplete.**
   A disposable database containing only `alembic_version=0005_budgets` was
   successfully published by `scripts/backup.py`. Source review also found that
   foreign keys are checked on an earlier source connection, not the completed
   snapshot; required Budget tables are not verified; source/path safety checks
   are incomplete; the SQL progress handler does not bound the backup API's
   busy/retry duration; and explicit publication flushing is absent.
   **Close when:** the completed standalone snapshot passes integrity,
   foreign-key and required-schema checks; unsafe paths are rejected; busy
   backup execution has an actual deadline; publication follows plan §2.4.
   Correct the guide's claim that staged foreign-key validation already occurs.
   **Repository-level closure recorded 2026-09-21.**
   `test_backup_rejects_revision_only_database` and
   `test_backup_rejects_missing_required_table` prove the completed snapshot is
   validated for required schema, integrity and foreign keys, so the guide's
   staged-validation claim now matches `_verify_snapshot`;
   `test_backup_wall_clock_deadline_interrupts_copy` proves the backup API callback
   enforces the wall-clock bound, and publication flushes file and directory.
   Source/destination symlink refusal skips on Windows
   (`test_backup_rejects_symlink_source`/`_destination`) and remains an §11 host row.

5. **[x] Production trusted-host validation accepts wildcard patterns — reproduced.**
   `Settings` in `backend/app/config.py` accepted
   `budget.example.internal,*.example.internal` with the matching exact HTTPS
   origin. `_is_exact_trusted_host` rejects bare `*`, but not the extra pattern.
   **Close when:** all wildcard patterns are rejected even when a separate
   exact host satisfies origin matching; preserve this case in validation.
   **Repository-level closure recorded 2026-09-21.**
   `test_production_rejects_invalid_trusted_hosts` now includes the reproduced mixed
   rows (`["budget.example.internal", "*.example.internal"]` and
   `["budget.example.internal", "*"]`) and passes with `_is_exact_trusted_host`
   rejecting any `*`; the full `tests/test_config.py` suite is 38 passed. No
   host-gated residual.

6. **[x] The documented multi-interface binding is invalid — reproduced.**
   The §2 value `HTTPS_BIND_ADDRESS=192.168.1.10,100.90.50.6` is interpolated
   into a single Compose port mapping. `docker compose config --quiet` failed
   with `invalid IP address: 192.168.1.10,100.90.50.6`.
   **Close when:** the guide uses one address per explicit port mapping and
   verifies the resolved mappings. A comma-separated environment value does
   not create multiple bindings.
   **Repository-level closure recorded 2026-09-21.** The guide uses one address per
   mapping and a `!override` multi-bind example documented as Compose v2.24.4+ (the
   first version that replaces instead of merging); render inspection produced exactly
   the two host mappings with no retained base mapping. Actual host
   binding/firewall checks remain §11 gates.

7. **[x] The Tailscale policy example reverses host-alias syntax.**
   `tailscale-policy.example.json` maps `"100.64.0.0/10": "tailnet"`.
   [Tailscale's hosts syntax](https://tailscale.com/docs/reference/syntax/policy-file#hosts)
   requires alias name → IP/CIDR.
   **Close when:** correct or remove the unused alias and validate the example.
   Applying policy still requires review of the complete existing additive
   Grants/ACL policy; correcting this file does not prove Emby isolation.
   **Repository-level closure recorded 2026-09-21.** The reversed alias is removed;
   the file parses as JSON and matches the reviewed
   groups/tagOwners/grants/tests shape. The example was not applied, and
   complete-policy review plus Emby isolation remain open-policy/§11 work.

### Settings and CSV acceptance gaps

8. **[x] Password validation silently blocks submission — browser-reproduced.**
   Matching short new/confirmation passwords leave the form invalid with empty
   feedback. In `frontend/src/app/features/settings/settings.page.html`, the
   new-password input references a nonexistent `new-password-error`; local
   current/new-password hints are not rendered.
   **Close when:** required/length errors identify and are associated with the
   relevant inputs, including a missing or short current password.
   **Repository-level closure recorded 2026-09-21.** `settings.page.spec.ts` asserts
   aria-invalid, aria-describedby and the rendered required/length messages for the
   current and new password inputs with no request sent; the disposable 390px/1280px
   browser smoke reproduced the original short-password submit and confirmed the
   associated errors. Release acceptance remains an §11/user-review step.

9. **[x] Successful profile save has no success announcement — browser-reproduced.**
   The display name and household member name updated, but the profile status
   live region remained empty. `settings.page.ts` sets no success feedback.
   **Close when:** successful persistence produces the announced confirmation
   required by the approved M6 profile contract.
   **Repository-level closure recorded 2026-09-21.** The profile status element
   (`#profile-status`, role=status, aria-live=polite) carries the confirmation and is
   reset at each attempt; the spec asserts both, and the 390px/1280px smoke confirmed
   the announced text after a real save. Release acceptance remains an
   §11/user-review step.

10. **[x] CSV API error Blobs lose field explanations — browser-reproduced.**
    A real export request with `from=10000-01-01` returned HTTP 422 with a
    `fields.from` explanation. The UI displayed only “Could not download the
    CSV.” `settings.service.ts` requests a Blob; `settings.page.ts` treats its
    error body as an already-decoded JSON object. Export controls also lack
    associations with field feedback.
    **Close when:** decode the shared JSON error envelope from the Blob and
    present associated field errors without downloading an error response.
    **Repository-level closure recorded 2026-09-21.** The service decodes the
    `{error:{message,fields}}` envelope from Blob bodies; the spec flushes a real JSON
    Blob with status 422 and asserts the server message, the `from` explanation,
    associated `#export-*-error` paragraphs, and that download stays pending until
    decoding finishes; the browser smoke reproduced the original
    `from=10000-01-01` 422 with no download. Release acceptance remains an
    §11/user-review step.

11. **[x] Date-only export disappears after selector lookup failure — browser-reproduced.**
    With an injected account-lookup HTTP failure against the disposable app,
    both date inputs disappeared while unfiltered Download remained enabled.
    `settings.page.html` places the date controls inside the selectors' ready
    branch, contrary to the independent date-only export contract.
    **Close when:** date-only and unfiltered export remain usable when account
    or category lookups fail.
    **Repository-level closure recorded 2026-09-21.** Date inputs render outside the
    selector branch; the spec asserts date-only export with `from` set and no
    `accountId` after the accounts lookup fails (and unfiltered export while selectors
    are still loading), with stale selector ids pruned from the request; the browser
    smoke reproduced the selector-failure scenario and completed a real date-only CSV
    download. Release acceptance remains an §11/user-review step.

### Test and documentation follow-through

- The original review's weak/misnamed tests were corrected rather than re-pinned:
  the date-only spec now exercises date-only export under selector failure, the Blob
  spec flushes a real JSON Blob with a 422 status, the wildcard suite adds the mixed
  exact-plus-wildcard rows, and the corrupt-target restore test now expects refusal.
  Backend correction evidence is recorded above (**303 passed, 5 skipped**).
- Keep runtime-reproduced findings distinct from source-reviewed risks.
  Record the corrective check and its result before closing each item.
- After corrections, complete every real-host row in §11: actual production
  startup/migrations/persistence, scheduled backups and permissions, isolated
  recovery and revoked-session proof, authorized LAN/remote-tailnet access,
  denied Emby-only/public/backend access, trusted certificates, cookies,
  headers/CSP and recorded HSTS status. Then obtain user release review.
- `BACKUP_RESTORE.md` now states the approved scope: **30 calendar days of
  completed snapshots**; offsite/weekly/monthly retention tiers are optional
  post-MVP work, not a prerequisite. Actual scheduler, retention and restore
  acceptance remain §11 gates.
- Recurring transactions, bank import, categorization rules and savings goals
  remain post-MVP. This review calls for an M6 correction pass, not another
  feature milestone.

### Deferred non-blocking items (correction-pass reviews, 2026-09-21)

Recorded so the pass leaves no silent discards. None of these affects current
behavior or blocks release; fold each into the next change that touches the
file.

- `scripts/restore.py`: an unreachable guard (`sidecar parking directory is
  missing`) and a redundant `_fsync_file(pres[0])` (the shared `create_snapshot`
  already flushes before publishing) — delete during the next restore edit.
- `frontend/src/app/features/settings/settings.page.ts`: the success-path
  JSON-blob branch is now unreachable because `SettingsService` normalises
  JSON bodies into errors, and the export request-token/destroy guards cannot
  fire while `downloading()` serialises exports — defensive but inert.
- `backend/tests/test_backup_restore.py`: `_load_backup_module` and
  `_load_restore_module` are near-duplicate importlib helpers; merge into one
  when convenient.
- Test-coverage note: the settings spec's malformed/network export tests are
  regression guards; finding 10's proof is the JSON-Blob 422 spec. The
  selector-membership pruning branch is covered by
  `prunes a selected account id that disappears from a refreshed selector list`.
- Platform caveat: POSIX-only cases (symlink refusal, ownership/mode
  preservation, dangling-path preservation) skip on the Windows development
  host; the per-finding §13 closure lines name each one, and their runtime
  proof belongs to the §11 rows above.
