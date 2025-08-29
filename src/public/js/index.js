document.addEventListener('DOMContentLoaded', () => {
    const token = window.location.pathname.split('/').pop();
    const messagesContainer = document.getElementById('messages-container');
    const loadingMessage = document.getElementById('loading-message');
    const errorMessage = document.getElementById('error-message');
    const announcementDiv = document.getElementById('announcement');
    const phoneNumberDisplay = document.getElementById('phone-number-display');
    const phoneNumberSpan = document.getElementById('phone-number');
    const copyPhoneNumberBtn = document.getElementById('copy-phone-number');

    // Helper function to format date to local time string
    function formatDateToLocal(isoString) {
        if (!isoString) return 'N/A';
        const date = new Date(isoString);
        if (isNaN(date)) return 'N/A';
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    }

    copyPhoneNumberBtn.addEventListener('click', async () => {
        const textToCopy = phoneNumberSpan.innerText;
        try {
            // 尝试使用 Clipboard API
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(textToCopy);
                copyPhoneNumberBtn.innerText = '已复制!';
                setTimeout(() => {
                    copyPhoneNumberBtn.innerText = '复制';
                }, 2000);
            } else {
                // 备用方案：使用 document.execCommand
                const textarea = document.createElement('textarea');
                textarea.value = textToCopy;
                textarea.style.position = 'fixed'; // 避免滚动
                textarea.style.opacity = '0'; // 隐藏
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                try {
                    document.execCommand('copy');
                    copyPhoneNumberBtn.innerText = '已复制!';
                    setTimeout(() => {
                        copyPhoneNumberBtn.innerText = '复制';
                    }, 2000);
                } catch (err) {
                    console.error('复制失败 (execCommand):', err);
                    alert('复制失败，请手动复制。');
                } finally {
                    document.body.removeChild(textarea);
                }
            }
        } catch (err) {
            console.error('复制失败:', err);
            alert('复制失败，请手动复制。');
        }
    });

    async function fetchSmsMessages() {
        try {
            const response = await fetch(`/get-sms/${token}`);
            const data = await response.json();

            if (response.ok || response.status === 202) { // Handle 200 OK and 202 Accepted
                loadingMessage.classList.add('d-none');
                announcementDiv.innerText = data.announcement || '欢迎使用短信验证码中转服务！';

                if (data.phoneNumber) {
                    phoneNumberSpan.innerText = data.phoneNumber;
                    phoneNumberDisplay.classList.remove('d-none');
                }

                if (data.messages && data.messages.length > 0) {
                    messagesContainer.innerHTML = ''; // Clear loading message
                    let messagesToDisplay = data.messages;
                    if (messagesToDisplay.length > 2) {
                        messagesToDisplay = messagesToDisplay.slice(-2); // 只显示最后两条
                    }
                    messagesToDisplay.forEach(msg => {
                        const messageDiv = document.createElement('div');
                        messageDiv.classList.add('message-item');
                        messageDiv.innerHTML = `
                            <div>${msg.content}</div>
                            <div class="message-timestamp">${formatDateToLocal(msg.original_timestamp)}</div>
                        `;
                        messagesContainer.appendChild(messageDiv);
                    });
                    if (data.messages.length < 2) { // 这里的判断仍然基于原始的data.messages长度，以决定是否继续等待
                        const waitingP = document.createElement('p');
                        waitingP.classList.add('text-center', 'text-muted', 'mt-3');
                        waitingP.innerText = '正在等待更多短信...';
                        messagesContainer.appendChild(waitingP);
                        setTimeout(fetchSmsMessages, 3000); // Keep polling if waiting
                    }
                } else {
                    messagesContainer.innerHTML = '<p class="text-center text-muted">暂无短信，请稍候...</p>';
                    setTimeout(fetchSmsMessages, 3000); // Keep polling if no messages yet
                }
            } else {
                errorMessage.classList.remove('d-none');
                errorMessage.innerText = data.message || '获取短信失败，链接可能无效或已过期。';
                loadingMessage.classList.add('d-none');
                messagesContainer.innerHTML = ''; // Clear messages
                phoneNumberDisplay.classList.add('d-none'); // Hide phone number on error
            }
        } catch (error) {
            console.error('Error fetching SMS:', error);
            errorMessage.classList.remove('d-none');
            errorMessage.innerText = '网络错误或服务器无响应。';
            loadingMessage.classList.add('d-none');
            messagesContainer.innerHTML = ''; // Clear messages
            phoneNumberDisplay.classList.add('d-none'); // Hide phone number on error
        }
    }

    if (token) {
        fetchSmsMessages(); // Initial fetch
        setInterval(fetchSmsMessages, 10000); // Auto-refresh every 10 seconds
    } else {
        errorMessage.classList.remove('d-none');
        errorMessage.innerText = '无效的访问链接。';
        loadingMessage.classList.add('d-none');
        phoneNumberDisplay.classList.add('d-none'); // Hide phone number on invalid link
    }

});
