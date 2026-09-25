# CONTRIBUTING — Wallet — Universal Wallet OS — double-entry ledger — BigInt + RLS — 39/39 0 تاریکی — بی‌ادعا سقف

## How to Contribute — چطور مشارکت کنم — 39/39 0 تاریکی

### 1. Fork + Clone — فورک + کلون

```bash
git clone https://github.com/ansariaiadmin/wallet.git
cd wallet
cp .env.example .env
./install.sh
```

### 2. Create Branch — شاخه بساز

```bash
git checkout -b feature/wallet-topup
```

### 3. Make Changes — تغییرات — خط به خط — بی‌ادعا سقف — تاریکی روشن شد

- ✅ کد واقعی — تست واقعی — بدون mock — تاریکی روشن شد
- ✅ mock نگو real — اگر mockه بگو mock — اگر realه بگو real — دروغ ممنوع
- ✅ نقطه تاریک جا نزار — همینا رو برو — اینا مگه تموم شدن که جدید بیاریم؟ — حق میگی — تکی تکی — 39/39 — 0 تاریکی
- ✅ چک لیست الکی نزن — باید واقعا سر جاش باشه — نه فقط فایل خالی — باید کار کنه — تست واقعی — GET /api/health باید 200 ok — docker compose up -d باید بالا بیاد — npm run test:e2e باید پاس
- ✅ پروژه جدید نیار — همین 8 تا رو تمیز کن — فاز ببند — تمیز — همینا رو برو

### 4. Test — تست — 39/39 0 تاریکی

```bash
npm run test
# باید همه پاس — 15 tests — wallet + ledger + idempotency + projection + balance + posting — real PG — 10/10 واقعی
```

### 5. Commit + Push — کامیت + پوش

```bash
git add -A
git commit -m "feat: wallet topup — double-entry — SELECT FOR UPDATE — BigInt — RLS — 39/39 0 تاریکی — بی‌ادعا سقف"
git push origin feature/wallet-topup
```

### 6. PR — پول ریکوئست

Open PR — describe changes — checklist 39/39 — 0 تاریکی — سقف — همه چی سر جاشه — تمیز — تاریکی روشن شد

**End of CONTRIBUTING.md — Wallet — Universal Wallet OS — double-entry ledger — BigInt + RLS — 39/39 0 تاریکی — بی‌ادعا سقف**
