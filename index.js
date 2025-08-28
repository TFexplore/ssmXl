const puppeteer = require('puppeteer');

const targetUrl = 'http://sms.newszfang.vip:3000/D29HPKLSn2QF3Une8uSWNX'; // 请替换为你要访问的实际网址
const refreshInterval = 5000; // 抓取间隔，单位毫秒 (例如：5000毫秒 = 5秒)

async function runScraper() {
    const browser = await puppeteer.launch({ headless: true }); // 设置 headless: false 可以看到浏览器界面
    const page = await browser.newPage();

    try {
        console.log(`正在访问 ${targetUrl}...`);
        await page.goto(targetUrl, { waitUntil: 'networkidle2' });
        console.log(`${targetUrl} 页面已加载。`);

        setInterval(async () => {
            console.log(`正在抓取 ${targetUrl} 的信息...`);
            try {
                // 在这里添加抓取网页信息的逻辑
                // 例如，获取某个元素的文本内容
                const data = await page.evaluate(() => {
                const tableContainer = document.querySelector('.p-5.mb-4.bg-light.rounded-3');
                if (!tableContainer) {
                    return '表格容器未找到';
                }

                const tableRows = Array.from(tableContainer.querySelectorAll('tbody tr'));
                const extractedData = tableRows.map(row => {
                    const columns = Array.from(row.querySelectorAll('td'));
                    return columns.map(col => col.innerText.trim());
                });
                return extractedData.length > 0 ? extractedData : '表格数据未找到';
                });

                console.log('抓取到的信息:', data);
            } catch (error) {
                console.error('抓取数据时发生错误:', error);
            }
        }, refreshInterval);

        console.log(`脚本已启动，每 ${refreshInterval / 1000} 秒抓取一次 ${targetUrl} 的信息`);

    } catch (error) {
        console.error('初始化浏览器或页面时发生错误:', error);
        await browser.close();
    }

    // 注意：这里不会自动关闭浏览器，除非脚本被手动停止。
    // 如果需要，可以添加一个机制来在特定条件或时间后关闭浏览器。
}

runScraper();
