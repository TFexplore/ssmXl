const puppeteer = require('puppeteer');
let lastKnownSmsData = []; // To store the last fetched data for comparison
let browserInstance = null; // Global browser instance for Puppeteer
let pageInstance = null; // Global page instance for Puppeteer
let isMonitoring = false; // Flag to prevent multiple monitoring runs
const refreshInterval = 10000; // 抓取间隔，单位毫秒 (例如：5000毫秒 = 5秒)

let dbPool; // To store the database pool passed from server.js

// Data monitoring logic
async function monitorTargetUrl() {
    if (isMonitoring) {
        console.log('Monitoring is already in progress. Skipping this run.');
        return;
    }
    isMonitoring = true;

    let targetUrl = '';
    try {
        const [rows] = await dbPool.query(`SELECT config_value FROM system_configs WHERE config_key = 'targetUrl'`);
        targetUrl = rows.length > 0 ? rows[0].config_value : '';
        if (targetUrl && !targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            targetUrl = 'http://' + targetUrl;
        }
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

    let keyword = '';
    try {
        const [rows] = await dbPool.query(`SELECT config_value FROM system_configs WHERE config_key = 'keyword'`);
        keyword = rows.length > 0 ? rows[0].config_value : '';
    } catch (error) {
        console.error('Error fetching keyword from config:', error.message);
        // Continue without a keyword if fetching fails
    }

    try {
        if (!browserInstance) {
            browserInstance = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
            pageInstance = await browserInstance.newPage();
            console.log(`正在访问 ${targetUrl}...`);
            await pageInstance.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
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
                    // Convert to MySQL DATETIME format 'YYYY-MM-DD HH:MM:SS'
                    const dateObj = new Date(original_timestamp_str);
                    const original_timestamp = dateObj;

                    // --- MODIFICATION START ---
                    // If keyword is not set, save all messages. If it is set, only save matching messages.
                    if (!keyword || content.includes(keyword)) {
                        try {
                            const [result] = await dbPool.execute(
                                `INSERT IGNORE INTO sms_messages (external_id, com_port, sender_number, receiver_number, content, original_timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
                                [external_id, com_port, sender_number, receiver_number, content, original_timestamp]
                            );
                            if (result.affectedRows > 0) {
                                console.log(`新短信插入成功 (关键词: "${keyword || '无'}"), ID: ${result.insertId}`);
                            } else {
                                console.log(`短信已存在或插入失败 (关键词: "${keyword || '无'}"), ID: ${external_id}`);
                            }
                        } catch (err) {
                            console.error(`Error inserting new SMS message (with keyword "${keyword || '无'}"):`, err.message);
                        }
                    } else {
                        console.log(`短信内容不包含关键词 "${keyword}"，跳过保存。内容: ${content}`);
                    }
                    // --- MODIFICATION END ---
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

function startMonitoring(pool) {
    dbPool = pool; // Store the initialized pool
    // Run immediately on startup
    monitorTargetUrl();
    // Schedule to run every refreshInterval milliseconds
    setInterval(monitorTargetUrl, refreshInterval);
    console.log(`脚本已启动，每 ${refreshInterval / 1000} 秒抓取一次 targetUrl 的信息`);
}

async function resetMonitoring() {
    if (browserInstance) {
        console.log('Closing Puppeteer browser instance...');
        await browserInstance.close();
        browserInstance = null;
        pageInstance = null;
        isMonitoring = false; // Reset monitoring flag
        console.log('Puppeteer browser instance closed and monitoring reset.');
    }
}

module.exports = { startMonitoring, resetMonitoring };
