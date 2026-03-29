Syncs WhatsApp messages into a SQLite DB.
Stores media in Cloudflare R2 instead of on local disk.
Uploads a fresh SQLite snapshot to R2 on a fixed periodic dirty sync.
Loads settings from `config.jsonc` on startup. Use `config.jsonc.example` as the template.