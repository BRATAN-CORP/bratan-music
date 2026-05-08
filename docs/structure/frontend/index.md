# Frontend (`/src`)

React 18 + Vite 6 + TypeScript 5.7 SPA. Деплоится на GitHub Pages под
`basename = '/bratan-music'`. PWA через `vite-plugin-pwa` + Workbox 7.

## Дерево директорий

```
src/
├── main.tsx                    bootstrap: QueryClient, I18nProvider, SplashScreen, AppRouter
├── app/                        page-level routes (1 page = 1 папка)
├── components/
│   ├── layout/                 каркас приложения (Sidebar / Player / FullscreenPlayer / ...)
│   ├── features/               domain-specific (PlaylistCard / Equalizer / RoomChat / ...)
│   ├── ui/                     дизайн-система (shadcn-style)
│   └── system/                 невидимые "bootstrap" компоненты (DislikesBootstrap, ...)
├── hooks/                      переиспользуемые React-хуки
├── store/                      Zustand-сторы (player, auth, settings, ui, ...)
├── lib/                        не-React утилиты (api client, motion presets, offline, ...)
├── i18n/                       runtime + словари
├── styles/                     дизайн-токены (_tokens.scss) + globals.scss
└── types/                      разделяемые типы (Track / Album / Playlist / ...)
```

## Главные узлы

### `main.tsx`
Entry point. Делает 4 вещи:

1. Зовёт `getTelegramWebApp()?.ready?.()` + `expand?.()` — для запуска
   внутри Telegram WebApp.
2. `wireOfflineBridge()` — подключает framework-agnostic offline manager
   к React store (idempotent на fast-refresh).
3. `startSyncQueueAutoFlush()` — drain offline-buffered likes / play
   history, listener на `online`.
4. `startCoverBackfill()` — fire-and-forget, перезапрашивает обложки в
   IDB после fix'а no-cors fetch.

Дерево провайдеров: `<StrictMode><QueryClientProvider><I18nProvider>
<SplashScreen /><AppRouter /></I18nProvider></QueryClientProvider>
</StrictMode>`.

### `app/router.tsx`
`createBrowserRouter` с `basename='/bratan-music'`. Layout-компонент
`<AppLayout>` монтирует:

- `Sidebar` (desktop nav)
- `Player` (mini-player)
- `FullscreenPlayer`
- `MobileBottomDock`
- `SubscriptionDialog`, `OnboardingTour`, `RoomConnectedBadge`,
  `QuickPrefsBar`, `GlassFilter`, `ToastHost`, `DislikesBootstrap`,
  `OfflineToastWatcher`, `AppUpdateWatcher`

В layout вызываются "глобальные" хуки: `useAutoAuth`, `useSettingsSync`,
`useDocumentPlaybackTitle`, `usePlayHistoryLogger`, `useRoomBridge`.

Маршрут `/` рендерит `<HomeOrLanding />`: `LandingPage` для гостя,
`HomePage` для авторизованного.

### Маршруты

| Путь | Страница |
| --- | --- |
| `/` | `HomeOrLanding` (gated: LandingPage \| HomePage) |
| `/search` | `SearchPage` (внутри — `SearchEmptyState` с discovery-плитками) |
| `/explore` | редирект на `/search` |
| `/explore/:slug` | `ExploreSlugPage` (жанр) |
| `/explore/:slug/list/:moduleIndex` | `ExploreListPage` |
| `/explore/playlist/:uuid` | `TidalPlaylistPage` |
| `/library` | `LibraryPage` |
| `/library/uploads` | `UploadsPage` |
| `/library/downloaded` | `DownloadedPlaylistPage` |
| `/profile` | `ProfilePage` |
| `/ai` | `AiPlaylistPage` |
| `/daily/:id` | `DailyPlaylistPreviewPage` |
| `/track/:id` | `TrackPage` |
| `/album/:id` | `AlbumPage` |
| `/artist/:id` | `ArtistPage` (+ `/albums`, `/singles`) |
| `/playlist/:id` | `PlaylistPage` |
| `/p/:token` | `SharedPlaylistPage` (публичная ссылка) |
| `/rooms` | `RoomsListPage` |
| `/rooms/:id` | `RoomPage` |
| `*` | `NotFoundPage` |

### Layout-компоненты (`components/layout/`)

| Компонент | Назначение |
| --- | --- |
| `Sidebar.tsx` | Desktop-навигация. Логотип, разделы (Home / Search / Library / Rooms / Profile / Admin). |
| `Player.tsx` | Mini-плеер внизу: cover, title, controls, progress. |
| `FullscreenPlayer.tsx` | Большой плеер с TiltCard, лирикой, EQ, визуализатором. |
| `MobileBottomDock.tsx` | Tab-bar для мобильного. |
| `QuickPrefsBar.tsx` | Quick prefs: тема, язык. Гейтится auth-store'ом. |
| `SwipeTrackStrip.tsx` | Swipe для переключения треков на FullscreenPlayer. |

### UI primitives (`components/ui/`)
shadcn-style. После рефакторинг-foundation (#373) ядро переехало на
дизайн-токены и единые примитивы.

Главные: `Button`, `IconButton`, `Card`, `Modal`, `Sheet`, `PageHero`,
`PageLoader`, `PageTransition`, `Input`, `Switch`, `Skeleton`,
`SectionHeading`, `EmptyState`, `Marquee`, `TiltCard`, `Aurora`,
`BrandLogo`, `CoverFallback`, `Reveal`, `PopoverMenu`, `ToastHost`,
`UserAvatar`, `liquid-glass-button`, `SplashScreen`, `AnimatedNumber`.

### Feature-компоненты (`components/features/`)
~50 файлов, domain-specific. Сгруппировать по подсистемам:

- **Tracks:** `TrackItem`, `TrackKebabMenu`, `TrackInlineActions`,
  `TrackOverrideModal`, `Equalizer`, `Visualizer`
- **Playlists:** `PlaylistCard`, `PlaylistCoverButton`,
  `PlaylistTrackItem`, `CreatePlaylistDialog`, `RenamePlaylistDialog`,
  `SharePlaylistDialog`, `AddToPlaylistDialog`, `QueueDialog`,
  `UnsaveConfirmDialog`
- **Albums / artists:** `AlbumCard`, `AlbumPlayButton`, `ArtistCard`,
  `ArtistLinks`, `ArtistPicker`, `ArtistDislikeMenuItems`
- **Library / uploads:** `EditUploadDialog`, `LyricsPanel`
- **Search / explore:** `SearchBar`, `SearchEmptyState`,
  `SearchFilters`, `SearchResults`, `ExploreModules`
- **Auth / subscription:** `AuthGuard`, `TelegramLoginButton`,
  `SubscriptionDialog`, `OnboardingTour`, `LanguageSwitcher`
- **Rooms:** `RoomChat`, `RoomConnectedBadge`
- **Offline:** `OfflineActionButton`, `OfflineBadge`,
  `OfflineLibraryTab`, `OfflineProgressIcon`, `OfflineToastWatcher`,
  `CardDownloadOverlay`
- **Admin:** `AdminAdminFlagPanel`, `AdminHealthPanel`,
  `AdminTidalPanel`, `AdminUserDetailDialog`, `AdminUserPurgePanel`,
  `BannedListDialog`, `BannedListPanel`, `ClearHistoryPanel`,
  `ResetRecommendationsPanel`, `ResetTourPanel`
- **App-level:** `AppUpdateWatcher`, `ShareButton`

### Hooks (`src/hooks/`)
~26 хуков. Главные:

| Хук | Назначение |
| --- | --- |
| `useAudioPlayer` | Двухслотный HTML5 Audio + Web Audio API engine. **Не трогаем** без явной задачи. |
| `useAuth` / `useAutoAuth` | Telegram WebApp `initData` → POST `/auth/telegram`. |
| `useSettingsSync` | Подтягиваем prefs (crossfade, EQ, ...) с сервера, debounce push. |
| `usePlayHistoryLogger` | Логируем listening history + auto-extend очереди. |
| `useRoomBridge` | Sync `<audio>` engine с host-state комнаты. |
| `useRoomChat` / `useRooms` | TanStack Query queries. |
| `useLibrary` / `useUploads` / `useExplore` / `useSearch` / `useTrack` | Resource queries. |
| `useDislikes` / `useDislikedTrack` | Глобальный список dislike + check. |
| `useShare` | Web Share API + clipboard fallback. |
| `useEscapeClose` / `useBodyScrollLock` | Хелперы для модалок/sheet'ов. |
| `useMediaQuery` / `useCoarsePointer` | Adaptive UI (mobile vs desktop). |
| `useOnline` | Reactive `navigator.onLine`. |
| `useOfflineActions` / `useOfflineCoverUrl` | Offline-aware actions / cover-URL resolver. |
| `useLyrics` | Lyrics fetch + sync. |
| `usePlaybackSync` | Cross-tab `BroadcastChannel` sync. |
| `useRecentSearches` | localStorage history. |
| `useAdminUsers` / `useAiPlaylist` | Admin / AI domain. |

### Store (`src/store/`)
Zustand:

| Store | Что хранит |
| --- | --- |
| `player.ts` | `currentTrack`, `queue`, `isPlaying`, `volume`, `crossfade`, `eqBands`, ... |
| `auth.ts` | `user`, `token`, `isLoading`, `isPremium` |
| `settings.ts` | `theme`, `language`, prefs синхронизируется с сервером |
| `ui.ts` | Глобальный UI-state (open sheets, modals, ...) |
| `roomConnection.ts` | `roomId`, `role` (host/listener), connection state |
| `offline.ts` | Downloads queue, sync queue, mode |
| `dislikes.ts` | Set<trackId>, Set<artistId> |
| `toast.ts` | Очередь тостов (используется `ToastHost`) |

### Lib (`src/lib/`)
| Файл | Назначение |
| --- | --- |
| `api.ts` | Тонкий fetch-обёртка для worker'а: base URL, JWT, refresh-on-401, ошибки. |
| `queryClient.ts` | Конфиг TanStack Query (stale, retry, error handling). |
| `motion.ts` | Переиспользуемые animation-presets (motion.dev). |
| `imageResize.ts` | Tidal image-resize URL helper (`{size}x{size}`). |
| `tidal-image.ts` | Tidal cover URL builder. |
| `coverFallback.ts` | Generated SVG fallback при отсутствии обложки. |
| `playerTrack.ts` | Конверсия Track → PlayerTrack (engine input). |
| `trackActions.ts` | Like / unlike / add-to-playlist / share — единые actions для всех мест UI. |
| `streamUrlCache.ts` | Memo stream-URL чтобы не дёргать `/tracks/:id/stream` повторно. |
| `recommendations.ts` | Helper для recommendations API. |
| `trackRadio.ts` | Track radio (related tracks). |
| `artistCredit.ts` | Парсинг multi-artist credits. |
| `wave.ts` | "Моя волна" plumbing. |
| `utils.ts` | `cn()` (clsx + tailwind-merge), общие хелперы. |
| `offline/` | См. ниже. |

### Offline (`src/lib/offline/`)
| Файл | Назначение |
| --- | --- |
| `db.ts` | IndexedDB через простой обёртку. |
| `storage.ts` | High-level storage (тёрки, обложки, метадата). |
| `downloads.ts` | Очередь скачиваний, прогресс, отмена. |
| `streamResolver.ts` | Стратегия выбора потока: онлайн → R2/Tidal, оффлайн → IDB. |
| `networkOrLocal.ts` | Network-first / cache-first wrapper. |
| `syncQueue.ts` | Buffer для отложенных POST'ов (likes, history, ...). |
| `coverBackfill.ts` | Periodic backfill обложек (исправление прошлого no-cors fetch'а). |
| `types.ts` | Тип `OfflineTrack`, `Manifest`, ... |
| `index.ts` | Public API. |

### i18n (`src/i18n/`)
- `I18nProvider.tsx` — Context провайдер, language detection (Telegram WebApp `language_code` → fallback navigator.language → en).
- `runtime.ts` — Lookup, плейсхолдеры, плюрализация, форматтеры.
- `hooks.ts` — `useT()`, `useFormatNumber()`, `useFormatDate()`.
- `context.ts` — React Context для dispatch.
- `types.ts` — Тип `Locale`, ключи словаря.
- `locales/ru.json`, `locales/en.json` — словари. **Только эти два
  файла**; других языков нет.

**Правило:** все user-facing строки — через `useT()`. Никакого
`if (lang === 'ru') {...}` в компонентах.

### Styles (`src/styles/`)
- `_tokens.scss` — дизайн-токены (цвета, spacing, typography, radii).
  Источник правды для accent / surface / text.
- `globals.scss` — reset, scroll-behavior, безопасные зоны (`pt-safe`,
  `pb-safe`), Tailwind-`@apply` глобальные классы, темы (light/dark),
  анимации.

Tailwind `tailwind.config.js` мапит токены в утилиты. Hover-стили
гейтятся `@media (hover: hover)` чтобы не залипали на мобильных.

### Types (`src/types/`)
| Файл | Что внутри |
| --- | --- |
| `index.ts` | Domain-types: `Track`, `Album`, `Artist`, `Playlist`, `User`, ... |
| `admin.ts` | Admin DTO. |
| `rooms.ts` | `Room`, `RoomMember`, `RoomState`, ... |

### System (`src/components/system/`)
"Невидимые" компоненты, которые маунтятся в layout и не рендерят UI:
- `DislikesBootstrap.tsx` — ленивая загрузка списка dislike'ов на старте.
