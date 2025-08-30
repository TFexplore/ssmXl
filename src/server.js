const app = require('./app');
const { getPool, initializeDatabase } = require('./db/database');
const { startMonitoring } = require('./services/monitoringService');

const PORT = process.env.PORT || 3000;

// Start the server
async function startServer() {
    await initializeDatabase(); // Initialize database before starting the server
    const pool = getPool(); // Get the initialized pool
    startMonitoring(pool); // Pass the pool to startMonitoring

    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

startServer();
