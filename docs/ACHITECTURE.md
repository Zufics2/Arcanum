# Архитектура Arcanum

## 1. Идея
Веб-приложение «облачный диск», где файлы шифруются в браузере до отправки на сервер.
Сервер хранит только шифротекст и не может прочитать ни файлы, ни их имена.
Регистрация анонимная: только логин и пароль, без email и телефона.

### Изюминки
1. **Самоуничтожающиеся ссылки** — `https://site/s/{link_id}#{fileKey}`. Часть после `#` браузер не отправляет
   на сервер, поэтому сервер не знает ключ. Ссылка удаляется после N скачиваний или по истечении срока.
2. **Режим «Глазами сервера»** — переключатель в интерфейсе, который показывает файлы так, как они лежат в БД:
   зашифрованные имена (base64) и бессмысленные байты.
3. **Просмотр в браузере** — картинки, PDF и текст расшифровываются и открываются без скачивания.

### Ограничения (честно указать в дипломе)
- Забыл пароль — данные не восстановить (свойство zero-knowledge).
- Файл шифруется целиком в памяти → лимит размера файла 200 МБ.
- Сервер видит метаданные: количество файлов, их размеры, время загрузки.

## 2. Криптография (только Web Crypto API)

```
Пароль ─PBKDF2(salt + "auth", 600k, SHA-256)─► authHash ─► на сервер как «пароль» (Django хеширует его ещё раз)
       └PBKDF2(salt + "enc",  600k, SHA-256)─► userKey  ─► остаётся в браузере

userKey  (AES-256-GCM) шифрует ─► masterKey (случайный, хранится в БД зашифрованным)
masterKey (AES-256-GCM) шифрует ─► fileKey (случайный для каждого файла) и ключи имён папок
fileKey  (AES-256-GCM) шифрует ─► содержимое файла и его имя
```

- `salt` — 16 случайных байт, генерируется на клиенте при регистрации, хранится на сервере открыто.
- Формат зашифрованных данных: `iv (12 байт) || ciphertext`, в API передаётся в base64.
- Смена пароля: клиент перешифровывает только `masterKey` новым `userKey` и отправляет новый `authHash`.
- Публичная ссылка: клиент расшифровывает `fileKey`, экспортирует его (raw → base64url) и кладёт в `#fragment`.
  Имя файла зашифровано тем же `fileKey`, поэтому публичная страница может показать имя.
- Защита от перебора логинов: `/api/auth/salt` для несуществующего пользователя возвращает фейковую
  детерминированную соль `HMAC(SECRET_KEY, username)[:16]`, а не ошибку 404.

Весь криптокод — в одном модуле `frontend/src/lib/crypto.ts`.

## 3. База данных (PostgreSQL)

```
User (стандартная модель Django, поле email не используется)
  Profile (OneToOne → User)
    salt                    BinaryField / base64
    encrypted_master_key    TextField (base64)

Folder
  id                UUID PK
  owner             FK → User
  parent            FK → Folder, null = корень
  encrypted_name    TextField (base64, шифруется masterKey)
  created_at

File
  id                    UUID PK
  owner                 FK → User
  folder                FK → Folder, null = корень
  encrypted_name        TextField (base64, шифруется fileKey)
  encrypted_file_key    TextField (base64, шифруется masterKey)
  blob                  FileField (зашифрованные байты, случайное имя файла на диске)
  size                  BigInteger (размер шифротекста)
  created_at

ShareLink
  id                CharField PK (случайная строка, secrets.token_urlsafe(16))
  file              FK → File (on_delete=CASCADE)
  expires_at        DateTime, null
  max_downloads     Integer, null
  download_count    Integer, default 0
  created_at
```

## 4. REST API (`/api/`)

```
POST   /auth/register         {username, auth_hash, salt, encrypted_master_key}
POST   /auth/salt             {username} → {salt}
POST   /auth/login            {username, auth_hash} → {access, refresh, encrypted_master_key}
POST   /auth/refresh
POST   /auth/change-password  {old_auth_hash, new_auth_hash, new_encrypted_master_key}
DELETE /auth/account          удаление аккаунта и всех файлов

GET    /folders/?parent={id}  содержимое папки (папки + файлы)
POST   /folders/              {parent, encrypted_name}
PATCH  /folders/{id}/         переименовать / переместить
DELETE /folders/{id}/         каскадно

POST   /files/                multipart: blob, encrypted_name, encrypted_file_key, folder
GET    /files/{id}/download/  зашифрованные байты
PATCH  /files/{id}/           переименовать / переместить
DELETE /files/{id}/

POST   /share/                {file, expires_at, max_downloads} → {id}
GET    /share/{id}/           публично, без авторизации: метаданные (encrypted_name, size)
GET    /share/{id}/download/  публично; увеличивает download_count, при достижении лимита удаляет ссылку
DELETE /share/{id}/

GET    /me/storage/           занятое место
```

Все эндпоинты, кроме auth и публичных share, требуют JWT. Пользователь видит только свои объекты.
Документация API: drf-spectacular → `/api/docs/`.

## 5. Фронтенд (страницы)

- `/register` — логин, пароль, подтверждение; предупреждение «забудете пароль — данные не восстановить».
- `/login`
- `/drive` и `/drive/[folderId]` — таблица файлов (Ant Design Table), хлебные крошки, Upload.Dragger,
  контекстное меню (скачать, переименовать, переместить, поделиться, удалить), предпросмотр.
- Модалка «Поделиться» — срок жизни, лимит скачиваний, копирование ссылки.
- `/s/[id]` — публичная страница: берёт ключ из `window.location.hash`, скачивает и расшифровывает.
- `/settings` — смена пароля, занятое место (Progress), удаление аккаунта.
- Переключатель «Глазами сервера» в шапке диска.

Состояние: zustand-стор `authStore` (токены + masterKey в памяти). При перезагрузке страницы ключ теряется →
пользователь снова вводит пароль. Это осознанное решение.

## 6. Структура проекта

```
arcanum/
├── CLAUDE.md
├── docs/ARCHITECTURE.md
├── docker-compose.yml
├── .env.example
├── nginx/nginx.conf
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── config/            settings.py, urls.py
│   ├── accounts/          регистрация, вход, соль, профиль
│   ├── storage/           папки, файлы
│   ├── sharing/           ссылки
│   └── tests/
└── frontend/
    ├── Dockerfile
    └── src/
        ├── app/           login, register, drive, s/[id], settings
        ├── components/    FileTable, UploadZone, ShareModal, ServerViewToggle
        ├── lib/crypto.ts  всё шифрование
        ├── lib/api.ts     axios-клиент с JWT
        └── stores/        authStore.ts
```

## 7. План (этапы)

1. **Каркас:** Docker Compose (db, backend, frontend, nginx), Django + PostgreSQL, пустой Next.js с Ant Design, `.env.example`.
2. **Аутентификация:** модели User/Profile, эндпоинты auth, JWT; `crypto.ts`; страницы регистрации и входа.
3. **Файлы и папки:** модели Folder/File, загрузка/скачивание с шифрованием, дерево папок, страница диска.
4. **Ссылки:** ShareLink, самоуничтожение, публичная страница `/s/[id]`.
5. **Изюминки и полировка:** режим «Глазами сервера», предпросмотр, настройки, смена пароля, тесты, Nginx.