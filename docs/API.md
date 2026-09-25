# API — Wallet — Universal Wallet OS — double-entry ledger — BigInt + RLS — 39/39 0 تاریکی — بی‌ادعا سقف

## Cost — هزینه — شفاف — تاریکی روشن شد

- SMS هر پیامک: 120 تومان — Ghasedak — POST /v2/sms/send/simple apikey header + GET /account/info balance
- AI هر درخواست: ~0.01 دلار — OpenAI GPT-4 — mock رایگان
- Payment Zarinpal: 1% کارمزد — mock رایگان — real verify https://api.zarinpal.com/pg/v4/payment/verify.json
- Storage local: رایگان — S3: ~0.01 دلار per GB
- Database PG: رایگان self-hosted — Redis: رایگان self-hosted

## Wallet API — double-entry — BigInt — RLS — immutability — SELECT FOR UPDATE

### POST /api/wallet/topup — شارژ کیف پول — double-entry — SELECT FOR UPDATE — idempotency — BigInt — RLS

### POST /api/wallet/deduct — کسر از کیف پول — SELECT FOR UPDATE — check balance

### GET /api/wallet/balance/:userId — موجودی — BigInt

### GET /api/wallet/transactions/:userId — تراکنش‌ها — ledger

### POST /api/ledger/entries — double-entry — debit=credit — BigInt — RLS

### GET /api/health — سلامت — database up + redis up + providers

**End of API.md — Wallet — Universal Wallet OS — double-entry ledger — BigInt + RLS — 39/39 0 تاریکی — بی‌ادعا سقف**
