# Go backend parity port (prod stays on TS until green)

## Goal: implement/realign ~40 frontend-required endpoints in api-go to match TS contract, then re-cutover.

## Groups (priority order)
- [ ] LIBRARY (logic exists, realign paths + shapes): /library/items/{album,artist}[/ids], /library/liked, /library/likes/ids, /library/like/{id}, /library/playlists
- [ ] USER settings/sub-routes: /user/preferences (GET/PUT), /user/limits, /user/reset-recommendations, /user/me/tour/{complete,reset}, /user/me/email/{request,verify}, /user/me/telegram/link/{start,status}
- [ ] PLAYLISTS: /playlists/shared/{token} (GET), /playlists/shared/{token}/save, /playlists/external/tidal, /playlists/{id}/cover (PUT/DELETE), /playlists/{id}/reorder (PUT); method fixes pin/share PUT
- [ ] ARTISTS: /artists/{id}/radio
- [ ] TRACKS: /tracks/{id}/file ; investigate "max quality some tracks don't load"
- [ ] ADMIN: /admin/users (grid), /admin/users/{id}, /admin/users/search, /admin/users/{id}/data (DELETE purge), /admin/logs, /admin/admin-flag, /admin/tidal/status, /admin/tidal/refresh-token, /admin/tidal/device/{start,poll}, /admin/tidal/accounts (POST/PATCH/DELETE/{id}/refresh)
- [ ] Verify: parity script green + authed smoke test on :3001
- [ ] Investigate lyrics (route exists, impl differs) + max-quality streaming
- [ ] Re-cutover, then remove temp diagnostics

## Original 8 TS bugs — separate, after parity
