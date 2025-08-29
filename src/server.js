const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
const path = require('path');
const puppeteer = require('puppeteer'); // Add puppeteer

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // For serving static files like user page

let lastKnownSmsData = []; // To store the last fetched data for comparison
let browserInstance = null; // Global browser instance for Puppeteer
let pageInstance = null; // Global page instance for Puppeteer
let isMonitoring = false; // Flag to prevent multiple monitoring runs
const refreshInterval = 10000; // 抓取间隔，单位毫秒 (例如：5000毫秒 = 5秒)

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

        console.log('Database tables checked/created and default configs set.');
    });
}

// Admin API routes
app.post('/api/admin/config', (req, res) => {
    const { key, value } = req.body;
    if (!key || value === undefined || value === null) { // value can be 0 or empty string, so check for undefined/null
        return res.status(400).json({ message: 'Config key and value are required.' });
    }
    db.run(`UPDATE system_configs SET config_value = ?, updated_at = CURRENT_TIMESTAMP WHERE config_key = ?`,
        [String(value), key], // Ensure value is stored as string
        function (err) {
            if (err) {
                console.error('Error updating config:', err.message);
                return res.status(500).json({ message: 'Failed to update config.' });
            }
            if (this.changes === 0) {
                // If no row was updated, it means the key doesn't exist, so insert it
                db.run(`INSERT INTO system_configs (config_key, config_value) VALUES (?, ?)`,
                    [key, String(value)], // Ensure value is stored as string
                    function (err) {
                        if (err) {
                            console.error('Error inserting new config:', err.message);
                            return res.status(500).json({ message: 'Failed to insert new config.' });
                        }
                        res.status(201).json({ message: 'Config created successfully.' });
                    }
                );
            } else {
                res.status(200).json({ message: 'Config updated successfully.' });
            }
        }
    );
});

app.get('/api/admin/configs', (req, res) => {
    db.all(`SELECT config_key, config_value FROM system_configs`, [], (err, rows) => {
        if (err) {
            console.error('Error fetching all configs:', err.message);
            return res.status(500).json({ message: 'Failed to retrieve configs.' });
        }
        res.status(200).json(rows);
    });
});

app.post('/api/admin/mappings/import', (req, res) => {
    const mappings = req.body;
    if (!Array.isArray(mappings) || mappings.length === 0) {
        return res.status(400).json({ message: 'An array of mappings is required.' });
    }

    const stmt = db.prepare(`INSERT OR REPLACE INTO com_phone_mappings (com_port, phone_number) VALUES (?, ?)`);
    db.serialize(() => {
        mappings.forEach(mapping => {
            if (mapping.com_port && mapping.phone_number) {
                stmt.run(mapping.com_port, mapping.phone_number, function (err) {
                    if (err) {
                        console.error('Error importing mapping:', err.message);
                    }
                });
            }
        });
        stmt.finalize(() => {
            res.status(201).json({ message: 'Mappings imported successfully.' });
        });
    });
});

app.post('/api/admin/links', async (req, res) => {
    let cooldownPeriod = 24; // Default to 24 hours
    let validityPeriod = 10; // Default to 10 minutes
    let cyclePeriod = 120; // Default to 120 hours

    try {
        const configs = await new Promise((resolve, reject) => {
            db.all(`SELECT config_key, config_value FROM system_configs WHERE config_key IN ('cooldownPeriod', 'validityPeriod', 'cyclePeriod')`, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        configs.forEach(config => {
            if (config.config_key === 'cooldownPeriod') cooldownPeriod = parseInt(config.config_value, 10);
            if (config.config_key === 'validityPeriod') validityPeriod = parseInt(config.config_value, 10);
            if (config.config_key === 'cyclePeriod') cyclePeriod = parseInt(config.config_value, 10);
        });
    } catch (error) {
        console.error('Error fetching config for link generation:', error.message);
        // Use default values if fetching fails
    }

    // System automatically selects an available phone number
    db.get(`SELECT id, com_port, phone_number FROM com_phone_mappings WHERE last_linked_at IS NULL OR (julianday('now') - julianday(last_linked_at)) * 24 > ? LIMIT 1`,
        [cooldownPeriod],
        (err, mapping) => {
            if (err) {
                console.error('Error finding available mapping:', err.message);
                return res.status(500).json({ message: 'Failed to find an available phone number.' });
            }
            if (!mapping) {
                return res.status(429).json({ message: 'No available phone numbers or all are in cooldown.' });
            }

            const token = uuidv4();
            const expiresAt = new Date(Date.now() + validityPeriod * 60 * 1000).toISOString(); // Use configured validityPeriod

            db.serialize(() => {
                // 1. Delete historical messages associated with this phone number's COM port
                db.run(`DELETE FROM sms_messages WHERE com_port = ?`, [mapping.com_port], (err) => {
                    if (err) {
                        console.error('Error deleting historical messages:', err.message);
                        // Continue even if deletion fails, as it's not critical for link generation
                    }
                });

                // 2. Insert new access link
                db.run(`INSERT INTO access_links (token, mapping_id, expires_at) VALUES (?, ?, ?)`,
                    [token, mapping.id, expiresAt],
                    function (err) {
                        if (err) {
                            console.error('Error creating access link:', err.message);
                            return res.status(500).json({ message: 'Failed to create access link.' });
                        }

                        // 3. Update last_linked_at for the mapping
                        db.run(`UPDATE com_phone_mappings SET last_linked_at = CURRENT_TIMESTAMP WHERE id = ?`,
                            [mapping.id],
                            (err) => {
                                if (err) {
                                    console.error('Error updating last_linked_at:', err.message);
                                    // This is important, but we've already created the link. Log and proceed.
                                }
                                res.status(201).json({ link: `${req.protocol}://${req.get('host')}/sms-link/${token}` });
                            }
                        );
                    }
                );
            });
        }
    );
});

// Route to serve the user-facing HTML page
app.get('/sms-link/:token', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// User API route (for fetching data from the HTML page)
app.get('/get-sms/:token', (req, res) => {
    const { token } = req.params;

    db.get(`SELECT al.id AS link_id, al.mapping_id, al.status, al.expires_at, cpm.com_port, cpm.phone_number
            FROM access_links al
            JOIN com_phone_mappings cpm ON al.mapping_id = cpm.id
            WHERE al.token = ?`,
        [token],
        (err, link) => {
            if (err) {
                console.error('Error fetching link:', err.message);
                return res.status(500).json({ message: 'Internal server error.' });
            }
            if (!link) {
                return res.status(404).json({ message: 'Link is invalid or has expired.' });
            }

            const now = new Date();
            const expiresAt = new Date(link.expires_at);

            if (link.status !== 'active' || now > expiresAt) {
                // Update status to expired if it's past due
                if (link.status === 'active' && now > expiresAt) {
                    db.run(`UPDATE access_links SET status = 'expired' WHERE id = ?`, [link.link_id], (updateErr) => {
                        if (updateErr) console.error('Error updating link status to expired:', updateErr.message);
                    });
                }
                return res.status(404).json({ message: 'Link is invalid or has expired.' });
            }

            // Fetch announcement and validityPeriod for the user page
            db.all(`SELECT config_key, config_value FROM system_configs WHERE config_key IN ('announcement', 'validityPeriod')`, [], async (configErr, configRows) => {
                let announcement = '欢迎使用短信验证码中转服务！';
                let validityPeriod = 10; // Default to 10 minutes

                configRows.forEach(config => {
                    if (config.config_key === 'announcement') announcement = config.config_value;
                    if (config.config_key === 'validityPeriod') validityPeriod = parseInt(config.config_value, 10);
                });

                db.all(`SELECT content, original_timestamp FROM sms_messages WHERE com_port = ? AND is_consumed = FALSE ORDER BY original_timestamp DESC LIMIT 2`,
                    [link.com_port],
                    (smsErr, messages) => {
                        if (smsErr) {
                            console.error('Error fetching SMS messages:', smsErr.message);
                            return res.status(500).json({ message: 'Failed to retrieve messages.' });
                        }

                        if (messages.length === 2) {
                            const messageExpiryThreshold = new Date(now.getTime() - validityPeriod * 60 * 1000); // Use configured validityPeriod
                            const allMessagesExpired = messages.every(msg => new Date(msg.original_timestamp) < messageExpiryThreshold);

                            if (allMessagesExpired) {
                                // 如果两条消息都已过期，则将链接状态设置为 'expired'
                                db.run(`UPDATE access_links SET status = 'expired' WHERE id = ?`, [link.link_id], (updateLinkErr) => {
                                    if (updateLinkErr) console.error('Error updating link status to expired due to message expiry:', updateLinkErr.message);
                                });
                                return res.status(404).json({ message: 'Link is invalid or has expired due to message expiry.' });
                            }

                            // Mark messages as consumed and update link status
                            db.serialize(() => {
                                const stmt = db.prepare(`UPDATE sms_messages SET is_consumed = TRUE, consumed_by_link_id = ? WHERE content = ? AND original_timestamp = ?`);
                                messages.forEach(msg => {
                                    stmt.run(link.link_id, msg.content, msg.original_timestamp, (updateMsgErr) => {
                                        if (updateMsgErr) console.error('Error marking message as consumed:', updateMsgErr.message);
                                    });
                                });
                                stmt.finalize();

                                db.run(`UPDATE access_links SET status = 'completed' WHERE id = ?`, [link.link_id], (updateLinkErr) => {
                                    if (updateLinkErr) console.error('Error updating link status to completed:', updateLinkErr.message);
                                });
                            });
                            return res.status(200).json({ messages, announcement, phoneNumber: link.phone_number });
                        } else {
                            // Not enough messages yet, return what's available and a waiting message
                            return res.status(202).json({ message: 'Waiting for new messages...', messages, announcement, phoneNumber: link.phone_number });
                        }
                    }
                );
            });
        }
    );
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Start monitoring after server starts
    startMonitoring();
});

// Data monitoring logic
async function monitorTargetUrl() {
    if (isMonitoring) {
        console.log('Monitoring is already in progress. Skipping this run.');
        return;
    }
    isMonitoring = true;

    let targetUrl = '';
    try {
        const configRow = await new Promise((resolve, reject) => {
            db.get(`SELECT config_value FROM system_configs WHERE config_key = 'targetUrl'`, [], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        targetUrl = configRow ? configRow.config_value : '';
        if (!targetUrl || targetUrl === 'http://example.com/sms-log') {
            console.warn('targetUrl is not configured or is default. Skipping monitoring.');
            isMonitoring = false;
            return;
        }
    } catch (error) {
        console.error('Error fetching targetUrl from config:', error.message);
        isMonitoring = false;
        return;
    }

    try {
        if (!browserInstance) {
            browserInstance = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
            pageInstance = await browserInstance.newPage();
            console.log(`正在访问 ${targetUrl}...`);
            await pageInstance.goto(targetUrl, { waitUntil: 'networkidle2' });
            console.log(`${targetUrl} 页面已加载。`);
        }

        const currentData = await pageInstance.evaluate(() => {
            const tableContainer = document.querySelector('.p-5.mb-4.bg-light.rounded-3');
            if (!tableContainer) {
                return [];
            }

            const tableRows = Array.from(tableContainer.querySelectorAll('tbody tr'));
            const extractedData = tableRows.map(row => {
                const columns = Array.from(row.querySelectorAll('td'));
                return columns.map(col => col.innerText.trim());
            });
            return extractedData;
        });

        if (currentData.length > 0) {
            const newData = currentData.filter(row => {
                const external_id = row[0]; // Assuming ID is the first element
                return !lastKnownSmsData.some(knownRow => knownRow[0] === external_id);
            });

            if (newData.length > 0) {
                console.log('发现新数据:', newData);
                for (const row of newData) {
                    // Assuming row format: [ID, 时间, COM端口号, 接收号码, 发送号码, 内容]
                    const [external_id, original_timestamp_str, com_port_num, receiver_number, sender_number, content] = row;
                    const com_port = `COM${com_port_num}`; // Convert '5' to 'COM5'
                    const original_timestamp = new Date(original_timestamp_str).toISOString(); // Ensure valid date format

                    db.run(`INSERT INTO sms_messages (external_id, com_port, sender_number, receiver_number, content, original_timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
                        [external_id, com_port, sender_number, receiver_number, content, original_timestamp],
                        function (err) {
                            if (err) {
                                console.error('Error inserting new SMS message:', err.message);
                            } else {
                                console.log(`新短信插入成功，ID: ${this.lastID}`);
                            }
                        }
                    );
                }
                lastKnownSmsData = currentData; // Update last known data
            } else {
                console.log('没有发现新数据。');
            }
        } else {
            console.log('抓取到的表格数据为空。');
        }

    } catch (error) {
        console.error('监控 targetUrl 时发生错误:', error);
        // If an error occurs, close browser and reset instances to ensure a fresh start
        if (browserInstance) {
            await browserInstance.close();
            browserInstance = null;
            pageInstance = null;
        }
    } finally {
        isMonitoring = false;
    }
}

function startMonitoring() {
    // Run immediately on startup
    monitorTargetUrl();
    // Schedule to run every refreshInterval milliseconds
    setInterval(monitorTargetUrl, refreshInterval);
    console.log(`脚本已启动，每 ${refreshInterval / 1000} 秒抓取一次 targetUrl 的信息`);
}
