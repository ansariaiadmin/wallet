# AGENTS — Wallet — Universal Wallet OS — double-entry ledger — BigInt + RLS — 39/39 0 تاریکی — بی‌ادعا سقف

## Wallet Agent — کیف پول جهانی — برای همه 8 پروژه

**Wallet Agent — double-entry ledger — BigInt + RLS + immutability + SELECT FOR UPDATE — برای همه 8 پروژه — legal-platform کیف پول وکیل + adaptive-financial-os ledger حسابدار + forgeops treasury + aiwp payment — یک کیف پول برای همه — بی‌ادعا سقف**

### Skills:

- `wallet:topup` — شارژ کیف پول — double-entry — SELECT FOR UPDATE — idempotency — BigInt — RLS — score >0.4 — برای شارژ کیف پول
- `wallet:deduct` — کسر از کیف پول — SELECT FOR UPDATE — check balance — BigInt — RLS — score >0.4 — برای کسر از کیف پول
- `wallet:balance` — موجودی — BigInt — RLS — score >0.4 — برای موجودی
- `wallet:transactions` — تراکنش‌ها — ledger — score >0.4 — برای تراکنش‌ها
- `ledger:entry` — double-entry — debit=credit — BigInt — RLS — immutability — score >0.4 — برای ledger entry
- `ledger:balance` — موجودی حساب — BigInt — RLS — score >0.4 — برای موجودی حساب

### Flow:

- `route(task)` — skillId + score >0.4 — برای تشخیص نیاز کیف پول
- `executor(task, routed)` — output فارسی با مواد قانونی — wallet + ledger — BigInt — RLS — immutability — double-entry — idempotency guard — projection idempotency — at-least-once redelivery guard — not double-count — 10/10 محصولی واقعی — بی‌ادعا سقف

**End of AGENTS.md — Wallet — Universal Wallet OS — double-entry ledger — BigInt + RLS — 39/39 0 تاریکی — بی‌ادعا سقف**
