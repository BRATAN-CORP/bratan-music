# BRATAN MUSIC

Музыкальный стриминговый сервис с интеграцией Tidal, авторизацией через Telegram и оплатой через Telegram Stars.

## Архитектура

```
/src        — фронтенд (React + Vite + TypeScript + shadcn/ui)
/worker     — бэкенд (Cloudflare Workers + Hono + D1 + KV + R2)
/bot        — Telegram-бот (Telegraf.js, webhook через Workers)
/public     — статические файлы (PWA manifest, 404.html)
```

## Стек

| Слой | Технология |
|---|---|
| Frontend | React 18, Vite, TypeScript, shadcn/ui, Tailwind CSS, Zustand, TanStack Query |
| Backend | Cloudflare Workers, Hono, D1 (SQLite), KV, R2 |
| Bot | Telegraf.js (webhook-режим) |
| Деплой фронта | GitHub Pages |
| Деплой бэка | Wrangler + GitHub Actions |

## Возможности

- Поиск треков, альбомов и артистов через Tidal
- Стриминг аудио (LOW / HIGH / LOSSLESS)
- Авторизация через Telegram (deeplink + WebApp)
- Подписка через Telegram Stars (99 Stars/мес.)
- Бесплатный тир: 3 трека в сутки
- Своя библиотека: плейлисты, лайки
- Перезалив треков (замена аудио из R2)
- PWA: установка на устройство, офлайн-режим
- Тёмная / светлая тема
- Админ-панель через Telegram-бота

## Быстрый старт

```bash
# 1. Клонировать
git clone https://github.com/BRATAN-CORP/bratan-music.git
cd bratan-music

# 2. Скопировать и заполнить переменные окружения
cp .env.example .env

# 3. Установить зависимости
npm install

# 4. Запустить фронтенд (dev)
npm run dev

# 5. Запустить бэкенд (dev)
cd worker && npx wrangler dev
```

## Ветки

- `main` — продакшн (только протестированный код)
- `dev` — разработка (все PR сюда)

## Лицензия

Частный проект. Все права защищены.
