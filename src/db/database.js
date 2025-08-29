const sqlite3 = require('sqlite3').verbose();

// Initialize SQLite database
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        db.run(`PRAGMA foreign_keys = ON;`); // Enable foreign key constraints
        initializeDatabase();
    }
});

// Database initialization function
function initializeDatabase() {
    db.serialize(() => {
        // 3.1. system_configs - 系统配置表
        db.run(`
            CREATE TABLE IF NOT EXISTS system_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                config_key TEXT NOT NULL UNIQUE,
                config_value TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 3.2. com_phone_mappings - COM口与电话号码映射表
        db.run(`
            CREATE TABLE IF NOT EXISTS com_phone_mappings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                com_port TEXT NOT NULL UNIQUE,
                phone_number TEXT NOT NULL UNIQUE,
                last_linked_at DATETIME NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 3.3. sms_messages - 短信消息记录表
        db.run(`
            CREATE TABLE IF NOT EXISTS sms_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                external_id TEXT UNIQUE, -- 新增字段用于存储抓取到的短信ID
                com_port TEXT NOT NULL,
                sender_number TEXT,
                receiver_number TEXT,
                content TEXT NOT NULL,
                original_timestamp DATETIME NOT NULL,
                is_consumed BOOLEAN DEFAULT FALSE,
                consumed_by_link_id INTEGER NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (consumed_by_link_id) REFERENCES access_links(id)
            );
        `);

        // 3.4. access_links - 访问链接表
        db.run(`
            CREATE TABLE IF NOT EXISTS access_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL UNIQUE,
                mapping_id INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'active', -- ENUM('active', 'completed', 'expired')
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (mapping_id) REFERENCES com_phone_mappings(id)
            );
        `);

        // Insert default config for targetUrl if not exists
        db.run(`
            INSERT OR IGNORE INTO system_configs (config_key, config_value)
            VALUES ('targetUrl', 'http://example.com/sms-log');
        `);
        // Insert default config for announcement if not exists
        db.run(`
            INSERT OR IGNORE INTO system_configs (config_key, config_value)
            VALUES ('announcement', '欢迎使用短信验证码中转服务！请注意保护您的隐私。');
        `);
        // Insert default config for cooldownPeriod if not exists (24 hours)
        db.run(`
            INSERT OR IGNORE INTO system_configs (config_key, config_value)
            VALUES ('cooldownPeriod', '24');
        `);
        // Insert default config for validityPeriod if not exists (10 minutes)
        db.run(`
            INSERT OR IGNORE INTO system_configs (config_key, config_value)
            VALUES ('validityPeriod', '10');
        `);
        // Insert default config for cyclePeriod if not exists (120 hours)
        db.run(`
            INSERT OR IGNORE INTO system_configs (config_key, config_value)
            VALUES ('cyclePeriod', '120');
        `);
        // Insert default config for linkCount if not exists (initial value 0)
        db.run(`
            INSERT OR IGNORE INTO system_configs (config_key, config_value)
            VALUES ('linkCount', '0');
        `);
        // Insert default config for adminSecretKey if not exists (generate a random UUID)
        db.run(`
            INSERT OR IGNORE INTO system_configs (config_key, config_value)
            VALUES ('adminSecretKey', 'f834cb44-c5d3-4514-af4f-362aecd4896a');
        `);

        console.log('Database tables checked/created and default configs set.');
    });
}

module.exports = { db, initializeDatabase };
