document.addEventListener('DOMContentLoaded', () => {
    const loginContainer = document.getElementById('login-container');
    const adminContent = document.getElementById('admin-content');
    const secretKeyInput = document.getElementById('secretKeyInput');
    const loginBtn = document.getElementById('loginBtn');
    const loginMessage = document.getElementById('loginMessage');

    const targetUrlInput = document.getElementById('targetUrlInput');
    const announcementInput = document.getElementById('announcementInput');
    const cooldownPeriodInput = document.getElementById('cooldownPeriodInput');
    const validityPeriodInput = document.getElementById('validityPeriodInput');
    const cyclePeriodInput = document.getElementById('cyclePeriodInput');
    const shortLinkExpiryInput = document.getElementById('shortLinkExpiryInput');
    const saveConfigBtn = document.getElementById('saveConfigBtn');
    const configMessage = document.getElementById('configMessage');
    let globalCooldownPeriod = 24; // Default to 24 hours, will be updated by fetchAndDisplayConfigs

    const mappingsInput = document.getElementById('mappingsInput');
    const importMappingsBtn = document.getElementById('importMappingsBtn'); // This is the button to open the modal
    const confirmImportMappingsBtn = document.getElementById('confirmImportMappingsBtn'); // This is the button inside the modal
    const mappingsMessage = document.getElementById('mappingsMessage');
    const importMappingsModalElement = document.getElementById('importMappingsModal');
    const importMappingsModal = new bootstrap.Modal(importMappingsModalElement);

    // Event listener to clear the textarea when the import mappings modal is shown
    importMappingsModalElement.addEventListener('shown.bs.modal', () => {
        mappingsInput.value = ''; // Clear the textarea
        mappingsMessage.innerHTML = ''; // Clear any previous messages
    });

    const generateLinkBtn = document.getElementById('generateLinkBtn');
    const generateShortLinkBtn = document.getElementById('generateShortLinkBtn');
    const linkQuantityInput = document.getElementById('linkQuantityInput');
    const linkOutputContainer = document.getElementById('linkOutputContainer');
    const linkMessage = document.getElementById('linkMessage');

    const deleteAllDataBtn = document.getElementById('deleteAllDataBtn');
    const confirmDeleteAllBtn = document.getElementById('confirmDeleteAllBtn');
    const confirmDeleteInput = document.getElementById('confirmDeleteInput');
    const deleteAllMessage = document.getElementById('deleteAllMessage');
    const confirmDeleteAllModal = new bootstrap.Modal(document.getElementById('confirmDeleteAllModal'));

    const mappingsTableBody = document.getElementById('mappingsTableBody');
    const currentMappingsMessage = document.getElementById('currentMappingsMessage');
    const paginationControls = document.getElementById('paginationControls');
    const mappingStats = document.getElementById('mappingStats');
    const selectAllMappingsCheckbox = document.getElementById('selectAllMappings');
    const resetSelectedCooldownBtn = document.getElementById('resetSelectedCooldownBtn');

    const itemsPerPage = 30; // 每页显示10条数据
    let currentPage = 1;
    let totalMappings = 0;
    let availableMappings = 0; // This will store the count of available phone numbers
    let selectedMappingIds = new Set(); // Store selected mapping IDs

    // Function to get the auth token
    function getAuthToken() {
        return localStorage.getItem('adminToken');
    }

    // Function to set the auth token
    function setAuthToken(token) {
        localStorage.setItem('adminToken', token);
    }

    // Function to remove the auth token
    function removeAuthToken() {
        localStorage.removeItem('adminToken');
    }

    // Function to show/hide admin content based on authentication
    function showAdminContent() {
        if (getAuthToken()) {
            loginContainer.style.display = 'none';
            adminContent.style.display = 'block';
            fetchAndDisplayConfigs(); // Load configs when admin content is shown
            fetchAndDisplayMappings(); // Load mappings when admin content is shown
        } else {
            loginContainer.style.display = 'block';
            adminContent.style.display = 'none';
        }
    }

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

    // Function to render pagination controls
    function renderPaginationControls(totalItems, activePage, limit) {
        paginationControls.innerHTML = '';
        const totalPages = Math.ceil(totalItems / limit);

        if (totalItems === 0) {
            return; // No pagination needed if there are no items
        }

        // Previous button
        const prevItem = document.createElement('li');
        prevItem.classList.add('page-item');
        if (activePage === 1) prevItem.classList.add('disabled');
        prevItem.innerHTML = `<a class="page-link" href="#" aria-label="Previous"><span aria-hidden="true">&laquo;</span></a>`;
        prevItem.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentPage > 1) {
                currentPage--;
                fetchAndDisplayMappings(currentPage);
            }
        });
        paginationControls.appendChild(prevItem);

        // Page numbers
        for (let i = 1; i <= totalPages; i++) {
            const pageItem = document.createElement('li');
            pageItem.classList.add('page-item');
            if (i === activePage) pageItem.classList.add('active');
            pageItem.innerHTML = `<a class="page-link" href="#">${i}</a>`;
            pageItem.addEventListener('click', (e) => {
                e.preventDefault();
                currentPage = i;
                fetchAndDisplayMappings(currentPage);
            });
            paginationControls.appendChild(pageItem);
        }

        // Next button
        const nextItem = document.createElement('li');
        nextItem.classList.add('page-item');
        if (activePage === totalPages) nextItem.classList.add('disabled');
        nextItem.innerHTML = `<a class="page-link" href="#" aria-label="Next"><span aria-hidden="true">&raquo;</span></a>`;
        nextItem.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentPage < totalPages) {
                currentPage++;
                fetchAndDisplayMappings(currentPage);
            }
        });
        paginationControls.appendChild(nextItem);
    }

    // Function to update the state of the "Reset Selected Cooldown" button
    function updateResetButtonState() {
        resetSelectedCooldownBtn.disabled = selectedMappingIds.size === 0;
    }

    // Function to display mappings for a specific page
    function displayMappingsForPage(mappingsToDisplay) {
        mappingsTableBody.innerHTML = '';
        selectAllMappingsCheckbox.checked = false; // Reset select all checkbox

        if (mappingsToDisplay.length === 0) {
            currentMappingsMessage.className = 'mt-2 alert alert-info';
            currentMappingsMessage.innerText = '暂无号码映射。请导入号码。';
            updateResetButtonState();
            return;
        } else {
            currentMappingsMessage.innerHTML = ''; // Clear message if mappings exist
        }

        mappingsToDisplay.forEach(mapping => {
            const row = mappingsTableBody.insertRow();
            row.insertCell().innerText = mapping.com_port;
            row.insertCell().innerText = mapping.phone_number ? '****' + mapping.phone_number.slice(-4) : '';
            row.insertCell().innerText = formatDateToLocal(mapping.created_at);
            const cooldownUntilDate = mapping.cooldown_until ? new Date(mapping.cooldown_until) : null;
            const nowUtcMs = Date.now(); // 获取当前UTC时间戳
            console.log(nowUtcMs);
            let cooldownText = '可用';
            if (cooldownUntilDate && !isNaN(cooldownUntilDate.getTime()) && nowUtcMs < cooldownUntilDate.getTime()) {
                const timeRemainingMs = cooldownUntilDate.getTime() - nowUtcMs;
                const remainingHours = timeRemainingMs / (1000 * 60 * 60);
                const remainingMinutes = Math.ceil(timeRemainingMs / (1000 * 60));

                if (remainingMinutes > 60) {
                    cooldownText = `冷却中 (${Math.ceil(remainingHours)} 小时)`;
                } else {
                    cooldownText = `冷却中 (${remainingMinutes} 分钟)`;
                }
            }
            row.insertCell().innerText = cooldownText;
            const actionCell = row.insertCell(); // This is the "操作" column
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.classList.add('mapping-checkbox');
            checkbox.value = mapping.id;
            checkbox.checked = selectedMappingIds.has(mapping.id);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    selectedMappingIds.add(mapping.id);
                } else {
                    selectedMappingIds.delete(mapping.id);
                }
                updateResetButtonState();
                // If any checkbox is unchecked, uncheck the "select all" checkbox
                if (!checkbox.checked) {
                    selectAllMappingsCheckbox.checked = false;
                } else {
                    // If all checkboxes on the current page are checked, check "select all"
                    const allChecked = Array.from(document.querySelectorAll('.mapping-checkbox')).every(cb => cb.checked);
                    selectAllMappingsCheckbox.checked = allChecked;
                }
            });
            actionCell.appendChild(checkbox);
        });
        updateResetButtonState();
    }

    // Function to fetch mappings and then display the current page
    async function fetchAndDisplayMappings(page = 1) {
        try {
            const response = await fetch(`/api/admin/mappings?page=${page}&limit=${itemsPerPage}`, {
                headers: { 'Authorization': `Bearer ${getAuthToken()}` }
            });
            if (response.ok) {
                const data = await response.json();
                totalMappings = data.total;
                availableMappings = data.available;
                currentPage = data.page;

                mappingStats.innerText = `可用数: ${availableMappings} / 总条数: ${totalMappings}`;
                linkQuantityInput.max = availableMappings > 0 ? availableMappings : 1; // Update max attribute
                if (parseInt(linkQuantityInput.value) > availableMappings && availableMappings > 0) {
                    linkQuantityInput.value = availableMappings; // Adjust current value if it exceeds new max
                } else if (availableMappings === 0) {
                    linkQuantityInput.value = 1; // If no available, set to 1 (min)
                }
                displayMappingsForPage(data.data);
                renderPaginationControls(totalMappings, currentPage, itemsPerPage);
            } else if (response.status === 401 || response.status === 403) {
                removeAuthToken();
                showAdminContent();
            } else {
                console.error('Failed to fetch mappings:', response.statusText);
                currentMappingsMessage.className = 'mt-2 alert alert-danger';
                currentMappingsMessage.innerText = '加载号码映射失败。';
                renderPaginationControls(0, 1, itemsPerPage);
            }
        } catch (error) {
            console.error('Error fetching mappings:', error);
            currentMappingsMessage.className = 'mt-2 alert alert-danger';
            currentMappingsMessage.innerText = '网络错误或服务器无响应，无法加载号码映射。';
            renderPaginationControls(0, 1, itemsPerPage);
        }
    }

    // Event listener for deleting all data
    confirmDeleteAllBtn.addEventListener('click', async () => {
        deleteAllMessage.innerHTML = '';
        if (confirmDeleteInput.value === '确认') {
            try {
                const response = await fetch('/api/admin/delete-all-data', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${getAuthToken()}`
                    }
                });
                const data = await response.json();
                if (response.ok) {
                    deleteAllMessage.className = 'mt-2 alert alert-success';
                    deleteAllMessage.innerText = data.message;
                    confirmDeleteAllModal.hide();
                    selectedMappingIds.clear(); // Clear selections after deleting all
                    updateResetButtonState();
                    window.location.reload();
                } else if (response.status === 401 || response.status === 403) {
                    removeAuthToken();
                    showAdminContent();
                } else {
                    throw new Error(data.message || '删除所有数据失败');
                }
            } catch (error) {
                deleteAllMessage.className = 'mt-2 alert alert-danger';
                deleteAllMessage.innerText = error.message;
            }
        } else {
            deleteAllMessage.className = 'mt-2 alert alert-warning';
            deleteAllMessage.innerText = '请输入“确认”以继续。';
        }
    });

    // Event listener for "Select All" checkbox
    selectAllMappingsCheckbox.addEventListener('change', (event) => {
        const isChecked = event.target.checked;
        document.querySelectorAll('.mapping-checkbox').forEach(checkbox => {
            checkbox.checked = isChecked;
            const mappingId = parseInt(checkbox.value, 10);
            if (isChecked) {
                selectedMappingIds.add(mappingId);
            } else {
                selectedMappingIds.delete(mappingId);
            }
        });
        updateResetButtonState();
    });

    // Event listener for "Reset Selected Cooldown" button
    resetSelectedCooldownBtn.addEventListener('click', async () => {
        if (selectedMappingIds.size === 0) {
            alert('请至少选择一个号码进行重置。');
            return;
        }

        if (confirm(`确定要重置选中的 ${selectedMappingIds.size} 个号码的冷却时间吗？`)) {
            try {
                const response = await fetch('/api/admin/mappings/reset-cooldown-batch', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${getAuthToken()}`
                    },
                    body: JSON.stringify({ ids: Array.from(selectedMappingIds) })
                });
                const data = await response.json();
                if (response.ok) {
                    alert(data.message);
                    selectedMappingIds.clear(); // Clear selections after successful reset
                    updateResetButtonState();
                    fetchAndDisplayMappings(currentPage); // Refresh the list
                } else if (response.status === 401 || response.status === 403) {
                    removeAuthToken();
                    showAdminContent();
                } else {
                    throw new Error(data.message || '批量重置冷却失败');
                }
            } catch (error) {
                alert(error.message);
            }
        }
    });

    saveConfigBtn.addEventListener('click', async () => {
        configMessage.innerHTML = '';
        try {
            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            };

            // Save targetUrl
            let response = await fetch('/api/admin/config', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ key: 'targetUrl', value: targetUrlInput.value })
            });
            let data = await response.json();
            if (!response.ok) throw new Error(data.message || '保存 targetUrl 失败');

            // Save announcement
            response = await fetch('/api/admin/config', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ key: 'announcement', value: announcementInput.value })
            });
            data = await response.json();
            if (!response.ok) throw new Error(data.message || '保存公告失败');

            // Save cooldownPeriod
            response = await fetch('/api/admin/config', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ key: 'cooldownPeriod', value: cooldownPeriodInput.value })
            });
            data = await response.json();
            if (!response.ok) throw new Error(data.message || '保存冷却时间失败');

            // Save validityPeriod
            response = await fetch('/api/admin/config', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ key: 'validityPeriod', value: validityPeriodInput.value })
            });
            data = await response.json();
            if (!response.ok) throw new Error(data.message || '保存链接有效期失败');

            // Save cyclePeriod
            response = await fetch('/api/admin/config', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ key: 'cyclePeriod', value: cyclePeriodInput.value })
            });
            data = await response.json();
            if (!response.ok) throw new Error(data.message || '保存号码使用周期失败');

            // Save shortLinkExpiry
            response = await fetch('/api/admin/config', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ key: 'shortLinkExpiry', value: shortLinkExpiryInput.value })
            });
            data = await response.json();
            if (!response.ok) throw new Error(data.message || '保存短链时效失败');

            configMessage.className = 'mt-2 alert alert-success';
            configMessage.innerText = '配置保存成功！';
        } catch (error) {
            if (error.message.includes('401') || error.message.includes('403')) {
                removeAuthToken();
                showAdminContent();
            }
            configMessage.className = 'mt-2 alert alert-danger';
            configMessage.innerText = error.message;
        }
    });

    confirmImportMappingsBtn.addEventListener('click', async () => {
        mappingsMessage.innerHTML = '';
        const rawMappings = mappingsInput.value.trim();
        if (!rawMappings) {
            mappingsMessage.className = 'mt-2 alert alert-warning';
            mappingsMessage.innerText = '请输入要导入的映射数据。';
            return;
        }

        const mappings = rawMappings.split('\n').map(line => {
            const parts = line.trim().split(/\s+/); // Split by one or more spaces
            if (parts.length === 2) {
                return { com_port: parts[0].trim(), phone_number: parts[1].trim() };
            }
            return null;
        }).filter(m => m !== null);

        if (mappings.length === 0) {
            mappingsMessage.className = 'mt-2 alert alert-warning';
            mappingsMessage.innerText = '没有有效的映射数据被解析。请检查格式。';
            return;
        }

        try {
            const response = await fetch('/api/admin/mappings/import', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getAuthToken()}`
                },
                body: JSON.stringify(mappings)
            });
            const data = await response.json();
            if (response.ok) {
                mappingsMessage.className = 'mt-2 alert alert-success';
                mappingsMessage.innerText = data.message;
                currentPage = 1; // Reset to first page after import
                fetchAndDisplayMappings(); // Refresh mappings after import
                importMappingsModal.hide(); // Close the modal on successful import
            } else if (response.status === 401 || response.status === 403) {
                removeAuthToken();
                showAdminContent();
            } else {
                throw new Error(data.message || '导入号码失败');
            }
        } catch (error) {
            mappingsMessage.className = 'mt-2 alert alert-danger';
            mappingsMessage.innerText = error.message;
        }
    });

    async function generateLinks(isShort = false) {
        linkMessage.innerHTML = '';
        linkOutputContainer.innerHTML = ''; // Clear previous links
        const quantity = parseInt(linkQuantityInput.value, 10);
        if (isNaN(quantity) || quantity < 1) {
            linkMessage.className = 'mt-2 alert alert-warning';
            linkMessage.innerText = '请输入有效的生成数量。';
            return;
        }

        try {
            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            };

            const generatedLinks = [];
            let failedCount = 0;
            let errorMessage = '';
            const apiEndpoint = isShort ? '/api/admin/shortlinks' : '/api/admin/links';

            try {
                const response = await fetch(apiEndpoint, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ quantity }) // Pass quantity in the request body
                });
                const data = await response.json();
                if (response.ok) {
                    const links = data.links || []; // Assuming the backend returns an array of links
                    links.forEach(link => {
                        const linkDiv = document.createElement('div');
                        linkDiv.className = 'mb-1';
                        linkDiv.innerText = link;
                        linkOutputContainer.appendChild(linkDiv);
                    });
                    linkMessage.className = 'mt-2 alert alert-success';
                    linkMessage.innerText = `成功生成 ${links.length} 个${isShort ? '短效' : ''}链接！`;
                } else if (response.status === 401 || response.status === 403) {
                    removeAuthToken();
                    showAdminContent();
                } else {
                    throw new Error(data.message || '生成链接失败');
                }
            } catch (error) {
                linkMessage.className = 'mt-2 alert alert-danger';
                linkMessage.innerText = error.message;
            }
        } catch (error) {
            // This catch block will only be hit if there's an error before the loop starts,
            // or if a critical error occurs that prevents even attempting to generate links.
            linkMessage.className = 'mt-2 alert alert-danger';
            linkMessage.innerText = error.message;
        }
    }

    generateLinkBtn.addEventListener('click', () => generateLinks(false));
    generateShortLinkBtn.addEventListener('click', () => generateLinks(true));

    // Initial load of configs when admin page loads
    async function fetchAndDisplayConfigs() {
        try {
            const response = await fetch('/api/admin/configs', {
                headers: { 'Authorization': `Bearer ${getAuthToken()}` }
            }); // New endpoint to get all configs
            if (response.ok) {
                const configs = await response.json();
                configs.forEach(config => {
                    if (config.config_key === 'targetUrl') {
                        targetUrlInput.value = config.config_value;
                    } else if (config.config_key === 'announcement') {
                        announcementInput.value = config.config_value;
                    } else if (config.config_key === 'cooldownPeriod') {
                        cooldownPeriodInput.value = config.config_value;
                        globalCooldownPeriod = parseInt(config.config_value, 10); // Update global variable
                    } else if (config.config_key === 'validityPeriod') {
                        validityPeriodInput.value = config.config_value;
                    } else if (config.config_key === 'cyclePeriod') {
                        cyclePeriodInput.value = config.config_value;
                    } else if (config.config_key === 'shortLinkExpiry') {
                        shortLinkExpiryInput.value = config.config_value;
                    }
                });
            } else if (response.status === 401 || response.status === 403) {
                removeAuthToken();
                showAdminContent();
            } else {
                console.error('Failed to fetch configs:', response.statusText);
            }
        } catch (error) {
            console.error('Error fetching configs:', error);
        }
    }

    // Login functionality
    loginBtn.addEventListener('click', async () => {
        loginMessage.innerHTML = '';
        const secretKey = secretKeyInput.value;
        if (!secretKey) {
            loginMessage.className = 'mt-2 alert alert-warning';
            loginMessage.innerText = '请输入管理员密钥。';
            return;
        }

        try {
            const response = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ secretKey })
            });
            const data = await response.json();
            if (response.ok) {
                setAuthToken(data.token);
                loginMessage.className = 'mt-2 alert alert-success';
                loginMessage.innerText = '登录成功！';
                showAdminContent();
            } else {
                throw new Error(data.message || '登录失败');
            }
        } catch (error) {
            loginMessage.className = 'mt-2 alert alert-danger';
            loginMessage.innerText = error.message;
        }
    });

    // Initial check for token and display content
    showAdminContent();

    // Event listener for decrease quantity button
    decreaseQuantityBtn.addEventListener('click', () => {
        let value = parseInt(linkQuantityInput.value);
        if (value > 1) {
            linkQuantityInput.value = value - 1;
        }
    });

    // Event listener for increase quantity button
    increaseQuantityBtn.addEventListener('click', () => {
        let value = parseInt(linkQuantityInput.value);
        let max = parseInt(linkQuantityInput.max);
        if (value < max) {
            linkQuantityInput.value = value + 1;
        }
    });

    // Event listener for link quantity input to ensure it doesn't exceed max
    linkQuantityInput.addEventListener('input', () => {
        let value = parseInt(linkQuantityInput.value);
        let max = parseInt(linkQuantityInput.max);
        if (value > max) {
            linkQuantityInput.value = max;
        }
        if (value < 1) {
            linkQuantityInput.value = 1;
        }
    });
});
