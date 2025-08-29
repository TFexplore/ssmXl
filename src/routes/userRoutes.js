const express = require('express');
const path = require('path');
const { db } = require('../db/database');

const router = express.Router();

// Route to serve the user-facing HTML page
router.get('/sms-link/:token', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

// User API route (for fetching data from the HTML page)
router.get('/get-sms/:token', (req, res) => {
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
            const expiresAt = new Date(link.expires_at); // 假设数据库存储的是本地时间，让 Date 对象自行解析

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
                            const allMessagesExpired = messages.every(msg => {
                                const originalTimestamp = new Date(msg.original_timestamp); // 假设数据库存储的是本地时间，让 Date 对象自行解析
                                return originalTimestamp < messageExpiryThreshold;
                            });

                            if (allMessagesExpired) {
                                // 如果两条消息都已过期，则将链接状态设置为 'expired'
                                db.run(`UPDATE access_links SET status = 'expired' WHERE id = ?`, [link.link_id], (updateLinkErr) => {
                                    if (updateLinkErr) console.error('Error updating link status to expired due0 to message expiry:', updateLinkErr.message);
                                });
                                return res.status(404).json({ message: 'Link is invalid or has expired due to message expiry.' });
                            }

                            // 确保 original_timestamp 以 ISO 字符串格式返回
                            const formattedMessages = messages.map(msg => {
                                const formatDbDate = (dateString) => {
                                    if (!dateString) return null;
                                    // SQLite CURRENT_TIMESTAMP 存储为 'YYYY-MM-DD HH:MM:SS' 格式，被视为本地时间。
                                    // 让 new Date() 将其解析为本地时间。
                                    const date = new Date(dateString);
                                    return date.toISOString();
                                };
                                return {
                                    ...msg,
                                    original_timestamp: formatDbDate(msg.original_timestamp)
                                };
                            });
                            return res.status(200).json({ messages: formattedMessages, announcement, phoneNumber: link.phone_number });
                        } else {
                            // Not enough messages yet, return what's available and a waiting message
                            const formattedMessages = messages.map(msg => {
                                const formatDbDate = (dateString) => {
                                    if (!dateString) return null;
                                    // SQLite CURRENT_TIMESTAMP 存储为 'YYYY-MM-DD HH:MM:SS' 格式，被视为本地时间。
                                    // 让 new Date() 将其解析为本地时间。
                                    const date = new Date(dateString);
                                    return date.toISOString();
                                };
                                return {
                                    ...msg,
                                    original_timestamp: formatDbDate(msg.original_timestamp)
                                };
                            });
                            return res.status(202).json({ message: 'Waiting for new messages...', messages: formattedMessages, announcement, phoneNumber: link.phone_number });
                        }
                    }
                );
            });
        }
    );
});

module.exports = router;
