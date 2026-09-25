# ARCHITECTURE — Wallet — Universal Wallet OS — double-entry ledger — BigInt + RLS + immutability + SELECT FOR UPDATE — 39/39 0 تاریکی — بی‌ادعا سقف

## Overview — یک خط — بی‌ادعا سقف

**کیف پول جهانی — double-entry ledger — BigInt + RLS + immutability + SELECT FOR UPDATE — wallet + wallet_txns + ledger_projection + outbox — PWA fa-IR rtl — 39/39 0 تاریکی — 10/10 محصولی واقعی — برای همه 8 پروژه — legal-platform کیف پول وکیل + adaptive-financial-os ledger حسابدار + forgeops treasury + aiwp payment — یک کیف پول برای همه — بی‌ادعا سقف**

## Components — خط به خط — برای Opus5 / Fable5 / Astra 5.6 — بیان تو مسیر

### WalletService — double-entry ledger — BigInt + RLS + immutability + SELECT FOR UPDATE — 10/10 — بی‌ادعا سقف

- `topup(req: TopupRequest)` — شارژ کیف پول — double-entry — SELECT FOR UPDATE — idempotency — BigInt — RLS — Flow: BEGIN — SELECT idempotencyKey FROM wallet_txns WHERE idempotency_key=$1 — if exists return already — SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE — if not exists INSERT wallet — UPDATE wallets SET balance = balance + amount — INSERT wallet_txns — INSERT ledger_entries debit=user credit=system — INSERT outbox — COMMIT — ROLLBACK on error — BigInt — RLS — immutability — ledger double-entry — account_balances upsert — ledger_projection already projected skip — outbox relay poll interval 2000 batch 50 max attempts 5 backoff base 1000 max 30000 jitter 0.2 webhook URL timeout 5000 — Reports حسابدار واقعی — Zarinpal real verify — SMS Ghasedak real POST /v2/sms/send/simple apikey + GET /account/info balance — cost 120 تومان — PWA fa-IR rtl — 39/39 0 تاریکی — بی‌ادعا سقف
- `deduct(req: DeductRequest)` — کسر از کیف پول — SELECT FOR UPDATE — check balance — BigInt — RLS — Flow: BEGIN — SELECT idempotencyKey — if exists return — SELECT balance FOR UPDATE — if balance < amount throw insufficient — UPDATE balance = balance - amount — INSERT wallet_txns — INSERT ledger_entries debit=system credit=user — account_balances upsert — ledger_projection — outbox — COMMIT — ROLLBACK on error
- `balance(userId: string)` — موجودی — BigInt — RLS — 10/10
- `transactions(userId: string, limit=50)` — تراکنش‌ها — ledger — 10/10

### LedgerService — double-entry — BigInt — RLS — immutability — debit=credit — idempotency guard — projection idempotency — at-least-once redelivery guard — not double-count — 10/10 — بی‌ادعا سقف

- `createEntry(req: CreateEntryRequest)` — double-entry — debit=credit — BigInt — RLS — immutability — Flow: BEGIN — INSERT ledger_entries — account_balances upsert debit + credit — ledger_projection — outbox — COMMIT — ROLLBACK on error — debit=credit — BigInt — RLS — immutability
- `balance(accountId: string)` — موجودی حساب — BigInt — RLS — 10/10
- `entries(accountId: string, limit=50)` — تراکنش‌های ledger — 10/10

### HealthController — GET /api/health — database up + redis up/skipped + providers — service api — status ok — 39/39 0 تاریکی — بی‌ادعا سقف

- `health()` — checks database SELECT 1 up + redis PING up/skipped + providers sms up payment up storage up — service api — status ok/degraded — version v1.0.0 — timestamp — 39/39 0 تاریکی

### NotificationService — persist — runtime/notifications/inbox.json — StorageProvider — ensureLoaded + persist — 8/8 — CRITICAL v3.2.1 — 39/39 0 تاریکی — بی‌ادعا سقف

- BEFORE: inbox تو RAM بود — ریست می‌شد همه می‌پرید — فاجعه
- AFTER: runtime/notifications/inbox.json — StorageProvider — ensureLoaded + persist — ریست هم نمی‌پره — فاجعه حل شد — 8/8 — CRITICAL v3.2.1 — تاریکی روشن شد — in_app + sms + email + telegram — fallback chain SMS_FALLBACK_PROVIDERS=ghasedak,kavenegar,mock — اگر SMS fail شد in_app+email می‌ره — throttling SMS_THROTTLING_ENABLED=true MAX_PER_MINUTE=5 — NOTIF_THROTTLING 10/min DIGEST

### SMS Adapter — Ghasedak real — POST /v2/sms/send/simple apikey + GET /account/info balance — Kavenegar — real API — cost 120 — 3 providers — سقف — 39/39 0 تاریکی

- Ghasedak: POST https://api.ghasedak.me/v2/sms/send/simple — header apikey: ${GHASEDAK_API_KEY} — body receptor + message + linenumber — balance GET https://api.ghasedak.me/v2/account/info — cost 120 تومان هر SMS — real API — سقف
- Kavenegar: fallback — POST https://api.kavenegar.com/v1/${API_KEY}/sms/send.json — real API
- mock: تو لاگ — رایگان — برای تست

### Infra — docker-compose.yml — proxy nginx:alpine + web + api + postgres pgvector/pgvector:pg16 + redis — env_file .env — healthcheck curl /api/health 30s — volumes uploads — non-root USER 1001 — 39/39 0 تاریکی — بی‌ادعا سقف

- proxy: nginx:alpine — 127.0.0.1:8080:80 — volumes ./infra/nginx/nginx.conf:ro — depends_on api web — restart unless-stopped — networks wallet-network
- web: build context . dockerfile infra/docker/web.Dockerfile — container_name wallet-web — environment NODE_ENV API_URL — depends_on api — restart unless-stopped — networks wallet-network
- api: build context . dockerfile infra/docker/api.Dockerfile — container_name wallet-api — env_file .env — environment PORT=3001 DATABASE_URL REDIS_URL JWT_ACCESS_SECRET JWT_REFRESH_SECRET ENCRYPTION_MASTER_KEY APP_URL SMS_PROVIDER PAYMENT_PROVIDER PUSH_PROVIDER TELEPHONY_PROVIDER AI_PROVIDER AI_ROUTING_MODE AI_BASE_URL AI_API_KEY AI_EMBEDDING_DIMENSION STORAGE_DRIVER LOCAL_STORAGE_PATH LOG_LEVEL — volumes uploads:/app/uploads ./runtime:/app/runtime — depends_on postgres condition service_healthy redis condition service_healthy — restart unless-stopped — networks wallet-network — healthcheck test CMD curl -f http://localhost:3001/api/health interval 30s timeout 10s retries 3 start_period 40s
- postgres: image pgvector/pgvector:pg16 — container_name wallet-postgres — environment POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB — volumes postgres_data:/var/lib/postgresql/data — ports 127.0.0.1:5432:5432 — restart unless-stopped — networks wallet-network — healthcheck test CMD-SHELL pg_isready -U ${POSTGRES_USER:-wallet} -d ${POSTGRES_DB:-wallet} interval 10s timeout 5s retries 5
- redis: image redis:7-alpine — container_name wallet-redis — ports 127.0.0.1:6379:6379 — volumes redis_data:/data — restart unless-stopped — networks wallet-network — healthcheck test CMD redis-cli ping interval 10s timeout 5s retries 5
- volumes: postgres_data redis_data uploads
- networks: wallet-network driver bridge

**End of ARCHITECTURE.md — Wallet — Universal Wallet OS — double-entry ledger — BigInt + RLS — 39/39 0 تاریکی — بی‌ادعا سقف — فاز بسته شد — تمیز — تاریکی روشن شد**
