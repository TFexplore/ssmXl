const express = require('express');
const path = require('path');
const { getPool } = require('../db/database');

const router = express.Router();

// Route to serve the user-facing HTML page
router.get(['/link/:token', '/link/short/:token'], (req, res) => {
    const isShortLink = req.originalUrl.includes('/short/');
    const fileName = isShortLink ? 'index_short.html' : 'index.html';
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

        const now = new Date();
        if (link.status !== 'active' || now > link.expires_at) {
            if (link.status === 'active') {
                await pool.execute(`UPDATE access_links SET status = 'expired' WHERE id = ?`, [link.link_id]);
            }
            return res.status(404).json({ message: 'Link is invalid or has expired.' });
        }

        const [configs] = await pool.query(`SELECT config_key, config_value FROM system_configs WHERE config_key IN ('announcement', 'validityPeriod')`);
        let announcement = '欢迎使用短信验证码中转服务！';
        let validityPeriod = 10; // Default to 10 minutes

        configs.forEach(config => {
            if (config.config_key === 'announcement') announcement = config.config_value;
            if (config.config_key === 'validityPeriod') validityPeriod = parseInt(config.config_value, 10);
        });

        const [messages] = await pool.query(
            `SELECT content, created_at , original_timestamp FROM sms_messages WHERE com_port = ? AND is_consumed = FALSE ORDER BY created_at ASC LIMIT 2`,

            [link.com_port]
        );

        if (messages.length === 2) {
            const messageExpiryThreshold = new Date(now.getTime() - validityPeriod * 60 * 1000);
            const allMessagesExpired = messages.every(msg => new Date(msg.created_at) < messageExpiryThreshold);

            if (allMessagesExpired) {
                await pool.execute(`UPDATE access_links SET status = 'expired' WHERE id = ?`, [link.link_id]);
                return res.status(404).json({ message: 'Link is invalid or has expired due to message expiry.' });
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

        const now = new Date();
        if (link.status !== 'active' || now > link.expires_at) {
            if (link.status === 'active') {
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

module.exports = router;
