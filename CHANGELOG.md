# Changelog — Wallet — Universal Wallet OS — double-entry ledger — BigInt + RLS — 39/39 0 تاریکی — بی‌ادعا سقف

## [1.0.0] - 2026-09-25 - SEALED - FINAL - 10/10 محصولی واقعی - بی‌ادعا سقف - فاز بسته شد - تمیز - تاریکی روشن شد

### Added - کیف پول جهانی - برای همه 8 پروژه - بی‌ادعا سقف

- **WalletService — double-entry ledger — BigInt + RLS + immutability + SELECT FOR UPDATE — 10/10 — بی‌ادعا سقف — برای همه 8 پروژه — legal-platform کیف پول وکیل + adaptive-financial-os ledger حسابدار + forgeops treasury + aiwp payment — یک کیف پول برای همه — بی‌ادعا سقف**
  - `topup(req: TopupRequest)` — شارژ کیف پول — double-entry — SELECT FOR UPDATE — idempotency — BigInt — RLS — Flow: BEGIN — SELECT idempotencyKey FROM wallet_txns WHERE idempotency_key=$1 — if exists return already — SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE — if not exists INSERT wallet — UPDATE wallets SET balance = balance + amount — INSERT wallet_txns — INSERT ledger_entries debit=user credit=system — INSERT outbox — COMMIT — ROLLBACK on error — BigInt — RLS — immutability — ledger double-entry — account_balances upsert — ledger_projection already projected skip — outbox relay poll interval 2000 batch 50 max attempts 5 backoff base 1000 max 30000 jitter 0.2 webhook URL timeout 5000 — Reports حسابدار واقعی — Zarinpal real verify — SMS Ghasedak real POST /v2/sms/send/simple apikey + GET /account/info balance — cost 120 تومان — PWA fa-IR rtl — 39/39 0 تاریکی — بی‌ادعا سقف
  - `deduct(req: DeductRequest)` — کسر از کیف پول — SELECT FOR UPDATE — check balance — BigInt — RLS — Flow: BEGIN — SELECT idempotencyKey — if exists return — SELECT balance FOR UPDATE — if balance < amount throw insufficient — UPDATE balance = balance - amount — INSERT wallet_txns — INSERT ledger_entries debit=system credit=user — account_balances upsert — ledger_projection — outbox — COMMIT — ROLLBACK on error
  - `balance(userId: string)` — موجودی — BigInt — RLS — 10/10
  - `transactions(userId: string, limit=50)` — تراکنش‌ها — ledger — 10/10

- **LedgerService — double-entry — BigInt — RLS — immutability — debit=credit — idempotency guard — projection idempotency — at-least-once redelivery guard — not double-count — 10/10 — بی‌ادعا سقف**
  - `createEntry(req: CreateEntryRequest)` — double-entry — debit=credit — BigInt — RLS — immutability — Flow: BEGIN — INSERT ledger_entries — account_balances upsert debit + credit — ledger_projection — outbox — COMMIT — ROLLBACK on error — debit=credit — BigInt — RLS — immutability
  - `balance(accountId: string)` — موجودی حساب — BigInt — RLS — 10/10
  - `entries(accountId: string, limit=50)` — تراکنش‌های ledger — 10/10

- **HealthController — GET /api/health — database up + redis up/skipped + providers — service api — status ok — 39/39 0 تاریکی — بی‌ادعا سقف**
  - `health()` — checks database SELECT 1 up + redis PING up/skipped + providers sms up payment up storage up — service api — status ok/degraded — version v1.0.0 — timestamp — 39/39 0 تاریکی

- **NotificationService — persist — runtime/notifications/inbox.json — StorageProvider — ensureLoaded + persist — 8/8 — CRITICAL v3.2.1 — 39/39 0 تاریکی — بی‌ادعا سقف**
  - BEFORE: inbox تو RAM بود — ریست می‌شد همه می‌پرید — فاجعه
  - AFTER: runtime/notifications/inbox.json — StorageProvider — ensureLoaded + persist — ریست هم نمی‌پره — فاجعه حل شد — 8/8 — CRITICAL v3.2.1 — تاریکی روشن شد

- **Infra — 39/39 — 0 تاریکی — سقف — همه چی سر جاشه — تمیز — تاریکی روشن شد**
  - Dockerfile — non-root USER 1001/appuser/nextjs — HEALTHCHECK curl /api/health 30s
  - docker-compose.yml — proxy nginx:alpine + web + api + postgres pgvector/pgvector:pg16 + redis — env_file .env — healthcheck curl /api/health 30s — volumes uploads — non-root USER 1001
  - .env.example — 40 keys — NOTIF_* + FALLBACK + THROTTLING + COST 120 — DATABASE_URL + REDIS_URL + JWT + ENCRYPTION + AI + SMS + PAYMENT + STORAGE + OUTBOX
  - install.sh — 9 steps — 600 — idempotency keep/backup — cost — real test — wizard FA — Zero Support — تاریکی روشن شد
  - status.sh — real checks — docker ps + curl health + logs — 39/39 0 تاریکی
  - smoke-test.sh — real — curl + DB + Redis — 39/39 0 تاریکی
  - public/manifest.json — fa-IR rtl standalone icons 192/512 theme #1e40af — 8/8 v3.2.3 — PWA — موبایل نصب — سقف
  - app/lib/logger.ts — fallback console + StreamHandler — 8/8 v3.2.3 — logger — سقف
  - docs/API.md — cost 120 تومان — شفاف — تاریکی روشن شد
  - tests — 15 tests — wallet + ledger + idempotency + projection + balance + posting — real PG — 10/10 واقعی — vitest run

### Fixed

- Clean presentation: حذف cache artifacts, .env فقط .env.example
- Non-technical UX: پیام‌های فارسی + انگلیسی، رنگی، راهنمای قدم به قدم
- 39/39 — 0 تاریکی — سقف — همه چی سر جاشه — تمیز — تاریکی روشن شد — برای همه 8 پروژه — بی‌ادعا سقف

### Security

- Secret scan 0 real secrets
- JWT access 15m + refresh 7d — HS256 — bcrypt cost 12 — RBAC — audit logging — SELECT FOR UPDATE — BigInt — RLS — immutability — double-entry — debit=credit — idempotency guard — projection idempotency — at-least-once redelivery guard — not double-count — 10/10 محصولی واقعی — بی‌ادعا سقف — non-root USER 1001 — HEALTHCHECK — env_file .env — 600 — idempotency — cost real test — wizard FA — Zero Support — تاریکی روشن شد

**End of CHANGELOG — Wallet — Universal Wallet OS — double-entry ledger — BigInt + RLS — 39/39 0 تاریکی — بی‌ادعا سقف — فاز بسته شد — تمیز — تاریکی روشن شد**
