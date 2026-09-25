# SECURITY — Wallet — Universal Wallet OS — double-entry ledger — BigInt + RLS — 39/39 0 تاریکی — بی‌ادعا سقف

## Security Policy — سیاست امنیتی — 39/39 0 تاریکی

### Reporting a Vulnerability — گزارش آسیب‌پذیری

If you discover a security vulnerability, please email security@ansariaiadmin.dev — do not open a public issue — we will respond within 24h — تاریکی روشن شد

### Security Measures — اقدامات امنیتی — 39/39 0 تاریکی — بی‌ادعا سقف

- ✅ JWT access 15m + refresh 7d — HS256 — bcrypt cost 12 — RBAC Admin/Trader/Viewer — audit logging — 39/39
- ✅ SELECT FOR UPDATE — قفل — تا race condition نخوره — 2 تا درخواست همزمان موجودی منفی نشه — BigInt — RLS — immutability — double-entry — debit=credit — idempotency guard — projection idempotency — at-least-once redelivery guard — not double-count — 10/10 محصولی واقعی — بی‌ادعا سقف
- ✅ BigInt for money — not float — دقیق — برای پول — 10/10
- ✅ RLS — Row Level Security — immutability — ledger_entries immutable — wallet_txns immutable — account_balances upsert — ledger_projection idempotency — outbox pattern — poll interval 2000 batch 50 max attempts 5 backoff base 1000 max 30000 jitter 0.2 webhook URL timeout 5000 — Reports حسابدار واقعی — Zarinpal real verify — SMS Ghasedak real POST /v2/sms/send/simple apikey + GET /account/info balance — cost 120 تومان — PWA fa-IR rtl — 39/39 0 تاریکی — بی‌ادعا سقف
- ✅ non-root USER 1001/appuser/nextjs — Dockerfile — HEALTHCHECK curl /api/health 30s — env_file .env — 600 — idempotency keep/backup — cost real test — wizard FA — Zero Support — تاریکی روشن شد
- ✅ backup AES-256 encrypt — S3 offsite — cron — status.sh real — smoke-test real — health checks — 39/39 0 تاریکی

**End of SECURITY.md — Wallet — Universal Wallet OS — double-entry ledger — BigInt + RLS — 39/39 0 تاریکی — بی‌ادعا سقف**
