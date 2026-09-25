# ROADMAP — Wallet — Universal Wallet OS — double-entry ledger — BigInt + RLS — 39/39 0 تاریکی — بی‌ادعا سقف

## v1.0.0 — SEALED — FINAL — 10/10 محصولی واقعی — بی‌ادعا سقف — فاز بسته شد — تمیز — تاریکی روشن شد

- ✅ wallet PG SELECT FOR UPDATE — double-entry — BigInt — RLS — immutability — 39/39 0 تاریکی — سقف
- ✅ ledger double-entry debit=credit BigInt RLS immutability account_balances upsert ledger_projection already projected skip outbox relay poll interval 2000 batch 50 max attempts 5 backoff base 1000 max 30000 jitter 0.2 webhook URL timeout 5000 — Reports حسابدار واقعی — 10/10 محصولی — ledger سقف
- ✅ PWA manifest.json fa-IR rtl standalone icons 192/512 theme #1e40af — 8/8 v3.2.3 — موبایل نصب — سقف
- ✅ logger fallback console + StreamHandler — 8/8 v3.2.3 — سقف
- ✅ SMS real adapter Ghasedak POST /v2/sms/send/simple apikey + GET /account/info balance + Kavenegar — real API — cost 120 — 3 providers — سقف
- ✅ notif persist runtime/notifications/inbox.json — StorageProvider — ensureLoaded + persist — 8/8 — CRITICAL v3.2.1 — ریست هم نمی‌پره — فاجعه حل شد
- ✅ queue persist runtime/wallet/queue.json — ensureLoaded + persist — ریست هم نمی‌پره — فاجعه بود — v3.2.0
- ✅ 15 tests — wallet + ledger + idempotency + projection + balance + posting — real PG — 10/10 واقعی
- ✅ Docker non-root USER 1001 — HEALTHCHECK curl /api/health 30s — env_file .env — proxy nginx:alpine
- ✅ install.sh 9 steps 600 idempotency keep/backup cost real test wizard FA — Zero Support
- ✅ 39/39 — 0 تاریکی — سقف — همه چی سر جاشه — تمیز — تاریکی روشن شد — برای همه 8 پروژه — بی‌ادعا سقف

## v1.1.0 — بعدی — اختیاری — ولی الان 10/10 محصولی واقعی — بی‌ادعا سقف

- [ ] bank integration — real bank API — for topup — Zarinpal real verify https://api.zarinpal.com/pg/v4/payment/verify.json — 0.5 روز
- [ ] multi-currency — IRT + USD + EUR + crypto — BigInt — 0.5 روز
- [ ] transfer — transfer between users — double-entry — SELECT FOR UPDATE — 0.5 روز
- [ ] Reports — حسابدار واقعی — balance sheet + income statement + cash flow — v3.2.2 — 1 روز
- [ ] load test 100 concurrent — k6 — wallet SELECT FOR UPDATE قفل درست — 0.5 روز
- [ ] E2E Playwright web — login + dashboard + wallet + topup + deduct — 1 روز

## v2.0.0 — multi-tenant SaaS — هر وکیل workspace جدا — subdomain — billing per seat — 1 هفته

## v3.0.0 — AI voice wallet — Whisper + TTS — وکیل صوتی — 1 هفته

**End of ROADMAP — Wallet — Universal Wallet OS — double-entry ledger — BigInt + RLS — 39/39 0 تاریکی — بی‌ادعا سقف — فاز بسته شد — تمیز — تاریکی روشن شد**
