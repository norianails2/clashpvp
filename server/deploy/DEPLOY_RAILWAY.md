# =====================================================
# ДЕПЛОЙ Clash PVP НА RAILWAY (WebSocket + Dockerfile)
# =====================================================

# 1) Залить код на GitHub (если ещё не залито)
#    Создайте репозиторий на github.com, затем локально:
git init
git add .
git commit -m "init clashpvp"
git remote add origin https://github.com/ВАШ_АККАУНТ/clashpvp.git
git branch -M main
git push -u origin main

# 2) Создать сервис на Railway
#    - Зайдите на railway.app и войдите через GitHub
#    - New Project -> Deploy from GitHub repo -> выберите clashpvp
#    - Railway автоматически найдёт server/Dockerfile (укажите
#      Root Directory = server, если попросит)

# 3) Переменные окружения (Settings -> Variables) НАСТРОЙТЕ ТАК:
#    PORT=3001
#    NODE_ENV=production
#    DATABASE_URL=postgresql://neondb_owner:...@ep-...neon.tech/neondb?sslmode=require
#    BOT_TOKEN=ВАШ_ТЕЛЕГРАМ_ТОКЕН
#    JWT_SECRET=длинная_случайная_строка
#    MINI_APP_URL=https://clashpvp-production.up.railway.app   <- замените на ваш railway-домен
#    CLIENT_ORIGIN=https://clashpvp-production.up.railway.app

# 4) Домен
#    - Settings -> Networking -> Generate Domain
#    - Полученный URL (например https://clashpvp-production.up.railway.app)
#      впишите в MINI_APP_URL и CLIENT_ORIGIN
#    - ВАЖНО: telegramBot.js использует MINI_APP_URL в кнопке «Открыть мини-апп»

# 5) Проверка
#    curl https://ВАШ-ДОМЕН.railway.app/health
#    -> {"status":"ok",...}

# 6) Только один экземпляр бота!
#    Telegram позволяет только одному процессу слушать getUpdates.
#    Остановите ЛОКАЛЬНЫЙ сервер (npm run start на вашем ПК),
#    иначе на Railway бот будет падать с 409 Conflict.

# =====================================================
# Обновление кода после изменений
# =====================================================
git add .
git commit -m "update"
git push
# Railway передеплоит автоматически

# Логи / рестарт
# Railway Dashboard -> сервис -> Deployments / Logs
