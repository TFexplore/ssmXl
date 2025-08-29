const express = require('express');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
require('dotenv').config(); // Load environment variables
const { db } = require('../db/database');
const monitoringService = require('../services/monitoringService'); // 导入 monitoringService

const router = express.Router();

// Helper function to fetch admin secret key from DB
async function getAdminSecretKey() {
    return new Promise((resolve, reject) => {
        db.get(`SELECT config_value FROM system_configs WHERE config_key = 'adminSecretKey'`, [], (err, row) => {
            if (err) {
                console.error('Error fetching adminSecretKey:', err.message);
                reject(err);
            } else if (row) {
                resolve(row.config_value);
            } else {
                console.error('Admin secret key not found in database.');
                reject(new Error('Admin secret key not found.'));
            }
        });
    });
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
router.post('/config', (req, res) => {
    const { key, value } = req.body;
    if (!key || value === undefined || value === null) {
        return res.status(400).json({ message: 'Config key and value are required.' });
    }
    db.run(`UPDATE system_configs SET config_value = ?, updated_at = CURRENT_TIMESTAMP WHERE config_key = ?`,
        [String(value), key],
        function (err) {
            if (err) {
                console.error('Error updating config:', err.message);
                return res.status(500).json({ message: 'Failed to update config.' });
            }
            if (this.changes === 0) {
                db.run(`INSERT INTO system_configs (config_key, config_value) VALUES (?, ?)`,
                    [key, String(value)],
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

            // If targetUrl is updated, reset monitoring service
            if (key === 'targetUrl') {
                monitoringService.resetMonitoring();
            }
        }
    );
});

router.get('/configs', (req, res) => {
    db.all(`SELECT config_key, config_value FROM system_configs`, [], (err, rows) => {
        if (err) {
            console.error('Error fetching all configs:', err.message);
            return res.status(500).json({ message: 'Failed to retrieve configs.' });
        }
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.status(200).json(rows);
    });
});

router.post('/mappings/import', (req, res) => {
    const mappings = req.body;
    if (!Array.isArray(mappings) || mappings.length === 0) {
        return res.status(400).json({ message: 'An array of mappings is required.' });
    }

    const stmt = db.prepare(`INSERT OR REPLACE INTO com_phone_mappings (com_port, phone_number, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)`);
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

router.get('/mappings', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10; // 每页10条
    const requestLimit = 20; // 同一次请求加载的数据量为20条
    const offset = (page - 1) * limit;

    if (limit > requestLimit) {
        return res.status(400).json({ message: `Limit cannot exceed ${requestLimit} per request.` });
    }

    let cooldownPeriod = 24; // Default to 24 hours
    let cyclePeriod = 120; // Default to 120 hours

    try {
        const configs = await new Promise((resolve, reject) => {
            db.all(`SELECT config_key, config_value FROM system_configs WHERE config_key IN ('cooldownPeriod', 'cyclePeriod')`, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        configs.forEach(config => {
            if (config.config_key === 'cooldownPeriod') cooldownPeriod = parseInt(config.config_value, 10);
            if (config.config_key === 'cyclePeriod') cyclePeriod = parseInt(config.config_value, 10);
        });
    } catch (error) {
        console.error('Error fetching config for mappings:', error.message);
        // Use default values if fetching fails
    }

    try {
        const totalCount = await new Promise((resolve, reject) => {
            db.get(`SELECT COUNT(*) AS count FROM com_phone_mappings`, [], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        const availableCount = await new Promise((resolve, reject) => {
            db.get(`SELECT COUNT(*) AS count FROM com_phone_mappings WHERE last_linked_at IS NULL OR (julianday('now') - julianday(last_linked_at)) * 24 > ?`,
                [cooldownPeriod],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row.count);
                }
            );
        });

        const rows = await new Promise((resolve, reject) => {
            db.all(`SELECT id, com_port, phone_number, last_linked_at, created_at FROM com_phone_mappings LIMIT ? OFFSET ?`,
                [limit, offset],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });

        const formattedRows = rows.map(row => {
            const formatDbDate = (dateString) => {
                if (!dateString) return null;
                const date = new Date(dateString.endsWith('Z') ? dateString : dateString + 'Z');
                return date.toISOString();
            };
            return {
                ...row,
                last_linked_at: formatDbDate(row.last_linked_at),
                created_at: formatDbDate(row.created_at)
            };
        });

        res.status(200).json({
            total: totalCount,
            available: availableCount,
            page,
            limit,
            data: formattedRows
        });
    } catch (err) {
        console.error('Error fetching mappings with pagination:', err.message);
        return res.status(500).json({ message: 'Failed to retrieve mappings with pagination.' });
    }
});

router.post('/mappings/reset-cooldown/:id', (req, res) => {
    const { id } = req.params;
    db.run(`UPDATE com_phone_mappings SET last_linked_at = NULL WHERE id = ?`, [id], function (err) {
        if (err) {
            console.error('Error resetting cooldown:', err.message);
            return res.status(500).json({ message: 'Failed to reset cooldown.' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ message: 'Mapping not found.' });
        }
        res.status(200).json({ message: 'Cooldown reset successfully.' });
    });
});

router.post('/mappings/reset-cooldown-batch', (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'An array of mapping IDs is required.' });
    }

    const placeholders = ids.map(() => '?').join(',');
    db.run(`UPDATE com_phone_mappings SET last_linked_at = NULL WHERE id IN (${placeholders})`, ids, function (err) {
        if (err) {
            console.error('Error resetting cooldown for batch:', err.message);
            return res.status(500).json({ message: 'Failed to reset cooldown for selected mappings.' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ message: 'No mappings found for the given IDs or no changes were made.' });
        }
        res.status(200).json({ message: `Successfully reset cooldown for ${this.changes} mappings.` });
    });
});

router.post('/links', async (req, res) => {
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
                                // 4. Increment linkCount
                                db.run(`UPDATE system_configs SET config_value = CAST(config_value AS INTEGER) + 1, updated_at = CURRENT_TIMESTAMP WHERE config_key = 'linkCount'`,
                                    [],
                                    (err) => {
                                        if (err) {
                                            console.error('Error incrementing linkCount:', err.message);
                                            // Log and proceed, as link generation is complete
                                        }
                                        res.status(201).json({ link: `${req.protocol}://${req.get('host')}/sms-link/${token}` });
                                    }
                                );
                            }
                        );
                    }
                );
            });
        }
    );
});

router.post('/delete-all-data', async (req, res) => {
    try {
        await new Promise((resolve, reject) => {
            db.run(`DELETE FROM access_links`, (err) => {
                if (err) {
                    console.error('Error deleting access_links:', err.message);
                    return reject(new Error('Failed to delete access links.'));
                }
                resolve();
            });
        });

        await new Promise((resolve, reject) => {
            db.run(`DELETE FROM sms_messages`, (err) => {
                if (err) {
                    console.error('Error deleting sms_messages:', err.message);
                    return reject(new Error('Failed to delete SMS messages.'));
                }
                resolve();
            });
        });

        await new Promise((resolve, reject) => {
            db.run(`DELETE FROM com_phone_mappings`, (err) => {
                if (err) {
                    console.error('Error deleting com_phone_mappings:', err.message);
                    return reject(new Error('Failed to delete phone number mappings.'));
                }
                resolve();
            });
        });

        res.status(200).json({ message: '所有数据已成功删除。' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
