const app = require('./app');
const { db, initializeDatabase } = require('./db/database');
const { startMonitoring } = require('./services/monitoringService');

const PORT = process.env.PORT || 3000;

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Start monitoring after server starts
    startMonitoring();
});
