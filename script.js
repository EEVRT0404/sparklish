// 全局狀態管理
let tasks = JSON.parse(localStorage.getItem('taskmaster_tasks')) || [];
let userSettings = JSON.parse(localStorage.getItem('taskmaster_settings')) || {
    userName: '',
    defaultPriority: 'medium',
    defaultCategory: '工作',
    enableConfetti: true,
    enableBgParticles: true
};
let currentFilter = 'all'; // all, pending, completed
let currentCategory = 'all'; // all, 工作, 個人, 學習, 健康
let currentTheme = localStorage.getItem('taskmaster_theme') || 'system';

// 初始化
window.onload = () => {
    initTheme();
    initSettingsUI();
    if (userSettings.enableBgParticles) {
        initCanvasBg();
    } else {
        document.getElementById('bg-canvas').style.display = 'none';
    }
    updateCurrentDate();
    renderTasks();

    // 監聽系統深色模式變化
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (currentTheme === 'system') {
            applyTheme('system');
        }
    });
};

function updateCurrentDate() {
    const now = new Date();
    const options = { weekday: 'long', month: 'long', day: 'numeric' };
    document.getElementById('current-date').innerText = now.toLocaleDateString('zh-TW', options);
}

// --- 設定 Modal 控制 ---
function openSettingsModal() {
    document.getElementById('setting-theme').value = currentTheme;
    document.getElementById('setting-username').value = userSettings.userName || '';
    document.getElementById('setting-default-priority').value = userSettings.defaultPriority || 'medium';
    document.getElementById('setting-default-category').value = userSettings.defaultCategory || '工作';
    document.getElementById('setting-enable-confetti').checked = userSettings.enableConfetti ?? true;
    document.getElementById('setting-enable-bg-particles').checked = userSettings.enableBgParticles ?? true;
    
    document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettingsModal() {
    document.getElementById('settings-modal').classList.add('hidden');
}

function initSettingsUI() {
    document.getElementById('priority-input').value = userSettings.defaultPriority || 'medium';
    document.getElementById('category-input').value = userSettings.defaultCategory || '工作';
    updateViewTitle();
}

function saveSettings() {
    userSettings.userName = document.getElementById('setting-username').value.trim();
    userSettings.defaultPriority = document.getElementById('setting-default-priority').value;
    userSettings.defaultCategory = document.getElementById('setting-default-category').value;
    userSettings.enableConfetti = document.getElementById('setting-enable-confetti').checked;
    userSettings.enableBgParticles = document.getElementById('setting-enable-bg-particles').checked;

    localStorage.setItem('taskmaster_settings', JSON.stringify(userSettings));
    initSettingsUI();
    closeSettingsModal();
    showModal('設定已儲存', '您的偏好設定已成功更新！', 'fa-solid fa-circle-check');
}

function toggleBgCanvas(enabled) {
    const canvasEl = document.getElementById('bg-canvas');
    if (enabled) {
        canvasEl.style.display = 'block';
        if (!canvas) initCanvasBg();
    } else {
        canvasEl.style.display = 'none';
    }
}

function resetAllData() {
    if (confirm('確定要刪除所有待辦事項並重置設定嗎？此操作無法復原！')) {
        localStorage.removeItem('taskmaster_tasks');
        localStorage.removeItem('taskmaster_settings');
        tasks = [];
        userSettings = {
            userName: '',
            defaultPriority: 'medium',
            defaultCategory: '工作',
            enableConfetti: true,
            enableBgParticles: true
        };
        saveAndRender();
        closeSettingsModal();
        showModal('重置成功', '所有資料與設定已還原為初始狀態！', 'fa-solid fa-rotate-left');
    }
}

// --- 佈景主題切換 ---
function changeTheme(themeName) {
    currentTheme = themeName;
    localStorage.setItem('taskmaster_theme', themeName);
    applyTheme(themeName);
}

function applyTheme(themeName) {
    let actualTheme = themeName;
    if (themeName === 'system') {
        const isSystemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        actualTheme = isSystemDark ? 'dark-premium' : 'minimal-light';
    }
    document.documentElement.setAttribute('data-theme', actualTheme);
}

function initTheme() {
    applyTheme(currentTheme);
}

// --- 手機版側邊欄切換 ---
function toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('hidden');
    sidebar.classList.toggle('fixed');
    sidebar.classList.toggle('inset-y-0');
    sidebar.classList.toggle('left-0');
    sidebar.classList.toggle('z-50');
    sidebar.classList.toggle('w-64');
}

// --- 任務 CRUD 操作 ---
function handleAddTask(e) {
    e.preventDefault();
    const input = document.getElementById('task-input');
    const title = input.value.trim();
    const priority = document.getElementById('priority-input').value;
    const category = document.getElementById('category-input').value;
    const dueDate = document.getElementById('duedate-input').value;

    if (!title) return;

    const newTask = {
        id: Date.now().toString(),
        title: title,
        completed: false,
        priority: priority,
        category: category,
        dueDate: dueDate,
        createdAt: new Date().toISOString()
    };

    tasks.unshift(newTask);
    saveAndRender();
    input.value = '';

    if (userSettings.enableConfetti) {
        triggerConfetti(0.1, { spread: 30, startVelocity: 15 });
    }
}

function toggleTask(id) {
    tasks = tasks.map(t => {
        if (t.id === id) {
            const updated = { ...t, completed: !t.completed };
            if (updated.completed && userSettings.enableConfetti) {
                triggerConfetti(0.5, { spread: 70, origin: { y: 0.6 } });
            }
            return updated;
        }
        return t;
    });
    saveAndRender();
}

function deleteTask(id) {
    const el = document.getElementById(`task-${id}`);
    if (el) {
        el.classList.add('task-exit');
        setTimeout(() => {
            tasks = tasks.filter(t => t.id !== id);
            saveAndRender();
        }, 250);
    }
}

function editTask(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    const newTitle = prompt('修改任務名稱：', task.title);
    if (newTitle !== null && newTitle.trim() !== '') {
        task.title = newTitle.trim();
        saveAndRender();
    }
}

function clearCompleted() {
    const completedCount = tasks.filter(t => t.completed).length;
    if (completedCount === 0) {
        showModal('提示', '目前沒有已完成的任務可供清除。', 'fa-solid fa-info-circle');
        return;
    }
    tasks = tasks.filter(t => !t.completed);
    saveAndRender();
    showModal('成功', `已清理 ${completedCount} 項已完成任務。`, 'fa-solid fa-trash-check');
}

function setFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll('.nav-link').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`nav-${filter}`).classList.add('active');

    updateViewTitle();
    renderTasks();
}

function updateViewTitle() {
    const prefix = userSettings.userName ? `${userSettings.userName} 的` : '';
    const titleMap = {
        all: `${prefix} Sparklish 我的一天`,
        pending: `${prefix}進行中的任務`,
        completed: `${prefix}已完成的事項`
    };
    document.getElementById('view-title').innerText = titleMap[currentFilter] || `${prefix} Sparklish`;
}

function setCategoryFilter(cat) {
    currentCategory = cat;
    renderTasks();
}

function saveAndRender() {
    localStorage.setItem('taskmaster_tasks', JSON.stringify(tasks));
    renderTasks();
}

// --- 渲染 UI ---
function renderTasks() {
    const listEl = document.getElementById('todo-list');
    const emptyEl = document.getElementById('empty-state');
    const searchKeyword = document.getElementById('search-input').value.toLowerCase();
    const sortBy = document.getElementById('sort-select').value;

    // 1. 狀態篩選
    let filtered = tasks.filter(t => {
        if (currentFilter === 'pending') return !t.completed;
        if (currentFilter === 'completed') return t.completed;
        return true;
    });

    // 2. 類別篩選
    if (currentCategory !== 'all') {
        filtered = filtered.filter(t => t.category === currentCategory);
    }

    // 3. 關鍵字搜尋
    if (searchKeyword) {
        filtered = filtered.filter(t => t.title.toLowerCase().includes(searchKeyword));
    }

    // 4. 排序邏輯
    filtered.sort((a, b) => {
        if (sortBy === 'created-desc') return new Date(b.createdAt) - new Date(a.createdAt);
        if (sortBy === 'created-asc') return new Date(a.createdAt) - new Date(b.createdAt);
        if (sortBy === 'priority-desc') {
            const pMap = { high: 3, medium: 2, low: 1 };
            return pMap[b.priority] - pMap[a.priority];
        }
        if (sortBy === 'date-asc') {
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return new Date(a.dueDate) - new Date(b.dueDate);
        }
        return 0;
    });

    listEl.innerHTML = '';

    if (filtered.length === 0) {
        emptyEl.classList.remove('hidden');
        emptyEl.classList.add('flex');
    } else {
        emptyEl.classList.add('hidden');
        emptyEl.classList.remove('flex');
        filtered.forEach(task => {
            listEl.appendChild(createTaskElement(task));
        });
    }

    updateStats();
}

function createTaskElement(task) {
    const div = document.createElement('div');
    div.id = `task-${task.id}`;
    div.className = `task-enter glass-card p-3.5 rounded-xl flex items-center justify-between gap-3 border-l-4 transition hover:translate-x-0.5 ${
        task.completed ? 'opacity-50 border-l-gray-500' : 
        task.priority === 'high' ? 'border-l-red-500' : 
        task.priority === 'medium' ? 'border-l-amber-500' : 'border-l-emerald-500'
    }`;

    const priorityBadge = {
        high: '<span class="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">高</span>',
        medium: '<span class="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">中</span>',
        low: '<span class="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">低</span>'
    }[task.priority];

    div.innerHTML = `
        <div class="flex items-center gap-3 flex-1 min-w-0">
            <button onclick="toggleTask('${task.id}')" class="custom-checkbox w-5 h-5 rounded-lg border border-[var(--color-border)] flex items-center justify-center text-xs shrink-0 ${task.completed ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white' : ''}">
                ${task.completed ? '<i class="fa-solid fa-check"></i>' : ''}
            </button>
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-medium text-sm break-all ${task.completed ? 'line-through opacity-70' : ''}">${escapeHtml(task.title)}</span>
                    ${priorityBadge}
                    <span class="text-[10px] bg-black/20 border border-[var(--color-border)] px-2 py-0.5 rounded-full opacity-70">${task.category}</span>
                </div>
                ${task.dueDate ? `<div class="text-[10px] opacity-50 mt-0.5"><i class="fa-regular fa-calendar-xmark mr-1"></i>${task.dueDate}</div>` : ''}
            </div>
        </div>

        <div class="flex items-center gap-1 shrink-0">
            <button onclick="editTask('${task.id}')" class="p-1.5 hover:bg-white/10 rounded-lg opacity-60 hover:opacity-100 transition text-xs">
                <i class="fa-solid fa-pen"></i>
            </button>
            <button onclick="deleteTask('${task.id}')" class="p-1.5 hover:bg-red-500/20 text-red-400 rounded-lg transition text-xs">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `;
    return div;
}

function updateStats() {
    const total = tasks.length;
    const completed = tasks.filter(t => t.completed).length;
    const pending = total - completed;
    const rate = total === 0 ? 0 : Math.round((completed / total) * 100);

    document.getElementById('count-all').innerText = total;
    document.getElementById('count-pending').innerText = pending;
    document.getElementById('count-completed').innerText = completed;

    document.getElementById('stat-rate').innerText = `${rate}%`;
    document.getElementById('progress-bar').style.width = `${rate}%`;
}

// --- 備份 匯入/匯出 JSON ---
function exportTasks() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tasks, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `sparklish_backup_${new Date().toISOString().slice(0,10)}.json`);
    dlAnchorElem.click();
    showModal('匯出成功', '已順利下載 JSON 備份檔！', 'fa-solid fa-file-export');
}

function importTasksTrigger() {
    document.getElementById('import-file').click();
}

function importTasks(event) {
    const fileReader = new FileReader();
    fileReader.onload = function(e) {
        try {
            const importedTasks = JSON.parse(e.target.result);
            if (Array.isArray(importedTasks)) {
                tasks = importedTasks;
                saveAndRender();
                showModal('匯入成功', '已載入備份任務。', 'fa-solid fa-file-import');
            } else {
                showModal('錯誤', '檔案格式不符！', 'fa-solid fa-triangle-exclamation');
            }
        } catch (err) {
            showModal('錯誤', '無法讀取該 JSON 檔案。', 'fa-solid fa-circle-xmark');
        }
    };
    if(event.target.files[0]) {
        fileReader.readAsText(event.target.files[0]);
    }
}

// --- 自訂 Modal ---
function showModal(title, msg, iconClass = 'fa-solid fa-info-circle') {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-msg').innerText = msg;
    document.getElementById('modal-icon').innerHTML = `<i class="${iconClass}"></i>`;
    document.getElementById('custom-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('custom-modal').classList.add('hidden');
}

function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// --- 特效 1：彩帶爆破 ---
function triggerConfetti(particleRatio, opts) {
    if (typeof confetti === 'function') {
        confetti(Object.assign({
            origin: { y: 0.7 },
            zIndex: 999
        }, opts, {
            particleCount: Math.floor(150 * particleRatio)
        }));
    }
}

// --- 特效 2：Canvas 流體背景粒子 ---
let canvas, ctx, particles = [];
function initCanvasBg() {
    canvas = document.getElementById('bg-canvas');
    ctx = canvas.getContext('2d');
    resizeCanvas();

    window.addEventListener('resize', resizeCanvas);

    particles = [];
    const particleCount = Math.floor((window.innerWidth * window.innerHeight) / 18000);
    for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle());
    }

    animateParticles();
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

class Particle {
    constructor() {
        this.reset();
    }

    reset() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.radius = Math.random() * 2 + 0.5;
        this.vx = (Math.random() - 0.5) * 0.4;
        this.vy = (Math.random() - 0.5) * 0.4;
        this.alpha = Math.random() * 0.4 + 0.1;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;

        if (this.x < 0 || this.x > canvas.width || this.y < 0 || this.y > canvas.height) {
            this.reset();
        }
    }

    draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim();
        ctx.globalAlpha = this.alpha;
        ctx.fill();
    }
}

function animateParticles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
        p.update();
        p.draw();
    });
    requestAnimationFrame(animateParticles);
}
