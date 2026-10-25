// 全局狀態管理
let tasks = JSON.parse(localStorage.getItem('taskmaster_tasks')) || [];
let userSettings = JSON.parse(localStorage.getItem('taskmaster_settings')) || {
    userName: '',
    defaultPriority: 'medium',
    defaultCategory: '工作',
    enableConfetti: true,
    enableBgParticles: true
};
const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyB2H5FkLy5uAM37ahwpLe-JXC2Ris1OvT0',
    authDomain: 'sparklish-app.firebaseapp.com',
    projectId: 'sparklish-app',
    storageBucket: 'sparklish-app.firebasestorage.app',
    messagingSenderId: '318431108286',
    appId: '1:318431108286:web:6975090f95f5914e7152ef'
};
const LOCAL_TASKS_KEY = 'taskmaster_tasks';
const LOCAL_TASKS_BACKUP_KEY = 'sparklish_local_tasks_backup';
const CLOUD_CACHE_UID_KEY = 'sparklish_cloud_cache_uid';
let googleUser = null;
let firebaseAuth = null;
let firestore = null;
let cloudSyncActive = false;
let cloudUnsubscribe = null;
let cloudWriteQueue = Promise.resolve();
let cloudWriteError = null;
let pendingLocalDataChoice = null;
let signInInProgress = false;
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
    initFilterFromHash();

    // 初始化 Firebase Google 登入與雲端同步
    initFirebaseAuth();
    updateGoogleUserUI();

    // 監聽網址 Hash (#) 變化，支援上一頁/下一頁切換
    window.addEventListener('hashchange', handleHashChange);

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
    
    updateGoogleUserUI();
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

async function resetAllData() {
    const cloudWarning = googleUser ? '\n\n此 Google 帳號的雲端任務也會一併刪除。' : '';
    if (!confirm(`確定要刪除所有待辦事項並重置設定嗎？此操作無法復原！${cloudWarning}`)) {
        return;
    }

    try {
        if (googleUser && firestore) {
            await cloudWriteQueue;
            await getUserTasksDocument(googleUser.id).delete();
        }

        if (cloudUnsubscribe) cloudUnsubscribe();
        cloudUnsubscribe = null;
        cloudSyncActive = false;
        localStorage.removeItem(LOCAL_TASKS_KEY);
        localStorage.removeItem(LOCAL_TASKS_BACKUP_KEY);
        localStorage.removeItem(CLOUD_CACHE_UID_KEY);
        localStorage.removeItem('taskmaster_settings');
        localStorage.removeItem('sparklish_google_user');
        tasks = [];
        userSettings = {
            userName: '',
            defaultPriority: 'medium',
            defaultCategory: '工作',
            enableConfetti: true,
            enableBgParticles: true
        };

        if (firebaseAuth && firebaseAuth.currentUser) {
            await firebaseAuth.signOut();
        }
        googleUser = null;
        updateGoogleUserUI();
        initSettingsUI();
        renderTasks();
        closeSettingsModal();
        showModal('重置成功', '所有本機資料與此帳號的雲端任務已清除。', 'fa-solid fa-rotate-left');
    } catch (err) {
        console.error('重置資料失敗:', err);
        showModal('重置失敗', '資料未能完整清除，請確認網路連線後再試。', 'fa-solid fa-triangle-exclamation');
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

function setFilter(filter, updateHash = true) {
    const validFilters = ['all', 'pending', 'completed'];
    if (!validFilters.includes(filter)) {
        filter = 'all';
    }
    currentFilter = filter;

    document.querySelectorAll('.nav-link').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`nav-${filter}`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }

    if (updateHash && window.location.hash.slice(1).toLowerCase() !== filter) {
        window.location.hash = filter;
    }

    updateViewTitle();
    renderTasks();
}

function handleHashChange() {
    const hash = window.location.hash.slice(1).toLowerCase();
    if (['all', 'pending', 'completed'].includes(hash) && hash !== currentFilter) {
        setFilter(hash, false);
    }
}

function initFilterFromHash() {
    const hash = window.location.hash.slice(1).toLowerCase();
    if (['all', 'pending', 'completed'].includes(hash)) {
        setFilter(hash, false);
    } else {
        setFilter('all', false);
    }
}

function updateViewTitle() {
    const prefix = userSettings.userName ? `${userSettings.userName} `:'';
    const titleMap = {
        all: `${prefix}我的一天`,
        pending: `${prefix}我的任務`,
        completed: `${prefix}我的已完成事項`
    };
    document.getElementById('view-title').innerText = titleMap[currentFilter] || `${prefix} Sparklish`;
}

function setCategoryFilter(cat) {
    currentCategory = cat;
    renderTasks();
}

function saveAndRender() {
    localStorage.setItem(LOCAL_TASKS_KEY, JSON.stringify(tasks));
    renderTasks();
    if (cloudSyncActive && googleUser && firestore) {
        queueCloudTasksWrite(googleUser.id, tasks);
    }
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

        const emptyIcon = document.getElementById('empty-icon');
        const emptyTitle = document.getElementById('empty-title');
        const emptySubtitle = document.getElementById('empty-subtitle');

        if (searchKeyword) {
            if (emptyIcon) emptyIcon.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
            if (emptyTitle) emptyTitle.innerText = '找不到符合條件的任務';
            if (emptySubtitle) emptySubtitle.innerText = '請嘗試使用其他關鍵字搜尋。';
        } else if (currentFilter === 'completed') {
            if (emptyIcon) emptyIcon.innerHTML = '<i class="fa-regular fa-circle-check"></i>';
            if (emptyTitle) emptyTitle.innerText = '目前沒有已完成的任務';
            if (emptySubtitle) emptySubtitle.innerText = '完成進行中的任務後，將會在此顯示。';
        } else if (currentFilter === 'pending') {
            if (emptyIcon) emptyIcon.innerHTML = '<i class="fa-regular fa-clock"></i>';
            if (emptyTitle) emptyTitle.innerText = '太棒了，目前沒有進行中的任務！';
            if (emptySubtitle) emptySubtitle.innerText = '在下方建立新任務開始充實的一天。';
        } else {
            if (emptyIcon) emptyIcon.innerHTML = '<i class="fa-solid fa-clipboard-check"></i>';
            if (emptyTitle) emptyTitle.innerText = '太棒了，目前沒有待處理的任務！';
            if (emptySubtitle) emptySubtitle.innerText = '在下方建立新任務開始充實的一天。';
        }
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

// ==========================================
// Firebase Google 登入與 Firestore 同步
// ==========================================

function initFirebaseAuth() {
    try {
        const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(FIREBASE_CONFIG);
        firebaseAuth = app.auth();
        firestore = app.firestore();
        firebaseAuth.onAuthStateChanged(
            user => handleFirebaseAuthState(user).catch(handleCloudLoginError),
            err => handleCloudLoginError(err)
        );
    } catch (err) {
        handleCloudLoginError(err);
    }
}

function getUserTasksDocument(userId) {
    return firestore.collection('users').doc(userId).collection('app').doc('data');
}

function readTasksFromStorage(key) {
    try {
        const stored = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(stored) ? stored : [];
    } catch (err) {
        console.error(`無法讀取本機任務資料 ${key}:`, err);
        return [];
    }
}

function saveCloudTaskCache(userId, taskList) {
    tasks = taskList;
    localStorage.setItem(LOCAL_TASKS_KEY, JSON.stringify(tasks));
    localStorage.setItem(CLOUD_CACHE_UID_KEY, userId);
    renderTasks();
}

function requestLocalDataChoice() {
    return new Promise(resolve => {
        pendingLocalDataChoice = resolve;
        document.getElementById('local-data-status').classList.add('hidden');
        document.getElementById('local-data-keep-cloud').disabled = false;
        document.getElementById('local-data-overwrite').disabled = false;
        document.getElementById('local-data-modal').classList.remove('hidden');
    });
}

function resolveLocalDataChoice(overwriteCloud) {
    if (!pendingLocalDataChoice) return;
    document.getElementById('local-data-status').classList.remove('hidden');
    document.getElementById('local-data-keep-cloud').disabled = true;
    document.getElementById('local-data-overwrite').disabled = true;
    const resolve = pendingLocalDataChoice;
    pendingLocalDataChoice = null;
    resolve(overwriteCloud);
}

function closeLocalDataChoice() {
    document.getElementById('local-data-modal').classList.add('hidden');
    document.getElementById('local-data-keep-cloud').disabled = false;
    document.getElementById('local-data-overwrite').disabled = false;
}

async function handleFirebaseAuthState(user) {
    if (cloudUnsubscribe) cloudUnsubscribe();
    cloudUnsubscribe = null;
    cloudSyncActive = false;

    if (!user) {
        handleFirebaseSignOutState();
        return;
    }

    googleUser = {
        id: user.uid,
        name: user.displayName || user.email || 'Google 使用者',
        email: user.email || '',
        picture: user.photoURL || ''
    };
    localStorage.setItem('sparklish_google_user', JSON.stringify(googleUser));
    if (user.displayName) {
        userSettings.userName = user.displayName;
        localStorage.setItem('taskmaster_settings', JSON.stringify(userSettings));
    }
    updateGoogleUserUI();
    updateViewTitle();

    const cachedUid = localStorage.getItem(CLOUD_CACHE_UID_KEY);
    if (cachedUid && cachedUid !== user.uid) {
        localStorage.removeItem(LOCAL_TASKS_KEY);
        localStorage.removeItem(CLOUD_CACHE_UID_KEY);
        tasks = [];
        renderTasks();
    }
    const localTasks = readTasksFromStorage(LOCAL_TASKS_KEY);
    const hasUnmigratedLocalTasks = cachedUid === null && localTasks.length > 0;
    let shouldOverwriteCloud = false;

    if (hasUnmigratedLocalTasks) {
        shouldOverwriteCloud = await requestLocalDataChoice();
        if (!shouldOverwriteCloud) {
            localStorage.setItem(LOCAL_TASKS_BACKUP_KEY, JSON.stringify(localTasks));
        }
    }

    const userTasksDocument = getUserTasksDocument(user.uid);
    if (shouldOverwriteCloud) {
        try {
            await userTasksDocument.set({
                tasks: localTasks,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (err) {
            cloudSyncActive = false;
            console.error('覆蓋雲端任務失敗:', err);
            closeLocalDataChoice();
            showModal('上傳失敗', '本機任務仍保留在這台裝置，雲端資料沒有被覆蓋。請檢查網路與 Firebase 設定後再登入重試。', 'fa-solid fa-triangle-exclamation');
            signInInProgress = false;
            return;
        }
        localStorage.removeItem(LOCAL_TASKS_BACKUP_KEY);
        saveCloudTaskCache(user.uid, localTasks);
    } else {
        if (hasUnmigratedLocalTasks) {
            tasks = [];
            renderTasks();
        }
        try {
            const snapshot = await userTasksDocument.get();
            const cloudTasks = snapshot.exists && Array.isArray(snapshot.data().tasks)
                ? snapshot.data().tasks
                : [];
            saveCloudTaskCache(user.uid, cloudTasks);
        } catch (err) {
            cloudSyncActive = false;
            console.error('載入雲端任務失敗:', err);
            closeLocalDataChoice();
            showModal('雲端載入失敗', '雲端任務目前無法載入。保留的本機資料沒有被覆蓋，請確認網路與 Firebase 設定後重試。', 'fa-solid fa-triangle-exclamation');
            signInInProgress = false;
            return;
        }
    }

    cloudSyncActive = true;
    subscribeToCloudTasks(user.uid, userTasksDocument);
    closeLocalDataChoice();

    if (signInInProgress) {
        signInInProgress = false;
        if (typeof confetti === 'function' && userSettings.enableConfetti) {
            confetti({ particleCount: 70, spread: 60, origin: { y: 0.8 } });
        }
        showModal('登入成功', `歡迎回來，${googleUser.name}！雲端任務已載入。`, 'fa-solid fa-circle-check');
    }
}

function subscribeToCloudTasks(userId, userTasksDocument) {
    cloudUnsubscribe = userTasksDocument.onSnapshot(snapshot => {
        if (!cloudSyncActive || !googleUser || googleUser.id !== userId) return;
        const cloudTasks = snapshot.exists && Array.isArray(snapshot.data().tasks)
            ? snapshot.data().tasks
            : [];
        saveCloudTaskCache(userId, cloudTasks);
    }, err => {
        cloudSyncActive = false;
        cloudWriteError = err;
        console.error('雲端同步中斷:', err);
        showModal('雲端同步中斷', '目前無法讀取雲端更新。你的本機畫面仍保留，請檢查網路連線。', 'fa-solid fa-triangle-exclamation');
    });
}

function queueCloudTasksWrite(userId, taskList) {
    const taskSnapshot = JSON.parse(JSON.stringify(taskList));
    cloudWriteQueue = cloudWriteQueue.then(async () => {
        if (!cloudSyncActive || !googleUser || googleUser.id !== userId) return;
        await getUserTasksDocument(userId).set({
            tasks: taskSnapshot,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        cloudWriteError = null;
    }).catch(err => {
        cloudWriteError = err;
        console.error('儲存雲端任務失敗:', err);
        showModal('雲端儲存失敗', '這次變更目前只保存在這台裝置，尚未同步到雲端。請檢查網路後再試。', 'fa-solid fa-triangle-exclamation');
    });
}

function handleCloudLoginError(err) {
    console.error('Firebase 初始化或登入狀態錯誤:', err);
    showModal('Firebase 連線失敗', '無法連接 Firebase。請確認網路、Firebase 設定及 Firestore 規則後再重新整理。', 'fa-solid fa-triangle-exclamation');
    signInInProgress = false;
}

function handleFirebaseSignOutState() {
    if (cloudUnsubscribe) cloudUnsubscribe();
    cloudUnsubscribe = null;
    cloudSyncActive = false;
    googleUser = null;
    localStorage.removeItem('sparklish_google_user');

    const hadCloudCache = localStorage.getItem(CLOUD_CACHE_UID_KEY) !== null;
    localStorage.removeItem(CLOUD_CACHE_UID_KEY);
    if (hadCloudCache) localStorage.removeItem(LOCAL_TASKS_KEY);

    const savedLocalTasks = localStorage.getItem(LOCAL_TASKS_BACKUP_KEY);
    if (savedLocalTasks !== null) {
        localStorage.setItem(LOCAL_TASKS_KEY, savedLocalTasks);
        localStorage.removeItem(LOCAL_TASKS_BACKUP_KEY);
    }
    tasks = readTasksFromStorage(LOCAL_TASKS_KEY);
    updateGoogleUserUI();
    updateViewTitle();
    renderTasks();
}

// 更新頂部帳號面板與設定視窗中的 Google 帳號狀態
function updateGoogleUserUI() {
    const signinWrapper = document.getElementById('google-signin-wrapper');
    const profileCard = document.getElementById('google-profile-card');
    const userAvatar = document.getElementById('google-user-avatar');
    const userName = document.getElementById('google-user-name');
    const userEmail = document.getElementById('google-user-email');

    const settingGoogleStatus = document.getElementById('setting-google-status');

    if (googleUser) {
        // 隱藏登入按鈕，顯示個人卡片
        if (signinWrapper) signinWrapper.classList.add('hidden');
        if (profileCard) {
            profileCard.classList.remove('hidden');
            profileCard.classList.add('flex');
        }
        if (userAvatar) userAvatar.src = googleUser.picture || 'icons/icon-64.png';
        if (userName) userName.innerText = googleUser.name;
        if (userEmail) userEmail.innerText = googleUser.email;

        // 系統設定視窗狀態
        if (settingGoogleStatus) {
            settingGoogleStatus.innerText = `已登入: ${googleUser.name}`;
            settingGoogleStatus.className = 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-semibold';
        }

    } else {
        // 未登入狀態
        if (signinWrapper) signinWrapper.classList.remove('hidden');
        if (profileCard) {
            profileCard.classList.add('hidden');
            profileCard.classList.remove('flex');
        }

        if (settingGoogleStatus) {
            settingGoogleStatus.innerText = '未登入';
            settingGoogleStatus.className = 'text-[10px] px-2 py-0.5 rounded-full bg-black/20 opacity-60';
        }
    }
}

// 點擊 Google 按鈕登入，已登入時則提供登出選項
async function handleGoogleSignInClick() {
    if (googleUser) {
        if (confirm(`目前已登入：${googleUser.name} (${googleUser.email})\n\n確定要登出 Google 帳號嗎？`)) {
            await googleSignOut();
        }
        return;
    }

    if (!firebaseAuth) {
        showModal('Firebase 載入中', 'Firebase 登入服務尚未準備完成，請稍候再試。', 'fa-brands fa-google');
        return;
    }

    signInInProgress = true;
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        await firebaseAuth.signInWithPopup(provider);
    } catch (err) {
        signInInProgress = false;
        if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
            console.error('Google 登入失敗:', err);
            const message = err.code === 'auth/invalid-api-key'
                ? 'Firebase API 金鑰無效，請確認程式中的 Firebase 設定和 Firebase 專案設定完全一致。'
                : err.code === 'auth/unauthorized-domain'
                    ? '此網站網域尚未加入 Firebase Authentication 的授權網域。'
                    : err.code === 'auth/operation-not-allowed'
                        ? 'Firebase 尚未啟用 Google 登入方式。'
                        : `登入失敗（${err.code || '未知錯誤'}）。請檢查 Firebase Authentication 設定，並查看瀏覽器主控台的錯誤訊息。`;
            showModal('Google 登入失敗', message, 'fa-solid fa-triangle-exclamation');
        }
    }
}

// 登出 Google 帳號
async function googleSignOut() {
    if (!firebaseAuth) return;
    try {
        await cloudWriteQueue;
        if (cloudWriteError) {
            if (!googleUser) return;
            cloudSyncActive = true;
            cloudWriteError = null;
            queueCloudTasksWrite(googleUser.id, tasks);
            await cloudWriteQueue;
            if (cloudWriteError) {
                cloudSyncActive = false;
                showModal('暫時無法登出', '有任務尚未成功同步；為避免遺失，請確認網路後再試一次。', 'fa-solid fa-triangle-exclamation');
                return;
            }
        }
        await firebaseAuth.signOut();
        showModal('已登出', '雲端任務已從畫面清除；重新登入後會再次載入。', 'fa-solid fa-arrow-right-from-bracket');
    } catch (err) {
        console.error('Google 登出失敗:', err);
        showModal('登出失敗', '目前無法登出，請稍後再試。', 'fa-solid fa-triangle-exclamation');
    }
}
