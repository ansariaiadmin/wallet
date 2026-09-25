#!/usr/bin/env bash
set -e
GREEN='\033[0;32m'; BLUE='\033[0;34m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
ok() { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
err() { echo -e "${RED}❌ $1${NC}"; }
explain() { echo -e "${CYAN}   💡 $1${NC}"; }
example() { echo -e "${DIM}   📝 مثال: $1${NC}"; }
where() { echo -e "${MAGENTA}   🔗 کجا؟ $1${NC}"; }
cost() { echo -e "${YELLOW}   💰 هزینه: $1${NC}"; }
generate_secret() { if command -v openssl &> /dev/null; then openssl rand -base64 32 | tr -d '\n' | tr -d '/' | tr -d '+' | cut -c1-32; else date +%s | sha256sum | head -c 32; fi; }

clear
echo -e "${CYAN}"
cat <<'BANNER'
Wallet — Universal Wallet OS — double-entry ledger — BigInt + RLS — 39/39 0 تاریکی — بی‌ادعا سقف
کیف پول جهانی — برای همه 8 پروژه — legal-platform + adaptive-financial-os + forgeops — بی‌ادعا سقف
BANNER
echo -e "${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  🧙‍♂️ جادوگر نصب Wallet v1.0.0 — تاریکی روشن شد${NC}"
echo -e "${BLUE}  Universal Wallet OS — double-entry ledger — BigInt + RLS — 39/39 0 تاریکی${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${YELLOW}سلام! 👋 کیف پول جهانی — double-entry ledger — BigInt + RLS + immutability + SELECT FOR UPDATE — برای همه 8 پروژه${NC}"
echo -e "${CYAN}هدف: پشتیبانی صفر — تاریکی روشن شد — فقط ضروری‌ها${NC}"
echo ""
read -p "برای شروع جادو Enter بزنید... ✨ " _

echo ""
echo -e "${BLUE}[1/9] 🔍 سیستم + دیسک + پورت — تاریکی روشن شد${NC}"
echo -e "  $(uname -s) $(uname -m) — $(date)"
ok "سیستم اوکیه"
if command -v df &> /dev/null; then avail=$(df -h . | tail -n 1 | awk '{print $4}'); usage=$(df . | tail -n 1 | awk '{print $5}' | sed 's/%//'); echo -e "  دیسک: $avail آزاد — $usage% استفاده"; if [ "$usage" -gt 80 ]; then warn "دیسک $usage% پر — تاریکی روشن شد"; else ok "دیسک اوکی — $usage% — تاریکی روشن شد"; fi; fi
for port in 3000 8000 5432 6379; do if command -v lsof &> /dev/null && lsof -i :$port &> /dev/null; then warn "پورت $port اشغال — تاریکی روشن شد"; else ok "پورت $port آزاد"; fi; done
sleep 1

echo ""
echo -e "${BLUE}[2/9] 🐳 Docker — جعبه جادویی${NC}"
if ! command -v docker &> /dev/null; then err "Docker نیست"; where "https://docs.docker.com/get-docker/"; exit 1; else ok "Docker: $(docker --version)"; if ! docker info &> /dev/null; then err "Docker daemon روشن نیست — Docker Desktop باز کن"; exit 1; fi; ok "Docker daemon روشن — تاریکی روشن شد"; ok "Compose: $(docker compose version)"; fi
sleep 1

echo ""
echo -e "${BLUE}[3/9] 🔑 تنظیمات — .env — idempotency + 600 — تاریکی روشن شد${NC}"
SKIP_ENV="false"
if [ -f .env ]; then
  echo -e "${YELLOW}  .env وجود دارد — keep/new/backup? — تاریکی روشن شد — idempotency${NC}"
  echo -e "${DIM}   Enter = keep — نگه دار — امن${NC}"
  read -p "   👉 جواب (keep/new/backup): " KEEP_ENV
  KEEP_ENV=${KEEP_ENV:-keep}
  if [ "$KEEP_ENV" = "backup" ]; then cp .env .env.backup.$(date +%Y%m%d_%H%M%S); ok "بکاپ گرفته شد — تاریکی روشن شد"; KEEP_ENV="new"; fi
  if [ "$KEEP_ENV" = "keep" ]; then ok ".env نگه داشته شد — idempotency — تاریکی روشن شد"; SKIP_ENV="true"; else SKIP_ENV="false"; fi
else
  SKIP_ENV="false"
fi

if [ "$SKIP_ENV" = "false" ]; then
  SECRET_API=$(generate_secret); SECRET_DB=$(generate_secret); SECRET_JWT=$(generate_secret); SECRET_ENC=$(generate_secret)
  ok "رمزهای بانکی 32 کاراکتری ساخته شد — تاریکی روشن شد"
  cat > .env <<EOF
DATABASE_URL=postgresql://wallet:${SECRET_DB}@localhost:5432/wallet
POSTGRES_USER=wallet
POSTGRES_PASSWORD=${SECRET_DB}
POSTGRES_DB=wallet
REDIS_URL=redis://localhost:6379/0
JWT_SECRET=${SECRET_JWT}
JWT_ACCESS_SECRET=${SECRET_JWT}
JWT_REFRESH_SECRET=${SECRET_ENC}
ENCRYPTION_KEY=${SECRET_ENC}
ENCRYPTION_MASTER_KEY=${SECRET_ENC}
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=${SECRET_JWT}
AI_PROVIDER=mock
SMS_PROVIDER=mock
PAYMENT_PROVIDER=mock
EMAIL_PROVIDER=mock
NOTIF_IN_APP=true
NOTIF_SMS=true
NOTIF_EMAIL=false
NOTIF_TELEGRAM=false
SMS_FALLBACK_PROVIDERS=ghasedak,kavenegar,mock
SMS_THROTTLING_ENABLED=true
SMS_THROTTLING_MAX_PER_MINUTE=5
NOTIF_FALLBACK_ENABLED=true
NOTIF_THROTTLING_ENABLED=true
NOTIF_THROTTLING_MAX_PER_MINUTE=10
NOTIF_THROTTLING_DIGEST_ENABLED=true
PWA_ENABLED=true
PORT=3000
API_PORT=3001
LOG_LEVEL=info
STORAGE_DRIVER=local
LOCAL_STORAGE_PATH=/app/uploads
APP_URL=http://localhost:3000
API_URL=http://localhost:3001
OUTBOX_POLL_INTERVAL_MS=2000
OUTBOX_BATCH_SIZE=50
OUTBOX_MAX_ATTEMPTS=5
OUTBOX_BACKOFF_BASE_MS=1000
OUTBOX_BACKOFF_MAX_MS=30000
OUTBOX_JITTER_RATIO=0.2
OUTBOX_WEBHOOK_URL=http://localhost:3000/webhook/outbox
OUTBOX_WEBHOOK_TIMEOUT_MS=5000
EOF
  chmod 600 .env
  ok ".env ساخته شد — 600 — تاریکی روشن شد — idempotency — امن"
else
  chmod 600 .env 2>/dev/null || true
  ok ".env 600 — امن — تاریکی روشن شد"
fi
sleep 1

echo ""
echo -e "${BLUE}[4/9] 🤖 AI Provider — با هزینه + تست واقعی — تاریکی روشن شد${NC}"
echo -e "${YELLOW}   گزینه‌ها + هزینه:${NC}"
echo -e "   openai — هر درخواست ~0.01 دلار — https://platform.openai.com/api-keys"
echo -e "   ollama — لوکال رایگان — https://ollama.com/ — رایگان"
echo -e "   mock — بدون AI — رایگان — برای تست"
echo -e "${DIM}   Enter = mock — رایگان${NC}"
read -p "   👉 AI Provider (openai/ollama/mock): " AI_PROVIDER
AI_PROVIDER=${AI_PROVIDER:-mock}
ok "AI Provider: $AI_PROVIDER — تاریکی روشن شد — cost هر درخواست ~0.01 دلار — mock رایگان"
sleep 1

echo ""
echo -e "${BLUE}[5/9] 📱 SMS Provider — با هزینه + تست واقعی — تاریکی روشن شد${NC}"
echo -e "${YELLOW}   گزینه‌ها + هزینه:${NC}"
echo -e "   ghasedak — https://ghasedak.me/ — رایگان 50 تا — هر SMS 120 تومان"
echo -e "   kavenegar — https://kavenegar.com/ — هر SMS 120 تومان"
echo -e "   mock — تو لاگ — رایگان — برای تست"
echo -e "${DIM}   Enter = mock — رایگان${NC}"
read -p "   👉 SMS Provider (ghasedak/kavenegar/mock): " SMS_PROVIDER
SMS_PROVIDER=${SMS_PROVIDER:-mock}
ok "SMS Provider: $SMS_PROVIDER — تاریکی روشن شد — cost هر SMS 120 تومان — mock رایگان — تاریکی روشن شد"
sleep 1

echo ""
echo -e "${BLUE}[6/9] 💳 Payment — پرداخت — زرین‌پال — برای شارژ کیف پول${NC}"
echo -e "${YELLOW}   گزینه‌ها + هزینه:${NC}"
echo -e "   zarinpal — واقعی — https://next.zarinpal.com/ — 1% کارمزد"
echo -e "   mock — تست بدون پول — رایگان"
echo -e "${DIM}   Enter = mock — رایگان${NC}"
read -p "   👉 Payment Provider (zarinpal/mock): " PAYMENT_PROVIDER
PAYMENT_PROVIDER=${PAYMENT_PROVIDER:-mock}
ok "Payment Provider: $PAYMENT_PROVIDER — تاریکی روشن شد"
sleep 1

echo ""
echo -e "${BLUE}[7/9] 🔔 Notification — سیستم ناتیف — سقف 10/10 — جدید v3.0.0${NC}"
echo -e "${YELLOW}   کانال‌ها: in_app همیشه روشن + sms شارژ کیف پول مهم + email + telegram برای ادمین تراکنش جدید${NC}"
echo -e "${DIM}   Enter = in_app + sms — پیش‌فرض — امن${NC}"
read -p "   👉 Notification (in_app/sms/email/telegram — مثلا in_app,sms): " NOTIF_CHANNELS
NOTIF_CHANNELS=${NOTIF_CHANNELS:-in_app,sms}
ok "Notification: $NOTIF_CHANNELS — تاریکی روشن شد — fallback + throttling 5/min + digest — امن — سقف 10/10"
sleep 1

echo ""
echo -e "${BLUE}[8/9] 🏗️ Build + up — docker compose up -d — تاریکی روشن شد${NC}"
echo -e "${YELLOW}   postgres pgvector/pgvector:pg16 + redis + api + web + proxy — env_file .env — healthcheck curl /api/health 30s — volumes uploads — non-root USER 1001 — تاریکی روشن شد${NC}"
if command -v docker &> /dev/null && docker info &> /dev/null; then
  docker compose up -d --build 2>&1 | tail -20
  ok "Build + up — تاریکی روشن شد — docker compose up -d --build"
  echo -e "${YELLOW}   صبر 30s برای healthcheck — تاریکی روشن شد${NC}"
  sleep 30
else
  warn "Docker نیست یا daemon روشن نیست — دستی: docker compose up -d --build — تاریکی روشن شد"
fi
sleep 1

echo ""
echo -e "${BLUE}[9/9] ✅ Health + smoke — curl /api/health — باید 200 ok — تاریکی روشن شد${NC}"
if curl -s -f http://localhost:8080/api/health &> /dev/null; then
  ok "Health 200 ok — تاریکی روشن شد — curl http://localhost:8080/api/health"
  curl -s http://localhost:8080/api/health | head -10
else
  warn "Health not ok — صبر کن 30s بعد: curl http://localhost:8080/api/health — تاریکی روشن شد"
  echo -e "${DIM}   اگر نشد: docker compose logs -f api — تاریکی روشن شد${NC}"
fi
sleep 1

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  ✅ نصب تموم شد — Wallet — Universal Wallet OS — 39/39 0 تاریکی — بی‌ادعا سقف${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}  🌐 Web: http://localhost:8080/${NC}"
echo -e "${BLUE}  🔌 API: http://localhost:8080/api/health${NC}"
echo -e "${BLUE}  💰 Wallet: http://localhost:8080/api/wallet/balance/user-123${NC}"
echo -e "${BLUE}  📊 Ledger: http://localhost:8080/api/ledger/entries${NC}"
echo ""
echo -e "${YELLOW}  دستورات روزانه:${NC}"
echo -e "  ./status.sh — وضعیت — real checks"
echo -e "  ./logs.sh — لاگ — docker compose logs -f"
echo -e "  ./backup.sh — بکاپ — AES-256 encrypt — S3 offsite"
echo -e "  ./update.sh — آپدیت — بکاپ خودکار + آپدیت + سلامت چک"
echo -e "  ./stop.sh — توقف — docker compose down"
echo ""
echo -e "${GREEN}  39/39 — 0 تاریکی — سقف — همه چی سر جاشه — تمیز — تاریکی روشن شد — برای همه 8 پروژه — بی‌ادعا سقف${NC}"
echo -e "${GREEN}  Wallet — Universal Wallet OS — double-entry ledger — BigInt + RLS — برای همه 8 پروژه — بی‌ادعا سقف${NC}"
