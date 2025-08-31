const express = require('express');
const { nanoid } = require('nanoid');
const jwt = require('jsonwebtoken');
require('dotenv').config(); // Load environment variables
const { getPool } = require('../db/database');
const monitoringService = require('../services/monitoringService'); // 导入 monitoringService
const { getFormattedUtcDatetime, getFormattedLocalDatetime } = require('../utils/datetimeUtils'); // 导入日期时间工具方法

const router = express.Router();

// Helper function to fetch admin secret key from DB
async function getAdminSecretKey() {
    const pool = getPool();
    const [rows] = await pool.query(`SELECT config_value FROM system_configs WHERE config_key = 'adminSecretKey'`);
    if (rows.length > 0) {
        return rows[0].config_value;
    } else {
        throw new Error('Admin secret key not found.');
    }
}

// Middleware to authenticate admin requests
const authenticateAdmin = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        return res.status(401).json({ message: 'Authentication token required.' });
    }

    try {
        const adminSecretKey = await getAdminSecretKey();
        jwt.verify(token, adminSecretKey, (err, user) => {
            if (err) {
                return res.status(403).json({ message: 'Invalid or expired token.' });
            }
            req.user = user;
            next();
        });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
};

// Admin login route
router.post('/login', async (req, res) => {
    const { secretKey } = req.body;

    if (!secretKey) {
        return res.status(400).json({ message: 'Secret key is required.' });
    }

    try {
        const adminSecretKey = await getAdminSecretKey();
        if (secretKey === adminSecretKey) {
            const token = jwt.sign({ isAdmin: true }, adminSecretKey, { expiresIn: '12h' });
            res.json({ message: 'Authentication successful.', token });
        } else {
            res.status(401).json({ message: 'Invalid secret key.' });
        }
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
});

// Apply authentication middleware to all admin routes except login
router.use(authenticateAdmin);

// Admin API routes
router.post('/config', async (req, res) => {
    const { key, value } = req.body;
    if (!key || value === undefined || value === null) {
        return res.status(400).json({ message: 'Config key and value are required.' });
    }
    try {
        const pool = getPool();
        const [result] = await pool.execute(
            `INSERT INTO system_configs (config_key, config_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE config_value = ?`,
            [key, String(value), String(value)]
        );

        if (result.affectedRows > 0) {
            res.status(200).json({ message: 'Config updated successfully.' });
        } else {
            res.status(201).json({ message: 'Config created successfully.' });
        }

        // If targetUrl is updated, reset monitoring service
        if (key === 'targetUrl') {
            monitoringService.resetMonitoring();
        }
    } catch (err) {
        console.error('Error updating config:', err.message);
        return res.status(500).json({ message: 'Failed to update config.' });
    }
});

router.get('/configs', async (req, res) => {
    try {
        const pool = getPool();
        const [rows] = await pool.query(`SELECT config_key, config_value FROM system_configs`);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.status(200).json(rows);
    } catch (err) {
        console.error('Error fetching all configs:', err.message);
        return res.status(500).json({ message: 'Failed to retrieve configs.' });
    }
});

router.post('/mappings/import', async (req, res) => {
    const mappings = req.body;
    if (!Array.isArray(mappings) || mappings.length === 0) {
        return res.status(400).json({ message: 'An array of mappings is required.' });
    }

    const pool = getPool();
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const query = `INSERT INTO com_phone_mappings (com_port, phone_number) VALUES (?, ?) ON DUPLICATE KEY UPDATE phone_number = VALUES(phone_number)`;
        for (const mapping of mappings) {
            if (mapping.com_port && mapping.phone_number) {
                await connection.execute(query, [mapping.com_port, mapping.phone_number]);
            }
        }
        await connection.commit();
        res.status(201).json({ message: 'Mappings imported successfully.' });
    } catch (err) {
        await connection.rollback();
        console.error('Error importing mapping:', err.message);
        res.status(500).json({ message: 'Failed to import mappings.' });
    } finally {
        connection.release();
    }
});

router.get('/mappings', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10; // 每页10条
    const requestLimit = 30; // 同一次请求加载的数据量为20条
    const offset = (page - 1) * limit;

    if (limit > requestLimit) {
        return res.status(400).json({ message: `Limit cannot exceed ${requestLimit} per request.` });
    }

    let cooldownPeriod = 24; // Default to 24 hours

    try {
        const pool = getPool();
        const [configs] = await pool.query(`SELECT config_key, config_value FROM system_configs WHERE config_key = 'cooldownPeriod'`);
        if (configs.length > 0) {
            const parsedValue = parseFloat(configs[0].config_value);
            if (!isNaN(parsedValue)) {
                cooldownPeriod = parsedValue;
            }
        }
    } catch (error) {
        console.error('Error fetching config for mappings:', error.message);
        // Use default values if fetching fails
    }

    try {
        const pool = getPool();
        const [[{ totalCount }]] = await pool.query(`SELECT COUNT(*) AS totalCount FROM com_phone_mappings`);
        const formattedNow = getFormattedUtcDatetime();
        const [[{ availableCount }]] = await pool.query(
            `SELECT COUNT(*) AS availableCount FROM com_phone_mappings WHERE cooldown_until IS NULL OR ? > cooldown_until`,
            [formattedNow]
        );
        const [rows] = await pool.query(
            `SELECT id, com_port, phone_number, cooldown_until, created_at FROM com_phone_mappings LIMIT ${limit} OFFSET ${offset}`
        );

        res.status(200).json({
            total: totalCount,
            available: availableCount,
            page,
            limit,
            data: rows
        });
    } catch (err) {
        console.error('Error fetching mappings with pagination:', err.message);
        return res.status(500).json({ message: 'Failed to retrieve mappings with pagination.' });
    }
});

router.post('/mappings/reset-cooldown/:id', async (req, res) => {
    const { id } = req.params;
    const pool = getPool();
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [result] = await connection.execute(`UPDATE com_phone_mappings SET last_linked_at = NULL, cooldown_until = NULL WHERE id = ?`, [id]);
        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Mapping not found.' });
        }
        await connection.execute(`DELETE FROM access_links WHERE mapping_id = ?`, [id]);
        await connection.commit();
        res.status(200).json({ message: 'Cooldown reset successfully.' });
    } catch (err) {
        await connection.rollback();
        console.error('Error resetting cooldown:', err.message);
        return res.status(500).json({ message: 'Failed to reset cooldown.' });
    } finally {
        connection.release();
    }
});

router.post('/mappings/reset-cooldown-batch', async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'An array of mapping IDs is required.' });
    }

    const pool = getPool();
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const placeholders = ids.map(() => '?').join(',');
        const [result] = await connection.execute(`UPDATE com_phone_mappings SET last_linked_at = NULL, cooldown_until = NULL WHERE id IN (${placeholders})`, ids);
        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'No mappings found for the given IDs or no changes were made.' });
        }
        await connection.execute(`DELETE FROM access_links WHERE mapping_id IN (${placeholders})`, ids);
        await connection.commit();
        res.status(200).json({ message: `Successfully reset cooldown for ${result.affectedRows} mappings.` });
    } catch (err) {
        await connection.rollback();
        console.error('Error resetting cooldown for batch:', err.message);
        return res.status(500).json({ message: 'Failed to reset cooldown for selected mappings.' });
    } finally {
        connection.release();
    }
});

router.post('/links', async (req, res) => {
    const { quantity = 1 } = req.body; // Default to 1 if quantity is not provided
    if (isNaN(quantity) || quantity < 1) {
        return res.status(400).json({ message: 'Invalid quantity provided.' });
    }

    let cooldownPeriod = 24; // Default to 24 hours
    let validityPeriod = 10; // Default to 10 minutes

    const pool = getPool();
    try {
        const [configs] = await pool.query(`SELECT config_key, config_value FROM system_configs WHERE config_key IN ('cooldownPeriod', 'validityPeriod')`);
        configs.forEach(config => {
            if (config.config_key === 'cooldownPeriod') {
                const parsedValue = parseFloat(config.config_value);
                if (!isNaN(parsedValue)) {
                    cooldownPeriod = parsedValue;
                }
            }
            if (config.config_key === 'validityPeriod') {
                const parsedValue = parseFloat(config.config_value);
                if (!isNaN(parsedValue)) {
                    validityPeriod = parsedValue;
                }
            }
        });
    } catch (error) {
        console.error('Error fetching config for link generation:', error.message);
        // Use default values if fetching fails
    }

    const connection = await pool.getConnection();
    const generatedLinks = [];
    try {
        await connection.beginTransaction();

        const formattedNowForDb = getFormattedUtcDatetime();
        const [mappings] = await connection.execute(
            `SELECT id, com_port, phone_number FROM com_phone_mappings WHERE cooldown_until IS NULL OR ? > cooldown_until LIMIT ${quantity} FOR UPDATE`,
            [formattedNowForDb]
        );

        if (mappings.length === 0) {
            await connection.rollback();
            return res.status(429).json({ message: 'No available phone numbers or all are in cooldown.' });
        }

        // If mappings.length < quantity, we proceed with available mappings, no error
        for (const mapping of mappings) {
            const token = nanoid(6)+mapping.com_port;
            const expiresAt = getFormattedUtcDatetime(cooldownPeriod); // 使用 cooldownPeriod (小时) 计算链接过期时间
            const formattedNow = getFormattedUtcDatetime();
            await connection.execute(`DELETE FROM sms_messages WHERE com_port = ?`, [mapping.com_port]);
            await connection.execute(`INSERT INTO access_links (token, mapping_id, expires_at) VALUES (?, ?, ?)`, [token, mapping.id, expiresAt]);
            await connection.execute(`UPDATE com_phone_mappings SET last_linked_at = ?, cooldown_until = ? WHERE id = ?`, [formattedNow, expiresAt, mapping.id]);
            generatedLinks.push(`${req.protocol}://${req.get('host')}/link/${token}`);
        }
        await connection.execute(`UPDATE system_configs SET config_value = CAST(config_value AS SIGNED) + ? WHERE config_key = 'linkCount'`, [mappings.length]);


        await connection.commit();
        res.status(201).json({ links: generatedLinks });
    } catch (err) {
        await connection.rollback();
        console.error('Error creating access link:', err.message);
        return res.status(500).json({ message: 'Failed to create access link.' });
    } finally {
        connection.release();
    }
});
router.post('/shortlinks', async (req, res) => {
    const { quantity = 1 } = req.body; // Default to 1 if quantity is not provided
    if (isNaN(quantity) || quantity < 1) {
        return res.status(400).json({ message: 'Invalid quantity provided.' });
    }

    let cooldownPeriod = 24; // Default to 24 hours
    let shortLinkExpiry = 2; // Default to 2 hours for short links

    const pool = getPool();
    try {
        const [configs] = await pool.query(`SELECT config_key, config_value FROM system_configs WHERE config_key IN ('cooldownPeriod', 'shortLinkExpiry')`);
        configs.forEach(config => {
            if (config.config_key === 'cooldownPeriod') {
                const parsedValue = parseFloat(config.config_value);
                if (!isNaN(parsedValue)) {
                    cooldownPeriod = parsedValue;
                }
            }
            if (config.config_key === 'shortLinkExpiry') {
                const parsedValue = parseFloat(config.config_value);
                if (!isNaN(parsedValue)) {
                    shortLinkExpiry = parsedValue;
                }
            }
        });
    } catch (error) {
        console.error('Error fetching config for short link generation:', error.message);
        // Use default values if fetching fails
    }

    const connection = await pool.getConnection();
    const generatedLinks = [];
    try {
        await connection.beginTransaction();
        const formattedNowForDb = getFormattedUtcDatetime();
        const [mappings] = await connection.execute(
            `SELECT id, com_port, phone_number FROM com_phone_mappings WHERE cooldown_until IS NULL OR ? > cooldown_until LIMIT ${quantity} FOR UPDATE`,
            [formattedNowForDb]
        );

        if (mappings.length === 0) {
            await connection.rollback();
            return res.status(429).json({ message: 'No available phone numbers or all are in cooldown.' });
        }

        // If mappings.length < quantity, we proceed with available mappings, no error
        for (const mapping of mappings) {
            const localDatetimeString = getFormattedLocalDatetime();
            const hours = localDatetimeString.substring(11, 13);
            const minutes = localDatetimeString.substring(14, 16);
            const timePart = hours + minutes;
            const comPortNumbers = mapping.com_port.match(/\d+/g)?.join('') || ''; // 提取com_port中的所有数字并拼接
            const token = nanoid(6) + timePart+'M' + comPortNumbers;
            const linkExpiresAt = getFormattedUtcDatetime(shortLinkExpiry); // Use shortLinkExpiry (hours) to calculate link expiry
            const cooldownUntil = getFormattedUtcDatetime(cooldownPeriod); // Use cooldownPeriod (hours) to calculate cooldown_until
            const formattedNow = getFormattedUtcDatetime();

            await connection.execute(`DELETE FROM sms_messages WHERE com_port = ?`, [mapping.com_port]);
            await connection.execute(`INSERT INTO access_links (token, mapping_id, expires_at) VALUES (?, ?, ?)`, [token, mapping.id, linkExpiresAt]);
            await connection.execute(`UPDATE com_phone_mappings SET last_linked_at = ?, cooldown_until = ? WHERE id = ?`, [formattedNow, cooldownUntil, mapping.id]);
            generatedLinks.push(`${req.protocol}://${req.get('host')}/link/short/${token}`);
        }
        await connection.execute(`UPDATE system_configs SET config_value = CAST(config_value AS SIGNED) + ? WHERE config_key = 'linkCount'`, [mappings.length]);

        await connection.commit();
        res.status(201).json({ links: generatedLinks }); // Return an array of links
    } catch (err) {
        await connection.rollback();
        console.error('Error creating short access link:', err.message);
        return res.status(500).json({ message: 'Failed to create short access link.' });
    } finally {
        connection.release();
    }
});

router.post('/delete-all-data', async (req, res) => {
    const pool = getPool(); // Get pool here
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.execute(`DELETE FROM access_links`);
        await connection.execute(`DELETE FROM sms_messages`);
        await connection.execute(`DELETE FROM com_phone_mappings`);
        await connection.commit();
        res.status(200).json({ message: '所有数据已成功删除。' });
    } catch (err) {
        await connection.rollback();
        console.error('Error deleting all data:', err.message);
        res.status(500).json({ message: 'Failed to delete all data.' });
    } finally {
        connection.release();
    }
});

module.exports = router;
