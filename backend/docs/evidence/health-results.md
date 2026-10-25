# /health evidence
Generated 2026-10-25T11:38:06.314Z

### DB connected (real DATABASE_URL)
```
GET /health -> 503 {"status":"error","db":"down","time":"2026-10-25T11:38:08.917Z"} (2030 ms)
GET /api/health -> 200 {"status":"ok","db":"up","time":"2026-10-25T11:38:10.859Z"} (1939 ms)
```
### DB disconnected (unreachable host)
```
GET /health -> 503 {"status":"error","db":"down","time":"2026-10-25T11:38:11.705Z"} (6 ms)
GET /api/health -> 503 {"status":"error","db":"down","time":"2026-10-25T11:38:11.724Z"} (18 ms)
```
