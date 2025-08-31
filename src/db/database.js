require('dotenv').config();
const mysql = require('mysql2/promise');

let pool; // Declare pool here, it will be initialized in initializeDatabase

async function initializeDatabase() {
    let connection;
    try {
        // Create a temporary connection pool without specifying a database
        // This allows us to connect to the MySQL server to create the database
        const tempPool = mysql.createPool({
            host: process.env.MYSQL_HOST,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            port: process.env.MYSQL_PORT, // Use port from .env
            waitForConnections: true,
            connectionLimit: 1, // Only need one connection for initialization
            queueLimit: 0
        });

        connection = await tempPool.getConnection();
        console.log('Connected to MySQL server for database initialization.');

        const dbName = process.env.MYSQL_DATABASE;
        await connection.execute(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``); // Use backticks for database name
        console.log(`Database '${dbName}' checked/created.`);

        connection.release(); // Release the temporary connection

        // Now, create the main pool with the specified database
        pool = mysql.createPool({
            host: process.env.MYSQL_HOST,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE,
            port: process.env.MYSQL_PORT,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            timezone: 'Z' // Set timezone to UTC
        });

        // Get a connection from the main pool to create tables
        connection = await pool.getConnection();
        console.log('Connected to the MySQL database.');

        // 3.1. system_configs - 系统配置表
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS system_configs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                config_key VARCHAR(255) NOT NULL UNIQUE,
                config_value TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            );
        `);

        // 3.2. com_phone_mappings - COM口与电话号码映射表
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS com_phone_mappings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                com_port VARCHAR(255) NOT NULL UNIQUE,
                phone_number VARCHAR(255) NOT NULL UNIQUE,
                last_linked_at DATETIME NULL,
                cooldown_until DATETIME NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 3.4. access_links - 访问链接表
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS access_links (
                id INT AUTO_INCREMENT PRIMARY KEY,
                token VARCHAR(255) NOT NULL UNIQUE,
                mapping_id INT NOT NULL,
                status ENUM('active', 'completed', 'expired') NOT NULL DEFAULT 'active',
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (mapping_id) REFERENCES com_phone_mappings(id)
            );
        `);

        // 3.3. sms_messages - 短信消息记录表
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS sms_messages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                external_id VARCHAR(255) UNIQUE, -- 新增字段用于存储抓取到的短信ID
                com_port VARCHAR(255) NOT NULL,
                sender_number VARCHAR(255),
                receiver_number VARCHAR(255),
                content TEXT NOT NULL,
                original_timestamp DATETIME NOT NULL,
                is_consumed TINYINT(1) DEFAULT 0,
                consumed_by_link_id INT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (consumed_by_link_id) REFERENCES access_links(id)
            );
        `);

        // Insert default config for targetUrl if not exists
        await connection.execute(`
            INSERT IGNORE INTO system_configs (config_key, config_value)
            VALUES ('targetUrl', 'http://example.com/sms-log');
        `);
        // Insert default config for announcement if not exists
        await connection.execute(`
            INSERT IGNORE INTO system_configs (config_key, config_value)
            VALUES ('announcement', '欢迎使用短信验证码中转服务！请注意保护您的隐私。');
        `);
        // Insert default config for cooldownPeriod if not exists (24 hours)
        await connection.execute(`
            INSERT IGNORE INTO system_configs (config_key, config_value)
            VALUES ('cooldownPeriod', '24');
        `);
        // Insert default config for validityPeriod if not exists (10 minutes)
        await connection.execute(`
            INSERT IGNORE INTO system_configs (config_key, config_value)
            VALUES ('validityPeriod', '10');
        `);
        // Insert default config for cyclePeriod if not exists (120 hours)
        await connection.execute(`
            INSERT IGNORE INTO system_configs (config_key, config_value)
            VALUES ('cyclePeriod', '120');
        `);
        // Insert default config for linkCount if not exists (initial value 0)
        await connection.execute(`
            INSERT IGNORE INTO system_configs (config_key, config_value)
            VALUES ('linkCount', '0');
        `);
        // Insert default config for adminSecretKey if not exists (generate a random UUID)
        await connection.execute(`
            INSERT IGNORE INTO system_configs (config_key, config_value)
            VALUES ('adminSecretKey', 'f834cb44-c5d3-4514-af4f-362aecd4896a');
        `);

        console.log('Database tables checked/created and default configs set.');
    } catch (err) {
        console.error('Error connecting to or initializing database:', err.message);
        process.exit(1); // Exit if database connection or initialization fails
    } finally {
        if (connection) {
            connection.release();
        }
    }
}

module.exports = { getPool: () => pool, initializeDatabase };
