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
```
