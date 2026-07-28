Syncs WhatsApp messages into a SQLite DB.
Stores media in Cloudflare R2 instead of on local disk.
Uploads a fresh SQLite snapshot to R2 on a fixed periodic dirty sync.
Mirrors named chats from SQLite `sync_chats` into Postgres `whatsapp_chats` (startup full sync, then incremental upserts).
Loads settings from `config.jsonc` on startup. Use `config.jsonc.example` as the template.
Make sure to never risk a ban from whatsapp for any reason! (e.g. running into rate limits etc)

Logs can be observed via ssh and journalctl on "whatsapp2sqlite".

# deploy like this
`ssh walter@waltersbox`
`cd whatsapp2sqlite`
`./deployWhatsapp2Sqlite.sh`