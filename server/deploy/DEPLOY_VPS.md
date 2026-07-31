# =====================================================
# ДЕПЛОЙ Clash PVP НА VPS (Ubuntu 22.04 / 24.04)
# =====================================================

# 1) Подготовка сервера (выполняется один раз по SSH)
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx certbot python3-certbot-nginx git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

# 2) Забрать код на сервер
cd /opt
sudo mkdir -p clashpvp && sudo chown $USER:$USER clashpvp
cd clashpvp
# скопируйте папку server/ с локальной машины (scp) или через git
scp -r -P 22 ./server ubuntu@ВАШ_IP:/opt/clashpvp/

# 3) Установить зависимости и создать .env
cd /opt/clashpvp/server
npm ci --omit=dev
cp .env.example .env
nano .env
#   PORT=3001
#   NODE_ENV=production
#   DATABASE_URL=postgresql://neondb_owner:...@ep-...neon.tech/neondb?sslmode=require
#   BOT_TOKEN=ВАШ_ТОКЕН
#   JWT_SECRET=случайная_строка
#   MINI_APP_URL=https://ВАШ_ДОМЕН
#   CLIENT_ORIGIN=https://ВАШ_ДОМЕН

# 4) Запуск через PM2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # выполнить команду, которую он выведет

# 5) Nginx + SSL
sudo cp deploy/nginx-clashpvp.conf /etc/nginx/sites-available/clashpvp
# ВАЖНО: замените example.com на ваш домен в /etc/nginx/sites-available/clashpvp
sudo nano /etc/nginx/sites-available/clashpvp
sudo ln -s /etc/nginx/sites-available/clashpvp /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# 6) Сертификат Let's Encrypt
sudo certbot --nginx -d ВАШ_ДОМЕН

# 7) Проверка
curl https://ВАШ_ДОМЕН/health   # -> {"status":"ok",...}

# =====================================================
# Полезные команды PM2
# =====================================================
pm2 logs clashpvp        # логи
pm2 restart clashpvp     # рестарт
pm2 status               # статус
