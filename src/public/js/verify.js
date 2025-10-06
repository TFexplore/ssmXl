import { initCaptcha, signIn } from './login.js';

document.addEventListener('DOMContentLoaded', () => {
    const accountListTextarea = document.getElementById('accountList');
    const startValidationButton = document.getElementById('startValidation');
    const successAccountsDiv = document.getElementById('successAccounts');
    const failedAccountsDiv = document.getElementById('failedAccounts');
    const loadingSpinner = document.querySelector('.loading-spinner');
    // 获取进度显示元素
    const validationProgressText = document.getElementById('validationProgressText');
    const validationProgressBar = document.getElementById('validationProgressBar');
    const progressBarContainer = document.querySelector('.progress'); // 获取进度条容器
    const copySuccessButton = document.getElementById('copySuccess'); // 获取复制成功按钮
    const copyFailedButton = document.getElementById('copyFailed');   // 获取复制失败按钮
    const pauseValidationButton = document.getElementById('pauseValidation');
    const resumeValidationButton = document.getElementById('resumeValidation');

    let isPaused = false;

    // 复制文本到剪贴板的通用函数
    async function copyToClipboard(text, buttonElement) {
        try {
            await navigator.clipboard.writeText(text);
            const originalText = buttonElement.textContent;
            buttonElement.textContent = '已复制!';
            setTimeout(() => {
                buttonElement.textContent = originalText;
            }, 2000);
        } catch (err) {
            console.error('复制失败:', err);
            alert('复制失败，请手动复制。');
        }
    }

    // 成功账号复制按钮事件
    copySuccessButton.addEventListener('click', () => {
        const textToCopy = successAccountsDiv.innerText.trim();
        if (textToCopy === '无') {
            alert('没有成功账号可以复制。');
            return;
        }
        copyToClipboard(textToCopy, copySuccessButton);
    });

    // 失败账号复制按钮事件
    copyFailedButton.addEventListener('click', () => {
        const textToCopy = failedAccountsDiv.innerText.trim();
        if (textToCopy === '无') {
            alert('没有失败账号可以复制。');
            return;
        }
        copyToClipboard(textToCopy, copyFailedButton);
    });

    pauseValidationButton.addEventListener('click', () => {
        isPaused = true;
        pauseValidationButton.style.display = 'none';
        resumeValidationButton.style.display = 'inline-block';
        validationProgressText.textContent += ' (已暂停)';
    });

    resumeValidationButton.addEventListener('click', () => {
        isPaused = false;
        resumeValidationButton.style.display = 'none';
        pauseValidationButton.style.display = 'inline-block';
    });

    startValidationButton.addEventListener('click', async () => {
        const accountsInput = accountListTextarea.value.trim();
        if (!accountsInput) {
            alert('请输入账号列表。');
            return;
        }

        // 清空之前的验证结果
        successAccountsDiv.innerHTML = '<p>无</p>';
        failedAccountsDiv.innerHTML = '<p>无</p>';
        loadingSpinner.style.display = 'block';
        startValidationButton.disabled = true;
        pauseValidationButton.style.display = 'inline-block';
        resumeValidationButton.style.display = 'none';
        isPaused = false; // 重置暂停状态

        // 显示进度条和文本
        validationProgressText.style.display = 'inline-block';
        progressBarContainer.style.display = 'flex'; // 使用flex来显示进度条容器
        validationProgressBar.style.width = '0%';
        validationProgressBar.setAttribute('aria-valuenow', '0');
        validationProgressText.textContent = '正在准备...';

        const addSuccess = (message) => {
            if (successAccountsDiv.innerHTML === '<p>无</p>') {
                successAccountsDiv.innerHTML = '';
            }
            successAccountsDiv.innerHTML += `<p>${message}</p>`;
        };

        const addFailure = (message) => {
            if (failedAccountsDiv.innerHTML === '<p>无</p>') {
                failedAccountsDiv.innerHTML = '';
            }
            failedAccountsDiv.innerHTML += `<p>${message}</p>`;
        };

        const accountsToProcess = [];
        
        // 解析导入数据，提取号码并设置默认密码
        accountsInput.split('\n').forEach(line => {
            const trimmedLine = line.trim();
            if (!trimmedLine) return; // 过滤空行

            const parts = trimmedLine.split(' ');
            if (parts.length < 2) {
                addFailure(`${trimmedLine} (格式错误)`);
                return;
            }

            const phoneNumber = '+86 ' + parts[1]; // 添加 +86 前缀
            const password = '123456'; // 统一设置默认密码
            accountsToProcess.push({ phoneNumber, password, originalLine: trimmedLine });
        });

        const totalAccounts = accountsToProcess.length;
        let processedAccounts = 0;

        for (let i = 0; i < accountsToProcess.length; i++) {
            const account = accountsToProcess[i];
            // 检查是否暂停
            while (isPaused) {
                await new Promise(resolve => setTimeout(resolve, 500)); // 等待500毫秒再次检查
            }

            const { phoneNumber, password, originalLine } = account;

            console.log(`正在验证账号: ${phoneNumber}`);
            processedAccounts++;

            // 更新进度显示
            const progress = Math.round((processedAccounts / totalAccounts) * 100);
            validationProgressBar.style.width = `${progress}%`;
            validationProgressBar.setAttribute('aria-valuenow', progress);
            validationProgressText.textContent = `正在验证: ${processedAccounts}/${totalAccounts} (${progress}%)`;

            try {
                // 1. 获取验证码 token
                const captchaToken = await initCaptcha(phoneNumber);
                if (!captchaToken) {
                    addFailure(`${originalLine} (访问太过频繁，请稍后再试)`);
                    continue;
                }
                console.log(`获取到验证码 token: ${captchaToken}`);

                // 2. 登录验证
                const signInResult = await signIn(phoneNumber, password, captchaToken);

                // 根据signIn函数返回的结果进行判断
                if (signInResult && !signInResult.error) {
                    // 登录成功
                    addSuccess(`${phoneNumber} (登录成功)`);
                } else {
                    // 登录失败，根据error_code解析具体错误类型
                    let errorMessage = '未知错误';
                    if (signInResult && signInResult.error_code) {
                        if (signInResult.error_code === 4012) {
                            errorMessage = '冻结/无效号码'; // 账号已被冻结或无效
                            addFailure(`${originalLine} (登录失败: ${errorMessage})`);
                        } else if (signInResult.error_code === 4022) {
                            errorMessage = '有效号码'; // 账号有效，但登录可能因其他原因失败（例如密码错误）
                            addSuccess(`${originalLine}`);
                        } else{
                            // 遇到频繁访问错误，暂停10秒后重试
                            console.log('访问频繁 (4002)，暂停30秒后重试...');
                            validationProgressText.textContent = `正在验证: ${processedAccounts}/${totalAccounts} (请求频繁，30秒后重试)`;
                            await new Promise(resolve => setTimeout(resolve, 30000)); // 暂停 10 秒
                            i--; // 重新处理当前账号
                            processedAccounts--; // 修正已处理账号计数
                            continue; // 继续下一次循环（即重试）
                        } 
                    } else if (signInResult && signInResult.error_description) {
                        errorMessage = signInResult.error_description;
                        addFailure(`${originalLine} (登录失败: ${errorMessage})`);
                    }
                   
                }
            } catch (error) {
                console.error(`验证账号 ${phoneNumber} 时发生异常:`, error);
                addFailure(`${originalLine} (验证异常: ${error.message})`);
            }
        }

        // 更新界面显示
        loadingSpinner.style.display = 'none';
        startValidationButton.disabled = false;
        pauseValidationButton.style.display = 'none';
        resumeValidationButton.style.display = 'none';

        // 隐藏进度条和文本
        validationProgressText.style.display = 'none';
        progressBarContainer.style.display = 'none';

        alert('验证完成！');
    });
});
