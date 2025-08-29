const puppeteer = require('puppeteer');
const { db } = require('../db/database');

let lastKnownSmsData = []; // To store the last fetched data for comparison
let browserInstance = null; // Global browser instance for Puppeteer
let pageInstance = null; // Global page instance for Puppeteer
let isMonitoring = false; // Flag to prevent multiple monitoring runs
const refreshInterval = 10000; // 抓取间隔，单位毫秒 (例如：5000毫秒 = 5秒)

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
