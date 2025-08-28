// 使用示例：监控Binance的实时交易数据（WebSocket示例）
const WebSocketMonitor = require('./index');

// 创建一个监控Binance交易页面的实例
const binanceMonitor = new WebSocketMonitor({
  url: 'https://www.binance.com/en/trade/BTC_USDT',
  refreshInterval: '*/1 * * * *', // 每分钟刷新一次
  headless: false, // 显示浏览器窗口，便于观察
  timeout: 45000
});

// 自定义页面处理逻辑
class CustomMonitor extends WebSocketMonitor {
  async refreshPage() {
    try {
      console.log(`开始刷新页面 - ${new Date().toLocaleString()}`);
      
      // 刷新页面
      await this.page.reload({ 
        waitUntil: 'networkidle2',
        timeout: this.config.timeout 
      });
      
      // 等待页面完全加载
      await this.page.waitForTimeout(5000);
      
      // 获取实时价格信息
      const priceData = await this.page.evaluate(() => {
        const priceElement = document.querySelector('[data-testid="lastPrice"]');
        const volumeElement = document.querySelector('[data-testid="24hVolume"]');
        
        return {
          timestamp: new Date().toISOString(),
          price: priceElement ? priceElement.textContent : 'N/A',
          volume: volumeElement ? volumeElement.textContent : 'N/A',
          url: window.location.href
        };
      });
      
      console.log('获取到的数据:', priceData);
      
      // 保存数据到文件
      const fs = require('fs');
      const logEntry = `${new Date().toISOString()} - 价格: ${priceData.price}, 交易量: ${priceData.volume}\n`;
      fs.appendFileSync('price_log.txt', logEntry);
      
      // 截图保存
      await this.page.screenshot({ 
        path: `binance_${Date.now()}.png`,
        fullPage: true 
      });
      
    } catch (error) {
      console.error('刷新页面失败:', error);
    }
  }
}

// 使用自定义监控器
const customMonitor = new CustomMonitor({
  url: 'https://www.websocket.org/echo.html', // WebSocket测试页面
  refreshInterval: '*/2 * * * *',
  headless: true
});

// 启动监控（取消注释来运行示例）
// customMonitor.startMonitoring();

console.log('示例文件已创建！');
console.log('使用方法：');
console.log('1. 修改 .env 文件中的 TARGET_URL');
console.log('2. 运行: node index.js');
console.log('3. 或运行示例: node example.js');