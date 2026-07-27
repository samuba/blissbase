Syncs WhatsApp messages into a SQLite DB.
Stores media in Cloudflare R2 instead of on local disk.
Uploads a fresh SQLite snapshot to R2 on a fixed periodic dirty sync.
Mirrors named chats from SQLite `sync_chats` into Postgres `whatsapp_chats` (startup full sync, then incremental upserts).
Loads settings from `config.jsonc` on startup. Use `config.jsonc.example` as the template.