# Household Budget Tracker — MVP Specification

**Status:** Initial MVP specification  
**Date:** 2026-09-07  
**Primary deployment:** Private home network + Tailscale  
**Primary users:** One household with multiple individual user accounts  
**Frontend:** Angular  
**Backend:** FastAPI  
**Database:** SQLite  
**Deployment:** Docker Compose  
**Reverse proxy / TLS:** Caddy  

---

## 1. Purpose

Build a small, private, self-hosted household budget tracking web application.

The application should make it easy to:

- Record income and expenses.
- Organize transactions by account and category.
- Define monthly category budgets.
- See the current month's financial situation at a glance.
- Allow multiple members of the same household to use individual logins while sharing the same household financial data.
- Keep all financial data on infrastructure controlled by the household.
- Be reachable only from the home LAN and explicitly authorized Tailscale clients.
- Require application authentication even when the client already has network access.

The MVP should deliberately remain small. Features such as bank imports, recurring transactions, automatic categorization, receipt uploads, savings goals, and advanced analytics are explicitly deferred to later versions.

---

# 2. Product Principles

## 2.1 Private by default

The application must never require public internet exposure.

There must be no dependency on:

- Router port forwarding.
- Tailscale Funnel.
- Public reverse proxies.
- Cloud-hosted databases.
- Third-party authentication providers.

All budget data should remain on the self-hosted server unless the administrator explicitly creates a backup elsewhere.

## 2.2 Defense in depth

Access to financial data must require multiple independent layers:

1. The device must be able to reach the server through the LAN or Tailscale.
2. Tailscale access control should restrict the budget service to approved household users/devices.
3. The application itself must require username/password authentication.
4. Every API endpoint containing household data must enforce an authenticated session and household membership.

Possession of Tailscale access alone is **not** sufficient authorization to view financial information.

## 2.3 Simple before clever

The MVP should optimize for:

- Small codebase.
- Easy maintenance.
- Easy backup and restore.
- Predictable behavior.
- Strong typing.
- Straightforward local development.
- Minimal infrastructure.

Do not introduce Redis, Kafka, microservices, Kubernetes, OAuth providers, or separate identity infrastructure unless a future requirement actually needs them.

## 2.4 Household-aware from day one

Even if the first deployment starts with one user, financial data belongs to a **household**, not directly to a user.

Individual users authenticate separately and become members of a household.

This avoids later schema redesign when another household member needs their own login.

---

# 3. MVP Scope

## 3.1 Included in MVP

The MVP contains:

- User login/logout.
- Server-side sessions.
- Household membership.
- Accounts.
- Categories.
- Transactions.
- Monthly category budgets.
- Dashboard for the selected month.
- Transaction filtering.
- Basic settings.
- CSV transaction export.
- Database backup guidance / backup script.
- Docker Compose deployment.
- Caddy reverse proxy.
- LAN + Tailscale-only exposure.
- Example Tailscale Grants policy.

## 3.2 Explicitly out of scope

Do **not** implement these during the MVP unless the specification is intentionally revised:

- Automatic bank synchronization.
- CSV bank import.
- Recurring transactions.
- Automatic transaction categorization.
- Receipt scanning.
- OCR.
- Receipt/image storage.
- Savings goals.
- Investment tracking.
- Stock/crypto prices.
- Debt payoff planning.
- Multi-currency accounting.
- Split transactions.
- Transfers with linked double-entry records.
- Formal double-entry bookkeeping.
- Full accounting/tax functionality.
- Push notifications.
- Email notifications.
- Mobile-native applications.
- Public registration.
- Password reset by email.
- OAuth/social login.
- Multi-household switching.
- Household invitations through email.
- Fine-grained roles beyond owner/member.
- Audit-log UI.
- PostgreSQL.
- Redis.

These are candidates for later milestones.

---

# 4. High-Level Architecture

```text
                    HOME LAN
                        |
                        |
                 +------+------+
                 |             |
              Browser       Mobile
                 |             |
                 +------+------+
                        |
                        v
                +---------------+
                |     Caddy     |
                | HTTPS / :443  |
                +-------+-------+
                        |
               +--------+---------+
               |                  |
               v                  v
        Angular static files   /api/*
                                  |
                                  v
                           +-------------+
                           |   FastAPI   |
                           +------+------+ 
                                  |
                         +--------+---------+
                         |                  |
                         v                  v
                    SQLite DB         Local files
                                    / backups only


REMOTE ACCESS

Approved household device
        |
        v
    Tailscale
        |
        | Tailscale Grant permits tcp:443
        v
      Caddy
        |
        v
   Application login
        |
        v
   Household data


Friend / sibling with Emby access
        |
        v
    Tailscale
        |
        | Emby allowed
        |
        X Budget tcp:443 denied
```

---

# 5. Technology Stack

## 5.1 Frontend

Use:

- Angular.
- TypeScript.
- Angular Router.
- Angular reactive forms.
- Angular HttpClient.
- Signals where they naturally simplify local application state.

A large frontend state library is not required for the MVP.

Suggested structure:

```text
frontend/src/app/
├── core/
│   ├── auth/
│   ├── api/
│   ├── guards/
│   └── models/
│
├── layout/
│
├── features/
│   ├── login/
│   ├── dashboard/
│   ├── transactions/
│   ├── accounts/
│   ├── categories/
│   ├── budgets/
│   └── settings/
│
└── shared/
    ├── components/
    ├── pipes/
    └── utilities/
```

Prefer feature-local components and services over one large global service.

## 5.2 Backend

Use:

- Python.
- FastAPI.
- Pydantic.
- SQLAlchemy 2.x.
- Alembic.
- SQLite.
- Argon2id password hashing.

The backend owns:

- Authentication.
- Authorization.
- Sessions.
- Validation.
- Database access.
- Financial calculations exposed by the API.
- CSV export.

The frontend must never be treated as a security boundary.

## 5.3 Reverse proxy

Use Caddy.

Responsibilities:

- TLS termination.
- Serve or proxy the Angular frontend.
- Reverse proxy `/api/*` to FastAPI.
- Prevent direct external exposure of the backend container.

The backend container should not publish its port to the host unless required for local debugging.

## 5.4 Database

Use SQLite for the MVP.

Reasons:

- Extremely small operational footprint.
- Single-household workload is tiny.
- Easy backup.
- Easy local development.
- No separate database service to administer.

SQLite should run with foreign keys enabled.

WAL mode may be enabled to improve concurrent read/write behavior.

Migration management must still use Alembic from the beginning.

---

# 6. Repository Structure

Recommended monorepo:

```text
budget-tracker/
├── README.md
├── .env.example
├── .gitignore
├── docker-compose.yml
├── Caddyfile
│
├── docs/
│   ├── MVP_SPEC.md
│   ├── DEPLOYMENT.md
│   └── BACKUP_RESTORE.md
│
├── frontend/
│   ├── package.json
│   ├── angular.json
│   └── src/
│
├── backend/
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── migrations/
│   ├── tests/
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── db/
│       ├── auth/
│       ├── models/
│       ├── schemas/
│       ├── repositories/
│       ├── services/
│       └── api/
│
├── scripts/
│   ├── backup.sh
│   └── restore.sh
│
└── data/
    └── .gitkeep
```

`data/` must be ignored except for placeholder files.

Never commit:

- `budget.db`
- database backups
- session secrets
- production `.env`
- TLS private keys

---

# 7. Authentication and Session Model

## 7.1 Login model

The application uses local username/password authentication.

There is no public registration endpoint.

Users are created through one of:

- an initial bootstrap command;
- an admin CLI command;
- or a future authenticated settings screen.

For MVP, a CLI/bootstrap workflow is acceptable and preferable to exposing registration.

Example:

```bash
docker compose exec backend python -m app.cli create-user
```

## 7.2 Password storage

Passwords must never be encrypted or stored directly.

Use Argon2id.

Store:

```text
password_hash
```

Never store:

```text
password
password_plaintext
reversible_password
```

Password rules for MVP:

- minimum length: 12 characters;
- no maximum below 128 characters;
- do not require arbitrary mixtures of uppercase/lowercase/symbols;
- allow password-manager-generated passphrases.

## 7.3 Sessions

Use opaque server-side sessions rather than JWT access tokens.

Authentication flow:

```text
Browser                         FastAPI
   |                               |
   | POST /api/auth/login          |
   | username + password           |
   |------------------------------>|
   |                               |
   | verify password               |
   | create random session         |
   |                               |
   | Set-Cookie session=<opaque>   |
   |<------------------------------|
   |                               |
   | GET /api/auth/me              |
   | Cookie: session=...           |
   |------------------------------>|
   |                               |
   | current user + household      |
   |<------------------------------|
```

Session ID requirements:

- Cryptographically secure random value.
- At least 256 bits of entropy.
- Only a hash of the session token should be stored in the database where practical.
- Rotate/create a fresh session on successful login.

Cookie requirements:

```text
HttpOnly
Secure
SameSite=Lax
Path=/
```

Suggested cookie name:

```text
budget_session
```

Suggested lifetime:

- 30 days maximum for normal household devices.
- Sliding expiration is optional.
- Explicit logout invalidates the server-side session immediately.

## 7.4 CSRF

Because authentication uses cookies, mutating requests must have CSRF protection.

Acceptable MVP design:

- SameSite cookie protection.
- Verify `Origin` for unsafe methods.
- Add CSRF token protection for POST/PUT/PATCH/DELETE.

Do not rely solely on the fact that the application is internal.

## 7.5 Login rate limiting

Protect `/api/auth/login`.

Initial target:

- approximately 5 failed attempts per username/IP within a short window;
- progressively delay or temporarily reject repeated failures;
- successful login resets relevant failure state.

The exact implementation can remain simple because deployment is single-instance.

Avoid permanently locking accounts due to remote attempts.

## 7.6 Authentication errors

Do not reveal whether a username exists.

Return a generic response:

```text
Invalid username or password.
```

## 7.7 Authorization

Every household-data query must be scoped using the authenticated user's household membership.

Never accept a household ID from the browser and trust it blindly.

Bad:

```python
SELECT * FROM transactions
WHERE household_id = request.household_id
```

Required concept:

```python
household_id = authenticated_user.household_id

SELECT * FROM transactions
WHERE household_id = household_id
```

Resource ownership checks must occur server-side.

---

# 8. User and Household Model

## 8.1 Users

A user is an authentication identity.

Fields:

```text
users
-----
id                  UUID or integer PK
username            unique
display_name
password_hash
is_active
created_at
updated_at
```

For MVP, username is sufficient.

Email is optional and should not be required because no email workflow exists.

## 8.2 Households

Fields:

```text
households
----------
id
name
created_at
updated_at
```

Example:

```text
Merlin Household
```

## 8.3 Household members

Use a join table even if MVP only permits one household per user.

```text
household_members
-----------------
id
household_id
user_id
role
created_at
```

Allowed roles:

```text
owner
member
```

MVP behavior can treat both roles identically for financial data.

`owner` is reserved for later household administration.

MVP constraint:

- one active household membership per user.

This can later be relaxed without changing the ownership of financial records.

---

# 9. Financial Domain Model

Money must **never** use binary floating-point storage.

Recommended representation:

- store integer cents in the database.

Example:

```text
€84.72 -> 8472
-€84.72 -> -8472
```

API may expose amounts as integer minor units:

```json
{
  "amount": -8472,
  "currency": "EUR"
}
```

For the MVP the household currency is fixed to:

```text
EUR
```

Multi-currency support is out of scope.

---

# 10. Accounts

An account represents a place where money is held or owed.

Examples:

- Checking account.
- Savings account.
- Cash.
- Credit card.

Schema:

```text
accounts
--------
id
household_id
name
type
initial_balance
is_archived
created_at
updated_at
```

`initial_balance` is stored in cents.

Allowed account types:

```text
checking
savings
cash
credit_card
other
```

Rules:

- Accounts belong to exactly one household.
- Archived accounts remain referenced by historical transactions.
- An account with transactions should normally be archived instead of deleted.
- Duplicate account names may be rejected within a household for simplicity.

Current balance:

```text
initial_balance + SUM(transaction.amount)
```

This MVP treats credit-card balances using the same signed amount model; sophisticated liability accounting is deferred.

---

# 11. Categories

Categories classify transactions.

Examples:

Expense:

- Housing.
- Groceries.
- Restaurants.
- Car.
- Insurance.
- Kids.
- Entertainment.
- Subscriptions.

Income:

- Salary.
- Bonus.
- Other Income.

Schema:

```text
categories
----------
id
household_id
name
type
is_archived
created_at
updated_at
```

Category type:

```text
income
expense
```

Rules:

- Categories belong to one household.
- Archived categories remain visible on historical transactions.
- A category with transactions is archived instead of hard-deleted.
- Category names should be unique per household + type.

Optional default categories may be created when the first household is initialized.

---

# 12. Transactions

Transactions are the central domain object.

Schema:

```text
transactions
------------
id
household_id
account_id
category_id
amount
description
transaction_date
created_by_user_id
created_at
updated_at
```

Money sign convention:

```text
income  -> positive
expense -> negative
```

Examples:

```text
Salary                 +350000
REWE groceries           -8472
Netflix                  -1799
```

The backend should validate category compatibility:

- positive transactions normally require an income category;
- negative transactions normally require an expense category.

MVP may allow the user to intentionally override this later, but the initial UI should guide toward the normal model.

Required fields:

- Account.
- Category.
- Amount.
- Date.

Optional:

- Description.

Default transaction date:

- today in the user's/browser's local timezone.

Editing:

- User may edit any transaction belonging to their household.

Deleting:

- MVP allows hard deletion of transactions.
- Future versions may introduce soft deletion/audit history.

No linked bank transfer records in MVP.

If the user moves money between their own accounts, MVP can represent this as two manually entered transactions if necessary. A proper transfer model is deferred.

---

# 13. Monthly Budgets

A budget defines the expected spending limit for an expense category in a calendar month.

Schema:

```text
budgets
-------
id
household_id
category_id
year
month
limit_amount
created_at
updated_at
```

Constraints:

```text
UNIQUE(household_id, category_id, year, month)
```

Only expense categories may have a budget.

Example:

```text
September 2026
Groceries      60000
Restaurants    20000
Entertainment  20000
```

Budget usage:

```text
spent = ABS(SUM(negative transactions for category/month))
```

Remaining:

```text
remaining = limit_amount - spent
```

Progress:

```text
progress = spent / limit_amount
```

The UI must gracefully handle:

- no budget;
- zero budget;
- over-budget values;
- category with no spending.

---

# 14. Dashboard

The dashboard is the default authenticated route.

Route:

```text
/dashboard
```

Default period:

- current calendar month.

The user can move backward/forward by month.

## 14.1 Summary cards

Show:

### Current account balance

Sum of current balances across all non-archived accounts.

### Income this month

Sum of positive transactions for selected month.

### Expenses this month

Absolute sum of negative transactions for selected month.

### Net this month

```text
income + expenses_signed
```

Example:

```text
Income:     4,200 €
Expenses:   2,850 €
Net:       +1,350 €
```

## 14.2 Budget overview

Show every budget configured for the selected month:

```text
Groceries
423 € / 600 €
70.5%

Restaurants
215 € / 200 €
107.5% — over budget
```

## 14.3 Spending by category

Show expense totals for the selected month.

A chart is optional for the first implementation milestone.

A sorted list is sufficient initially:

```text
Housing          1,200 €
Groceries          423 €
Car                310 €
Restaurants        215 €
```

If a chart library is introduced, keep the dependency small and only use it where it adds value.

## 14.4 Recent transactions

Show approximately the latest 5–10 transactions.

Each item should display:

- Date.
- Description.
- Category.
- Account.
- Amount.

---

# 15. Transactions Page

Route:

```text
/transactions
```

Primary functionality:

- List transactions.
- Add transaction.
- Edit transaction.
- Delete transaction.
- Filter transactions.

Default sorting:

```text
transaction_date DESC
created_at DESC
```

Filters:

- Date/month.
- Account.
- Category.
- Income/expense.
- Search text.

The first version may use server-side query filters without complex pagination.

Pagination should be added once transaction count becomes large.

Recommended future pagination approach:

```text
limit
cursor
```

Offset pagination is acceptable for MVP if implementation speed is more important.

## 15.1 Add/edit form

Fields:

```text
Date
Amount
Type / sign
Account
Category
Description
```

Possible UX:

```text
[ Expense | Income ]

Amount:       [ 84.72 ]
Date:         [ 07.09.2026 ]
Account:      [ Checking v ]
Category:     [ Groceries v ]
Description:  [ REWE       ]
```

The frontend converts the entered decimal amount to cents safely.

The API still validates the value.

---

# 16. Accounts Page

Route:

```text
/accounts
```

Display:

```text
Checking        3,842.17 €
Savings        11,200.00 €
Cash              120.00 €
```

Actions:

- Add account.
- Rename account.
- Change account type.
- Update initial balance only if explicitly supported.
- Archive account.

Be careful with changing initial balances after transactions exist because this modifies historical/current totals.

Preferred MVP behavior:

- initial balance editable only with a clear warning;
- later replace this with explicit balance adjustments.

---

# 17. Categories Page

Route:

```text
/categories
```

Sections:

```text
Expense Categories
Income Categories
```

Actions:

- Add.
- Rename.
- Archive.

Do not delete categories referenced by transactions.

---

# 18. Budgets Page

Route:

```text
/budgets
```

User selects a month.

Display all active expense categories and allow setting a monthly limit.

Example:

```text
September 2026

Groceries          [ 600.00 € ]
Restaurants        [ 200.00 € ]
Entertainment      [ 200.00 € ]
Kids               [ 300.00 € ]
Car                [ 250.00 € ]
```

Useful MVP convenience:

```text
Copy previous month
```

This is small enough to include if implementation remains simple.

Behavior:

- Copy previous month's configured limits into selected month.
- Do not overwrite current-month values without confirmation.

---

# 19. Settings Page

Route:

```text
/settings
```

MVP settings:

## Profile

- Display name.
- Change password.

## Household

Read-only initially:

- Household name.
- Members.

Owner may optionally rename household.

## Data

- Export transactions as CSV.
- Show information about backups.

Do not provide browser-triggered database restore in MVP.

Restore remains an administrator/server operation.

---

# 20. Login Page

Route:

```text
/login
```

The login page must reveal **no financial information**.

No dashboard values, household name, account names, or other private details may be embedded in unauthenticated HTML/API responses.

Fields:

```text
Username
Password
```

Optional:

```text
Show password
```

Do not include:

- public account registration;
- forgotten-password email link.

On authentication failure:

```text
Invalid username or password.
```

After successful login:

```text
/dashboard
```

If an authenticated user visits `/login`, redirect to `/dashboard`.

---

# 21. Frontend Routing and Guards

Routes:

```text
/login

/dashboard
/transactions
/accounts
/categories
/budgets
/settings
```

Use an Angular auth guard for user experience.

However:

> Angular route guards are not authorization.

All real access control is enforced in FastAPI.

On application startup:

```text
GET /api/auth/me
```

Possible responses:

```text
200 -> restore authenticated UI state
401 -> redirect to /login
```

For any API `401` after login:

- clear frontend auth state;
- redirect to login.

---

# 22. REST API

Base path:

```text
/api
```

## 22.1 Authentication

```text
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
POST   /api/auth/change-password
```

### POST /api/auth/login

Request:

```json
{
  "username": "merlin",
  "password": "..."
}
```

Response:

```json
{
  "user": {
    "id": 1,
    "username": "merlin",
    "displayName": "Merlin"
  },
  "household": {
    "id": 1,
    "name": "Household"
  }
}
```

Session is transported by cookie, not response JSON.

## 22.2 Dashboard

```text
GET /api/dashboard?year=2026&month=9
```

Response concept:

```json
{
  "period": {
    "year": 2026,
    "month": 9
  },
  "summary": {
    "balance": 1516217,
    "income": 420000,
    "expenses": 285000,
    "net": 135000
  },
  "budgets": [],
  "spendingByCategory": [],
  "recentTransactions": []
}
```

## 22.3 Accounts

```text
GET    /api/accounts
POST   /api/accounts
GET    /api/accounts/{id}
PUT    /api/accounts/{id}
DELETE /api/accounts/{id}
```

For accounts with existing transactions, `DELETE` should normally archive instead of physically delete.

A dedicated endpoint is also acceptable:

```text
POST /api/accounts/{id}/archive
```

Choose one convention and use it consistently.

## 22.4 Categories

```text
GET    /api/categories
POST   /api/categories
GET    /api/categories/{id}
PUT    /api/categories/{id}
DELETE /api/categories/{id}
```

Same archive semantics as accounts.

## 22.5 Transactions

```text
GET    /api/transactions
POST   /api/transactions
GET    /api/transactions/{id}
PUT    /api/transactions/{id}
DELETE /api/transactions/{id}
```

Suggested filters:

```text
?year=2026
&month=9
&accountId=1
&categoryId=5
&type=expense
&search=rewe
```

## 22.6 Budgets

```text
GET    /api/budgets?year=2026&month=9
PUT    /api/budgets/{categoryId}?year=2026&month=9
POST   /api/budgets/copy-previous
```

Example update:

```json
{
  "limitAmount": 60000
}
```

## 22.7 Export

```text
GET /api/export/transactions.csv
```

Optional filters:

```text
from
to
accountId
categoryId
```

CSV columns:

```text
date
description
account
category
type
amount
currency
```

CSV should use an unambiguous machine-readable amount format such as:

```text
-84.72
```

rather than localized presentation formatting.

---

# 23. API Error Format

Use one consistent shape.

Example:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request could not be processed.",
    "fields": {
      "amount": "Amount must not be zero."
    }
  }
}
```

Suggested codes:

```text
AUTH_REQUIRED
INVALID_CREDENTIALS
FORBIDDEN
NOT_FOUND
VALIDATION_ERROR
CONFLICT
RATE_LIMITED
INTERNAL_ERROR
```

Do not return stack traces to clients in production.

---

# 24. Database Schema Overview

```text
users
  |
  v
household_members ---> households
                         |
          +--------------+---------------+---------------+
          |              |               |               |
          v              v               v               v
       accounts       categories     transactions      budgets
          |              |               |
          +--------------+---------------+
```

Recommended foreign keys:

```text
household_members.user_id        -> users.id
household_members.household_id   -> households.id

accounts.household_id            -> households.id
categories.household_id          -> households.id

transactions.household_id        -> households.id
transactions.account_id          -> accounts.id
transactions.category_id         -> categories.id
transactions.created_by_user_id  -> users.id

budgets.household_id             -> households.id
budgets.category_id              -> categories.id
```

The backend must verify that referenced account/category records belong to the same household as the transaction.

Do not rely only on foreign keys for this cross-household invariant.

---

# 25. Suggested Database Indexes

At minimum:

```text
users(username)

household_members(user_id)
household_members(household_id)

accounts(household_id)
categories(household_id)

transactions(household_id, transaction_date)
transactions(account_id, transaction_date)
transactions(category_id, transaction_date)

budgets(household_id, year, month)
budgets(household_id, category_id, year, month) UNIQUE

sessions(token_hash)
sessions(user_id)
sessions(expires_at)
```

---

# 26. Session Table

Recommended schema:

```text
sessions
--------
id
user_id
token_hash
created_at
expires_at
last_seen_at
user_agent_optional
```

Do not store raw session tokens if avoidable.

Workflow:

```text
raw token -> SHA-256 or equivalent one-way hash -> DB lookup
```

The raw token only exists in the user's cookie.

Expired sessions should be periodically removed.

A simple cleanup during authentication requests or a daily container cron/task is sufficient.

---

# 27. Tailscale Access Model

Tailscale is an additional **network authorization layer**, not the application's identity system.

Current Tailscale guidance recommends Grants for new access policies.

Desired behavior:

```text
Household users/devices
  -> may reach Budget HTTPS port

Friends/siblings
  -> may reach Emby
  -> may NOT reach Budget HTTPS port
```

If Emby and Budget run on the same server, port-based grants can still distinguish them.

Example conceptual policy:

```json
{
  "groups": {
    "group:household": [
      "household-user-1@example.com",
      "household-user-2@example.com"
    ]
  },

  "grants": [
    {
      "src": ["group:household"],
      "dst": ["tag:home-server"],
      "ip": ["tcp:443"]
    }
  ]
}
```

The actual production policy must be merged carefully with existing Emby/Tailscale rules.

Important:

- Do not add a broad rule later that unintentionally grants all tailnet users access to every port on the server.
- Tailscale grants are additive; a broad matching grant can re-enable access.
- Test the final tailnet policy from both an allowed and disallowed account/device.

If Budget receives its own Tailscale device/tag later, prefer:

```text
tag:budget
```

over a general-purpose server tag.

References:

- https://tailscale.com/docs/features/access-control/grants
- https://tailscale.com/docs/reference/syntax/grants

---

# 28. LAN Access Model

The service may also be reachable directly from trusted home LAN devices.

Desired network exposure:

```text
LAN clients     -> tcp:443 allowed
Tailscale       -> tcp:443 subject to Grants
Public internet -> no route / blocked
```

Do not configure router NAT/port forwarding to Budget.

Host firewall should allow HTTPS only from intended private address ranges/interfaces.

Avoid blindly allowing every RFC1918 range if the home network uses only one known subnet.

Example concept:

```text
192.168.178.0/24 -> tcp:443
tailscale0       -> tcp:443
everything else -> denied
```

Use the actual home subnet during deployment.

---

# 29. TLS / HTTPS

Production authentication must use HTTPS.

Caddy terminates TLS.

For a purely private deployment, the initial supported solution can use Caddy's internal CA:

```text
tls internal
```

The Caddy root certificate must then be trusted on household devices.

Alternative certificate strategies may be configured later, including a privately resolved domain with DNS-based certificate issuance.

Do not disable the `Secure` cookie flag merely to make HTTP deployment easier.

Development may use HTTP on localhost.

Production must use HTTPS.

Caddy documentation:

- https://caddyserver.com/docs/quick-starts/reverse-proxy

---

# 30. Docker Compose Design

Conceptual services:

```yaml
services:
  frontend:
    # Angular build/static serving OR built into Caddy image

  backend:
    # FastAPI
    # no public host port required

  caddy:
    # only service exposing 443
```

A cleaner production setup may use a multi-stage Angular build and copy the final Angular assets directly into the Caddy image.

That can reduce production to:

```text
caddy
backend
```

SQLite is a file mounted into the backend:

```text
./data:/app/data
```

Caddy is the only service that should bind the application HTTPS port on the host.

Example network:

```text
Internet/LAN/Tailscale
       |
       v
  Caddy :443
       |
       +------ static Angular
       |
       +------ backend:8000
```

---

# 31. Environment Configuration

`.env.example` may contain:

```text
APP_ENV=development
DATABASE_URL=sqlite:////app/data/budget.db
SESSION_SECRET=CHANGE_ME
SESSION_MAX_AGE_DAYS=30
ALLOWED_ORIGINS=https://budget.example.internal
TRUSTED_HOSTS=budget.example.internal
```

Do not commit the real `.env`.

Production startup must fail clearly when required secrets are missing or insecure defaults are still configured.

Prefer generating a random high-entropy secret.

---

# 32. Backups

Financial data is valuable even if the application is small.

Backups are part of MVP operations.

Minimum goal:

- daily backup;
- multiple historical versions;
- backup stored outside the container filesystem;
- periodic restore test.

Suggested structure:

```text
/backups/budget/
├── budget-2026-09-07.sqlite
├── budget-2026-09-06.sqlite
└── ...
```

Use a SQLite-safe backup mechanism.

Do not simply copy a live database file without considering WAL/in-flight writes.

Good options:

- SQLite backup command/API.
- `VACUUM INTO`.
- temporarily coordinated application backup operation.

Retention suggestion:

```text
7 daily
4 weekly
6 monthly
```

This is configurable rather than a strict product requirement.

Future improvement:

- encrypted secondary backup to NAS/cloud storage.

---

# 33. Logging

Application logs may contain:

- endpoint.
- status code.
- timing.
- user ID.
- request ID.

Avoid logging:

- passwords.
- session tokens.
- CSRF tokens.
- full request cookies.
- full financial transaction descriptions unless necessary.

Do not enable SQL query logging containing user data in production by default.

Authentication logs may record:

```text
successful login
failed login
logout
session expiry
```

without logging submitted passwords.

---

# 34. Security Headers

Caddy/backend should provide appropriate headers.

Target:

```text
Content-Security-Policy
X-Content-Type-Options: nosniff
Referrer-Policy
Permissions-Policy
Strict-Transport-Security
```

HSTS should only be enabled after HTTPS hostname behavior is stable, because internal certificate mistakes can otherwise become annoying to recover from.

Angular production builds must not use unsafe development settings.

---

# 35. Input Validation

Backend validation is authoritative.

Examples:

- Amount must not be zero.
- Date must be valid.
- Referenced account must exist and belong to household.
- Referenced category must exist and belong to household.
- Budget amount cannot be negative.
- Month must be 1–12.
- Description length must be bounded.
- Account/category names must have reasonable limits.

Suggested maximums:

```text
username       100 chars
display_name   100 chars
account name   100 chars
category name  100 chars
description    500 chars
```

---

# 36. Dates and Timezones

Transaction dates are calendar dates, not timestamps.

Use:

```text
DATE
```

for:

```text
transaction_date
```

Use UTC timestamps for technical timestamps:

```text
created_at
updated_at
expires_at
```

Frontend renders timestamps in local browser timezone.

Monthly budgets use explicit:

```text
year
month
```

rather than date-range strings.

---

# 37. Currency Formatting

Stored:

```text
integer cents
EUR
```

Displayed:

```text
84,72 €
```

for German locale if desired.

Internal/API representation remains locale-independent.

Do not parse localized strings on the backend.

---

# 38. UX Layout

Desktop-first but responsive enough for phone/tablet use.

Suggested layout:

```text
+------------------------------------------------------------+
| Budget                         September 2026      User  v  |
+-------------+----------------------------------------------+
| Dashboard   |                                              |
| Transactions|  Main page content                           |
| Budgets     |                                              |
| Accounts    |                                              |
| Categories  |                                              |
| Settings    |                                              |
+-------------+----------------------------------------------+
```

Mobile may convert the sidebar into:

- drawer;
- bottom navigation;
- compact menu.

MVP must remain usable on a phone because entering transactions from a phone is a likely household workflow.

---

# 39. Accessibility

Basic accessibility is required:

- Every form field has a label.
- Keyboard navigation works.
- Buttons use semantic elements.
- Error messages are associated with inputs.
- Do not communicate budget state using color alone.
- Sufficient contrast.
- Visible focus indication.
- Monetary values have readable text equivalents.

---

# 40. Initial Household Bootstrap

First production setup needs to create:

1. Household.
2. First owner.
3. Optional default categories.

Example CLI:

```bash
docker compose exec backend python -m app.cli init-household
```

Interactive flow:

```text
Household name: Family
Username: merlin
Display name: Merlin
Password: ************
Create default categories? [Y/n]
```

The command:

- refuses to create a second initial household once initialized;
- hashes the password;
- assigns `owner` membership.

Additional household users:

```bash
docker compose exec backend python -m app.cli create-user
```

or later through owner settings.

---

# 41. Default Categories

Optional seed set:

## Income

```text
Salary
Bonus
Other Income
```

## Expense

```text
Housing
Groceries
Restaurants
Car
Public Transport
Insurance
Subscriptions
Kids
Health
Shopping
Entertainment
Travel
Utilities
Other
```

Users can rename/archive/add categories.

Avoid creating dozens of categories initially.

---

# 42. Testing Requirements

## Backend

Use automated tests for:

### Authentication

- valid login.
- invalid password.
- unknown username.
- session creation.
- expired session.
- logout invalidation.
- unauthenticated endpoint rejection.

### Authorization

Critical test:

> A user must never be able to access resources from another household.

Even though MVP starts with one household per deployment, tests should create two households specifically to prove isolation.

Test:

- accounts.
- categories.
- transactions.
- budgets.
- dashboard.
- export.

### Financial calculations

Test:

- account balance.
- monthly income.
- monthly expenses.
- net.
- category spending.
- budget remaining.
- over-budget behavior.
- integer-cent precision.

## Frontend

At minimum test:

- auth service.
- auth guard.
- transaction amount conversion.
- main forms.
- important month/budget calculations if any are performed client-side.

Prefer backend calculations for financial totals.

## End-to-end

A small E2E suite should cover:

```text
login
-> create account
-> create category
-> add expense
-> see expense on dashboard
-> set budget
-> see budget progress
-> logout
-> financial route is inaccessible
```

---

# 43. MVP Acceptance Criteria

The MVP is complete when all of the following are true.

## Security

- [ ] Application is not publicly reachable.
- [ ] HTTPS is used in production.
- [ ] Tailscale Grant limits Budget access to intended household users/devices.
- [ ] Friends/siblings with Emby access cannot connect to the Budget HTTPS service.
- [ ] Budget login is still required from an authorized Tailscale device.
- [ ] Passwords are Argon2id hashed.
- [ ] Authentication uses opaque server-side sessions.
- [ ] Session cookie is HttpOnly + Secure + SameSite.
- [ ] Mutating APIs have CSRF protection.
- [ ] Login endpoint is rate limited.
- [ ] Cross-household authorization tests pass.

## Functional

- [ ] User can log in and log out.
- [ ] User can create/edit/archive accounts.
- [ ] User can create/edit/archive categories.
- [ ] User can add/edit/delete transactions.
- [ ] User can filter transaction history.
- [ ] User can define monthly category budgets.
- [ ] Dashboard shows monthly income.
- [ ] Dashboard shows monthly expenses.
- [ ] Dashboard shows monthly net.
- [ ] Dashboard shows current total account balance.
- [ ] Dashboard shows budget progress.
- [ ] Dashboard shows recent transactions.
- [ ] User can export transactions as CSV.

## Operational

- [ ] Application starts with `docker compose up -d`.
- [ ] Database survives container recreation.
- [ ] Alembic migrations run predictably.
- [ ] Backup script exists.
- [ ] Restore procedure is documented.
- [ ] Production secrets are outside Git.
- [ ] README documents local development.
- [ ] Deployment documentation covers LAN/Tailscale access.

---

# 44. Implementation Milestones

## Milestone 0 — Repository and infrastructure skeleton

Goal:

Create a clean, runnable project before adding domain functionality.

Deliver:

- Angular project.
- FastAPI project.
- Docker Compose.
- Caddy.
- `/api/health`.
- Alembic configured.
- SQLite connection.
- development instructions.
- backend and frontend test runners.

Acceptance:

```text
docker compose up
```

results in:

```text
GET /              -> Angular
GET /api/health    -> 200
```

---

## Milestone 1 — Authentication + household bootstrap

Deliver:

- users.
- households.
- household_members.
- sessions.
- Argon2id.
- bootstrap CLI.
- login.
- logout.
- `/auth/me`.
- Angular login page.
- auth guard.
- CSRF protection.
- basic login rate limiting.

This milestone should be security-reviewed before financial features are added.

---

## Milestone 2 — Accounts + categories

Deliver:

- account CRUD/archive.
- category CRUD/archive.
- Angular account page.
- Angular category page.
- household scoping tests.

---

## Milestone 3 — Transactions

Deliver:

- transaction CRUD.
- transaction form.
- transaction list.
- filters.
- signed amount model.
- money stored as cents.
- household/account/category validation.

At this point the application becomes minimally useful for real data entry.

---

## Milestone 4 — Dashboard

Deliver:

- monthly selector.
- total balances.
- income.
- expenses.
- net.
- spending by category.
- recent transactions.

Keep visualizations simple.

---

## Milestone 5 — Monthly budgets

Deliver:

- monthly category budget CRUD.
- budget page.
- dashboard budget progress.
- over-budget indication.
- optional copy-previous-month action.

---

## Milestone 6 — Export + operations

Deliver:

- CSV export.
- production Docker configuration.
- backup script.
- restore documentation.
- Tailscale Grants documentation.
- firewall documentation.
- TLS documentation.
- production configuration validation.

This is the MVP release candidate.

---

# 45. Suggested Post-MVP Roadmap

Once the MVP has been used with real household data, prioritize based on actual friction.

Likely high-value additions:

## 1. Recurring transactions

Examples:

```text
Rent
Insurance
Netflix
Salary
Kindergarten
Internet
```

Generate or suggest transactions automatically each month.

## 2. Bank CSV import

Import downloaded statements.

Required work:

- bank-specific/import mapping;
- duplicate detection;
- import preview;
- transaction matching;
- safe rollback.

Do not start direct bank APIs before CSV import proves useful.

## 3. Categorization rules

Examples:

```text
Description contains "REWE"
    -> Groceries

Description contains "NETFLIX"
    -> Subscriptions

Description contains "ARAL"
    -> Car
```

This combines very naturally with bank import.

## 4. Import learning/suggestions

Remember previous merchant-category choices.

Could later provide:

```text
"REWE" was categorized as Groceries 18 times.
Apply automatically?
```

## 5. Savings goals

Examples:

```text
Vacation
Emergency fund
New car
```

## 6. Better analytics

Examples:

- spending trend;
- month-over-month comparison;
- category trend;
- fixed vs variable costs;
- annual overview.

## 7. Account transfers

Introduce first-class linked transfer records.

## 8. Attachments / receipts

Only add once there is a real use case because it increases backup/storage complexity.

---

# 46. Future Bank Import Design Notes

Do not implement yet, but preserve these assumptions:

Transactions should eventually gain optional fields such as:

```text
external_id
import_batch_id
counterparty
raw_description
import_source
```

Do not add them prematurely unless needed.

Import pipeline concept:

```text
CSV
 |
 v
Parser
 |
 v
Normalized candidate transactions
 |
 v
Duplicate detection
 |
 v
Categorization rules
 |
 v
Preview
 |
 v
User confirms
 |
 v
Transactions
```

No import should silently modify existing transactions.

---

# 47. Future Recurring Transaction Design Notes

Potential model:

```text
recurring_transactions
----------------------
id
household_id
account_id
category_id
amount
description
frequency
next_date
is_active
```

Potential frequencies:

```text
weekly
monthly
quarterly
yearly
```

Prefer generating real transaction records rather than mixing virtual recurring items into financial calculations.

---

# 48. Decisions Intentionally Made

These decisions should not be casually changed by the implementation agent.

### Angular rather than another SPA framework

Reason:

- known and productive stack;
- strong forms/router/HTTP tooling;
- suitable for future growth.

### FastAPI rather than Node backend

Reason:

- known stack;
- simple API development;
- excellent validation model;
- easy local deployment.

### SQLite rather than PostgreSQL

Reason:

- tiny expected concurrent workload;
- simpler operations;
- trivial self-hosting and backup.

Revisit PostgreSQL only if there is a demonstrated need.

### Server-side sessions rather than JWT

Reason:

- simple invalidation;
- browser-only first-party application;
- no distributed service architecture;
- no benefit from self-contained long-lived tokens.

### Household-owned records

Reason:

- multiple people may use individual logins;
- both users should see shared household finances;
- avoids later migration from user ownership.

### Tailscale Grants plus application login

Reason:

- some tailnet members need access to services such as Emby but must not have network access to Budget;
- network authorization limits discovery/reachability;
- app authentication protects data even from an otherwise authorized network/device.

### Integer cents rather than float

Reason:

- financial calculations must be exact.

---

# 49. Non-Goals for the Coding Agent

The implementation agent should **not**:

- replace the selected stack without a concrete blocker;
- introduce a microservice architecture;
- add public signup;
- add JWT because it is "more modern";
- store monetary values as float;
- trust household IDs from the frontend;
- expose FastAPI directly to the public/LAN when Caddy is intended to front it;
- add cloud dependencies for core functionality;
- implement deferred features while MVP milestones remain incomplete;
- create complex abstractions before there are multiple implementations/use cases;
- redesign the application into an accounting system.

Prefer boring, understandable code.

---

# 50. Definition of the First Useful Version

The earliest version worth putting real data into is:

```text
Login
  |
  v
Accounts + Categories
  |
  v
Transactions
  |
  v
Monthly Dashboard
```

Budgets can arrive immediately afterward.

The first production deployment should happen only after:

- authentication tests pass;
- household isolation tests pass;
- HTTPS works;
- Tailscale access rules are verified;
- backup/restore has been tested.

---

# 51. Suggested First Coding-Agent Prompt

Use this specification as the architectural source of truth.

A suitable first task is:

> Implement **Milestone 0 only** from `docs/MVP_SPEC.md`. Create the Angular frontend, FastAPI backend, SQLite/SQLAlchemy/Alembic setup, Docker Compose environment, Caddy reverse proxy, health endpoint, and basic test configuration. Do not implement authentication or financial domain features yet. Keep the architecture simple and production-oriented. After implementation, run all available tests/builds and document how to start the development and Docker environments.

After Milestone 0 is reviewed, proceed to Milestone 1.

---

# 52. Final MVP Summary

The MVP is a private household budget application with this trust model:

```text
          Public Internet
                |
                X
                |
       +--------+---------+
       |                  |
   Home LAN            Tailscale
       |                  |
       |            Grants / least
       |            privilege access
       |                  |
       +--------+---------+
                |
             HTTPS
                |
              Caddy
                |
          Application Login
                |
          Server Session
                |
        Household Authorization
                |
           Financial Data
```

And this product model:

```text
Household
   |
   +-- Users
   |
   +-- Accounts
   |
   +-- Categories
   |
   +-- Transactions
   |
   +-- Monthly Budgets
```

The architecture intentionally leaves a clean path toward:

```text
Recurring transactions
        +
Bank CSV imports
        +
Categorization rules
        +
Savings goals
        +
Advanced analytics
```

without making the first version unnecessarily complex.
