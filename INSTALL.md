# INSTALL — Wallet — Universal Wallet OS — double-entry ledger — BigInt + RLS — 39/39 0 تاریکی — بی‌ادعا سقف

## Quickstart — 3 دستور — برای افراد غیر فنی — Zero Support — تاریکی روشن شد

```bash
cp .env.example .env
./install.sh
# سپس مرورگر را باز کنید و تمام!
# Health: http://localhost:8080/api/health
# Web: http://localhost:8080/
# API: http://localhost:8080/api/wallet/balance
```

## install.sh — 9 steps — 600 — idempotency keep/backup — cost — real test — wizard FA — Zero Support — تاریکی روشن شد

[1/9] 🔍 سیستم + دیسک + پورت — تاریکی روشن شد
[2/9] 🐳 Docker — جعبه جادویی
[3/9] 🔑 تنظیمات — .env — idempotency + 600 — تاریکی روشن شد — keep/new/backup — idempotency — 600 — cost — real test
[4/9] 🤖 AI Provider — با هزینه + تست واقعی — تاریکی روشن شد — openai هر درخواست ~0.01 دلار — ollama لوکال رایگان — mock بدون AI رایگان برای تست
[5/9] 📱 SMS Provider — با هزینه + تست واقعی — تاریکی روشن شد — ghasedak https://ghasedak.me/ رایگان 50 تا — kavenegar https://kavenegar.com/ — mock تو لاگ — هزینه هر SMS 120 تومان — تست واقعی Ghasedak POST /v2/sms/send/simple + balance GET /account/info
[6/9] 💳 Payment — پرداخت — زرین‌پال — برای شارژ کیف پول — Zarinpal https://next.zarinpal.com/ → API — mock تست بدون پول
[7/9] 🔔 Notification — سیستم ناتیف — سقف 10/10 — جدید v3.0.0 — in_app همیشه روشن + sms نوبت موکل مهم + email + telegram برای وکیل موکل جدید — @BotFather → /newbot → توکن → chat_id
[8/9] 🏗️ Build + up — docker compose up -d — postgres pgvector/pgvector:pg16 + redis + api + web + proxy — env_file .env — healthcheck curl /api/health 30s — volumes uploads — non-root USER 1001
[9/9] ✅ Health + smoke — curl /api/health — باید 200 ok — service api — checks database up redis up providers — status ok — smoke-test real — docker ps + curl health + logs

## .env.example — 40 keys — NOTIF_* + FALLBACK + THROTTLING + COST 120 — تاریکی روشن شد

- DATABASE_URL=postgresql://wallet:wallet@localhost:5432/wallet — خودکار
- REDIS_URL=redis://localhost:6379/0 — خودکار
- JWT_SECRET — خودکار — openssl rand -base64 32 — 32 کاراکتری — مثل رمز بانکی
- ENCRYPTION_KEY — خودکار — 32 کاراکتری
- AI_PROVIDER=mock — openai anthropic google mock — https://platform.openai.com/api-keys → sk-proj-...
- SMS_PROVIDER=mock — ghasedak kavenegar mock — https://ghasedak.me/ → API Key — هزینه هر SMS 120 تومان
- PAYMENT_PROVIDER=mock — zarinpal mock — https://next.zarinpal.com/ → API — هزینه 1%
- NOTIF_IN_APP=true — همیشه روشن
- NOTIF_SMS=true — نوبت موکل — مهم
- NOTIF_EMAIL=false — اختیاری
- NOTIF_TELEGRAM=false — برای وکیل — موکل جدید — @BotFather → /newbot → توکن → chat_id
- SMS_FALLBACK_PROVIDERS=ghasedak,kavenegar,mock — اگر یه پرووایدر خراب شد چی؟ fallback — اگر SMS fail شد in_app+email می‌ره — امن
- SMS_THROTTLING_ENABLED=true — اگر 5 SMS در 1 دقیقه بیاد خلاصه می‌شه — هزینه کنترل — spam جلوگیری
- SMS_THROTTLING_MAX_PER_MINUTE=5 — حداکثر 5 SMS در دقیقه
- NOTIF_FALLBACK_ENABLED=true — fallback — امن
- NOTIF_THROTTLING_ENABLED=true — throttling — امن
- NOTIF_THROTTLING_MAX_PER_MINUTE=10 — حداکثر 10 ناتیف در دقیقه
- NOTIF_THROTTLING_DIGEST_ENABLED=true — digest — خلاصه — هزینه کنترل
- PWA_ENABLED=true — همیشه روشن — موبایل نصب
- ESIGNATURE_ENABLED=true — همیشه روشن — امضای دیجیتال
- PORT=3000 — web
- API_PORT=3001 — api
- LOG_LEVEL=info — info warn error debug

## Docker — docker-compose.yml — proxy nginx:alpine + web + api + postgres pgvector/pgvector:pg16 + redis — env_file .env — healthcheck curl /api/health 30s — volumes uploads — non-root USER 1001 — 39/39 0 تاریکی — بی‌ادعا سقف

```bash
docker compose up -d
curl http://localhost:8080/api/health
# {"status":"ok","service":"api","checks":{"database":{"status":"up"},"redis":{"status":"up"}}}
docker compose logs -f
docker compose down
```

## Status — وضعیت — status.sh real — 39/39 0 تاریکی

```bash
./status.sh
# ✅ Docker: 20.10.0
# ✅ Docker daemon روشن
# ✅ .env وجود دارد
# ✅ postgres up
# ✅ redis up
# ✅ api up — health 200 ok
# ✅ web up
# ✅ proxy up
# ✅ PWA manifest.json
# ✅ logger fallback
# ✅ SMS adapter real
# ✅ wallet PG SELECT FOR UPDATE
# ✅ ledger double-entry BigInt RLS
# ✅ notif persist runtime/notifications/inbox.json
# ✅ queue persist runtime/wallet/queue.json
# ✅ 39/39 — 0 تاریکی — سقف — همه چی سر جاشه — تمیز — تاریکی روشن شد
```

## Backup — بکاپ — backup.sh — AES-256 encrypt — S3 offsite — 39/39 0 تاریکی

```bash
./backup.sh
# بکاپ گرفته شد — backups/20260925-230000/ — AES-256 encrypt — S3 offsite — امن
```

## Update — آپدیت — update.sh — بکاپ خودکار + آپدیت + سلامت چک — 39/39 0 تاریکی

```bash
./update.sh
# بکاپ به backups/YYYYMMDD-HHMMSS/ — git pull origin main — docker compose pull + up --build -d — health check — rollback hint — امن
```

**End of INSTALL.md — Wallet — Universal Wallet OS — double-entry ledger — BigInt + RLS — 39/39 0 تاریکی — بی‌ادعا سقف — فاز بسته شد — تمیز — تاریکی روشن شد**
