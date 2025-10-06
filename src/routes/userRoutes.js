const express = require('express');
const path = require('path');
const { getPool } = require('../db/database');
const { getFormattedUtcDatetime, getFormattedLocalDatetime } = require('../utils/datetimeUtils'); // 导入日期时间工具方法

const router = express.Router();

// Route to serve the user-facing HTML page for regular links
router.get('/link/:token', (req, res) => {
    const fileName = 'index.html'; // 普通链接使用 index.html
    res.sendFile(path.join(__dirname, '../public', fileName));
});

// Route to serve the user-facing HTML page for short links
router.get('/link/short/:token', (req, res) => {
    const fileName = 'index_short.html'; // 短链接使用 index_short.html
    res.sendFile(path.join(__dirname, '../public', fileName));
});

// User API route (for fetching data from the HTML page)
router.get('/get-sms/:token', async (req, res) => {
    const { token } = req.params;

    try {
        const pool = getPool();
        const [links] = await pool.query(
            `SELECT al.id AS link_id, al.mapping_id, al.status, al.expires_at, cpm.com_port, cpm.phone_number
             FROM access_links al
             JOIN com_phone_mappings cpm ON al.mapping_id = cpm.id
             WHERE al.token = ?`,
            [token]
        );

        if (links.length === 0) {
            return res.status(404).json({ message: 'Link is invalid or has expired.' });
        }
        const link = links[0];

        const now = new Date(getFormattedUtcDatetime()); // Keep this for client-side comparison with fetched expires_at
        if (link.status !== 'active' || now > link.expires_at) {
            if (link.status === 'active') {
                // No SQL NOW() here, expires_at is a Date object from DB
                await pool.execute(`UPDATE access_links SET status = 'expired' WHERE id = ?`, [link.link_id]);
            }
            return res.status(404).json({ message: 'Link is invalid or has expired.' });
        }

        const [configs] = await pool.query(`SELECT config_key, config_value FROM system_configs WHERE config_key IN ('announcement', 'validityPeriod')`);
        let announcement = '欢迎使用短信验证码中转服务！';
        let validityPeriod = 10; // Default to 10 minutes

        configs.forEach(config => {
            if (config.config_key === 'announcement') announcement = config.config_value;
            if (config.config_key === 'validityPeriod') {
                const parsedValue = parseFloat(config.config_value);
                if (!isNaN(parsedValue)) {
                    validityPeriod = parsedValue;
                }
            }
        });

        const [messages] = await pool.query(
            `SELECT content, created_at , original_timestamp FROM sms_messages WHERE com_port = ? AND is_consumed = FALSE ORDER BY created_at ASC LIMIT 2`,

            [link.com_port]
        );

        if (messages.length === 2) {
            const localNow = getFormattedLocalDatetime();
            const isExpiredByOriginalTimestamp = messages.some(msg => {
                if (!msg.original_timestamp) {
                    return false;
                }
                const originalTime = new Date(msg.original_timestamp);
                const expiryTime = new Date(originalTime.getTime() + validityPeriod * 60 * 1000);
                return new Date(localNow) > expiryTime;
            });

            if (isExpiredByOriginalTimestamp) {
                await pool.execute(`UPDATE access_links SET status = 'expired' WHERE id = ?`, [link.link_id]);
                return res.status(404).json({ message: 'Link is invalid or has expired due to message timestamp.' });
            }
        }

        res.status(messages.length < 2 ? 202 : 200).json({
            message: messages.length < 2 ? 'Waiting for new messages...' : undefined,
            messages,
            announcement,
            phoneNumber: link.phone_number
        });

    } catch (err) {
        console.error('Error fetching link or messages:', err.message);
        return res.status(500).json({ message: 'Internal server error.' });
    }
});


// User API route (for fetching data from the HTML page with short content)
router.get('/get-sms-short/:token', async (req, res) => {
    const { token } = req.params;

    try {
        const pool = getPool();
        const [links] = await pool.query(
            `SELECT al.id AS link_id, al.mapping_id, al.status, al.expires_at, cpm.com_port, cpm.phone_number
             FROM access_links al
             JOIN com_phone_mappings cpm ON al.mapping_id = cpm.id
             WHERE al.token = ?`,
            [token]
        );

        if (links.length === 0) {
            return res.status(404).json({ message: 'Link is invalid or has expired.' });
        }
        const link = links[0];
        const localNow = getFormattedUtcDatetime();
        const now = new Date(localNow); // Keep this for client-side comparison with fetched expires_at
        if (link.status !== 'active' || now > link.expires_at) {
            if (link.status === 'active') {
                // No SQL NOW() here, expires_at is a Date object from DB
                await pool.execute(`UPDATE access_links SET status = 'expired' WHERE id = ?`, [link.link_id]);
            }
            return res.status(404).json({ message: 'Link is invalid or has expired.' });
        }

        const [configs] = await pool.query(`SELECT config_key, config_value FROM system_configs WHERE config_key IN ('announcement')`);
        let announcement = '欢迎使用短信验证码中转服务！';

        configs.forEach(config => {
            if (config.config_key === 'announcement') announcement = config.config_value;
        });

        const [messages] = await pool.query(
            `SELECT content, created_at , original_timestamp FROM sms_messages WHERE com_port = ?  ORDER BY created_at DESC`,
            [link.com_port]
        );

        res.status(200).json({
            messages,
            announcement,
            phoneNumber: link.phone_number
        });

    } catch (err) {
        console.error('Error fetching link or messages:', err.message);
        return res.status(500).json({ message: 'Internal server error.' });
    }
});

// 为迅雷API添加的代理路由
const https = require('https');
const { URL } = require('url');

router.post('/api/proxy/', async (req, res) => { // 统一代理路由
    const targetApi = req.query.targetApi; // 从URL查询参数中获取目标API路径
    if (!targetApi) {
        return res.status(400).send('缺少 targetApi 参数');
    }
    const targetUrl = `https://xluser-ssl.xunlei.com/${targetApi}`;
    const url = new URL(targetUrl);

    const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: req.method,
        headers: {
            ...req.headers,
            host: url.hostname, // 必须将host头修改为目标服务器
        }
    };
    // 清理值为 undefined 的头
    Object.keys(options.headers).forEach(key => {
        if (options.headers[key] === undefined) {
            delete options.headers[key];
        }
    });


    const proxyReq = https.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, {
            end: true
        });
    });

    proxyReq.on('error', (e) => {
        console.error(`代理请求遇到错误: ${e.message}`);
        res.status(500).send('代理服务器出错');
    });

    if (req.body) {
        proxyReq.write(JSON.stringify(req.body));
    }
    proxyReq.end();
});


module.exports = router;
