declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OWNER_SETUP_KEY_HASH?: string;
    OWNER_SETUP_KEY_EXPIRES_AT?: string;
    PROXY_KEY_HASH?: string;
    SHEETS_SYNC_KEY_HASH?: string;
    REMOVE_MANAGER_EMAIL?: string;
    CLEAR_PLAYER_DATA_VERSION?: string;
    CLEAR_SESSION_DATA_VERSION?: string;
  }
}
