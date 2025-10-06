const app = require('./app');
const { getPool, initializeDatabase } = require('./db/database');
const { startMonitoring } = require('./services/monitoringService');

const PORT = process.env.PORT || 3000;
const DB_NAME = process.env.MYSQL_DATABASE; // 获取数据库名称

// Start the server
async function startServer() {
    await initializeDatabase(DB_NAME); // 初始化数据库，传入数据库名称
    const pool = getPool(); // 获取已初始化的连接池
    startMonitoring(pool); // 传递连接池以启动监控

    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT} with database ${DB_NAME}`);
    });
}

startServer();
