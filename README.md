# Arcanum

Облачное хранилище с нулевым разглашением. Файлы и их имена шифруются в браузере,
сервер хранит только шифротекст

## Запуск в Docker

```bash
cp .env.example .env   # заполнить SECRET_KEY и POSTGRES_PASSWORD (и тот же пароль в DATABASE_URL)
docker compose up --build
```

-Приложение: http://localhost
-Документация API: http://localhost/api/docs/

## Локальная разработка

```bash
# Бэкенд (нужен PostgreSQL; в .env указать DATABASE_URL с хостом localhost)
cd backend && pip install -r requirements.txt
python manage.py migrate && python manage.py runserver
pytest

# Фронтенд (в frontend/.env.local: NEXT_PUBLIC_API_URL=http://localhost:8000/api)
cd frontend && npm install && npm run dev
npm test        # тесты криптографии (node --test, эталонные векторы PBKDF2/HKDF)
```

## Демо через Cloudflare Tunnel (для защиты)

Публичный HTTPS-адрес прямо с вашего компьютера — бесплатно и без регистрации.
HTTPS обязателен: браузер разрешает шифрование (Web Crypto) только на защищённых страницах.

```bash
brew install cloudflared   # один раз
./scripts/demo.sh          # соберёт и запустит Docker, затем откроет туннель
```

В выводе появится адрес вида `https://random-words.trycloudflare.com` — его можно открыть с любого устройства.
Адрес меняется при каждом запуске и работает, пока открыт туннель и включён компьютер.

- `Ctrl+C` — закрыть туннель; `docker compose down` — остановить контейнеры (данные сохраняются в volumes).
- Любой, у кого есть адрес, может зарегистрироваться: не публикуйте его и закрывайте туннель после показа.
- Быстрые туннели — для тестов и демо: без гарантий доступности, до 200 одновременных запросов.
- Если в `~/.cloudflared/` есть `config.yaml`, временно переименуйте его — иначе быстрый туннель не запустится.
- Перед защитой проверьте загрузку самого большого файла, который будете показывать (лимит у Cloudflare для
  тела запроса официально не указан для быстрых туннелей; сторонние источники называют 100 МБ).
