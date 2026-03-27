const vscode = acquireVsCodeApi();
function send(cmd, data) { vscode.postMessage({ command: cmd, data }); }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ══════════════════════════════════════════════════════════════
// Shared: fuzzy search
// ══════════════════════════════════════════════════════════════
function trigrams(s) {
    s = '  ' + s.toLowerCase() + ' ';
    const t = new Set();
    for (let i = 0; i < s.length - 2; i++) t.add(s.slice(i, i + 3));
    return t;
}
function trigramSim(a, b) {
    const ta = trigrams(a), tb = trigrams(b);
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    return (2 * inter) / (ta.size + tb.size) || 0;
}
function jaroWinkler(s, t) {
    s = s.toLowerCase(); t = t.toLowerCase();
    if (s === t) return 1;
    const sl = s.length, tl = t.length;
    const md = Math.max(Math.floor(Math.max(sl, tl) / 2) - 1, 0);
    const sm = new Array(sl).fill(false), tm = new Array(tl).fill(false);
    let matches = 0, trans = 0;
    for (let i = 0; i < sl; i++) {
        const lo = Math.max(0, i - md), hi = Math.min(i + md + 1, tl);
        for (let j = lo; j < hi; j++) {
            if (!tm[j] && s[i] === t[j]) { sm[i] = tm[j] = true; matches++; break; }
        }
    }
    if (!matches) return 0;
    let k = 0;
    for (let i = 0; i < sl; i++) {
        if (!sm[i]) continue;
        while (!tm[k]) k++;
        if (s[i] !== t[k]) trans++;
        k++;
    }
    const jaro = (matches / sl + matches / tl + (matches - trans / 2) / matches) / 3;
    let pfx = 0;
    for (let i = 0; i < Math.min(4, sl, tl); i++) { if (s[i] === t[i]) pfx++; else break; }
    return jaro + pfx * 0.1 * (1 - jaro);
}
function fuzzyScore(query, candidate) {
    query = query.toLowerCase(); candidate = candidate.toLowerCase();
    if (candidate.includes(query)) return 1;
    return 0.55 * trigramSim(query, candidate) + 0.45 * jaroWinkler(query, candidate);
}

// ══════════════════════════════════════════════════════════════
// Shared: spin refresh icon
// ══════════════════════════════════════════════════════════════
function spinRefresh(id) {
    const el = document.getElementById(id);
    if (!el) { return; }
    el.classList.remove('spin-once');
    void el.offsetWidth;
    el.classList.add('spin-once');
    el.addEventListener('animationend', () => el.classList.remove('spin-once'), { once: true });
}

// ══════════════════════════════════════════════════════════════
// Tab switching
// ══════════════════════════════════════════════════════════════
let currentDynamic = null;
let _examplesLoaded = false;
let _libLoaded = false;

function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (btn) btn.classList.add('active');

    if (tabId === 'dynamic' && currentDynamic) {
        document.getElementById('tab-' + currentDynamic).classList.add('active');
    } else {
        const panel = document.getElementById('tab-' + tabId);
        if (panel) panel.classList.add('active');
    }

    // Lazy-load data on first visit
    if (tabId === 'examples' && !_examplesLoaded) {
        _examplesLoaded = true;
        exLoad();
    }
    if (tabId === 'library' && !_libLoaded) {
        _libLoaded = true;
        libLoad();
    }

    closeOverflow();
    recalcTabs();
}

function showDynamicTab(panelId) {
    currentDynamic = panelId;
    const dynBtn = document.querySelector('.tab-dynamic');
    dynBtn.style.display = '';
    dynBtn.textContent = panelId === 'newProject' ? 'New Project' : 'Board Maker';
    switchTab('dynamic');

    if (panelId === 'newProject') {
        send('npRefreshBoards');
    }
}

// ══════════════════════════════════════════════════════════════
// Responsive tab overflow / vertical layout
// ══════════════════════════════════════════════════════════════
const VERTICAL_TAB_THRESHOLD = 200;
let _recalcRAF = null;

function recalcTabs() {
    if (_recalcRAF) cancelAnimationFrame(_recalcRAF);
    _recalcRAF = requestAnimationFrame(_recalcTabsImpl);
}

function _recalcTabsImpl() {
    const tabBar = document.getElementById('tabBar');
    const tabRow = document.getElementById('tabRow');
    const overflowBtn = document.querySelector('.tab-overflow-btn');
    const overflowDynamic = document.getElementById('overflowDynamic');
    const barWidth = tabBar.offsetWidth;

    // Vertical mode — show only the active tab + "..." button
    if (barWidth > 0 && barWidth < VERTICAL_TAB_THRESHOLD) {
        tabBar.classList.add('vertical-tabs');
        overflowDynamic.innerHTML = '';
        const allVTabs = Array.from(tabRow.querySelectorAll('.tab-btn'))
            .filter(b => b.style.display !== 'none');
        allVTabs.forEach(b => {
            if (b.classList.contains('active')) {
                b.classList.remove('tab-overflowed');
            } else {
                b.classList.add('tab-overflowed');
                const clone = document.createElement('button');
                clone.className = 'tab-btn overflow-tab';
                clone.textContent = b.textContent;
                const tabId = b.dataset.tab;
                clone.addEventListener('click', () => {
                    if (tabId === 'dynamic') showDynamicTab(currentDynamic || 'newProject');
                    else switchTab(tabId);
                });
                overflowDynamic.appendChild(clone);
            }
        });
        overflowBtn.style.display = '';
        return;
    }
    tabBar.classList.remove('vertical-tabs');

    // Reset all tabs to visible for measurement
    const allTabs = Array.from(tabRow.querySelectorAll('.tab-btn'))
        .filter(b => b.style.display !== 'none'); // skip hidden dynamic tab
    allTabs.forEach(b => b.classList.remove('tab-overflowed'));
    overflowDynamic.innerHTML = '';

    // Measure available width (row minus overflow button)
    const availableWidth = tabRow.clientWidth;
    const btnWidth = overflowBtn.offsetWidth;

    // Measure each tab's natural width
    let usedWidth = 0;
    let overflowStartIdx = -1;

    // Temporarily prevent flex shrink for accurate measurement
    allTabs.forEach(b => b.style.flexShrink = '0');
    for (let i = 0; i < allTabs.length; i++) {
        usedWidth += allTabs[i].offsetWidth;
        if (usedWidth > availableWidth - btnWidth) {
            overflowStartIdx = i;
            break;
        }
    }
    allTabs.forEach(b => b.style.flexShrink = '');

    if (overflowStartIdx === -1) {
        // All tabs fit — keep overflow button for static items (New Project, Board Maker)
        overflowBtn.style.display = '';
        return;
    }

    overflowBtn.style.display = '';

    // Ensure active tab stays visible — swap with last visible if needed
    const activeIdx = allTabs.findIndex(b => b.classList.contains('active'));
    if (activeIdx >= overflowStartIdx) {
        // Swap active tab to the last visible position
        const lastVisibleIdx = overflowStartIdx - 1;
        if (lastVisibleIdx >= 0) {
            const activeTab = allTabs[activeIdx];
            const lastVisible = allTabs[lastVisibleIdx];
            // DOM swap
            tabRow.insertBefore(activeTab, lastVisible);
            // Update array to match
            allTabs.splice(activeIdx, 1);
            allTabs.splice(lastVisibleIdx, 0, activeTab);
        }
    }

    // Re-measure after potential swap to get accurate cutoff
    usedWidth = 0;
    overflowStartIdx = -1;
    allTabs.forEach(b => b.style.flexShrink = '0');
    for (let i = 0; i < allTabs.length; i++) {
        usedWidth += allTabs[i].offsetWidth;
        if (usedWidth > availableWidth - btnWidth) {
            overflowStartIdx = i;
            break;
        }
    }
    allTabs.forEach(b => b.style.flexShrink = '');

    if (overflowStartIdx === -1) return;

    // Mark overflowed tabs and clone into tray
    for (let i = overflowStartIdx; i < allTabs.length; i++) {
        allTabs[i].classList.add('tab-overflowed');
        const clone = document.createElement('button');
        clone.className = 'tab-btn overflow-tab';
        clone.textContent = allTabs[i].textContent;
        const tabId = allTabs[i].dataset.tab;
        clone.addEventListener('click', () => switchTab(tabId));
        if (allTabs[i].classList.contains('active')) clone.classList.add('active');
        overflowDynamic.appendChild(clone);
    }
}

let _overflowTimer = null;

function toggleOverflow(e) {
    if (e) e.stopPropagation();
    const tray = document.getElementById('overflowTray');
    tray.classList.toggle('open');
    if (tray.classList.contains('open')) {
        clearTimeout(_overflowTimer);
    }
}

function closeOverflow() {
    clearTimeout(_overflowTimer);
    document.getElementById('overflowTray').classList.remove('open');
}

function _startOverflowTimer() {
    clearTimeout(_overflowTimer);
    _overflowTimer = setTimeout(closeOverflow, 3000);
}

document.getElementById('overflowTray').addEventListener('mouseenter', () => clearTimeout(_overflowTimer));
document.getElementById('overflowTray').addEventListener('mouseleave', _startOverflowTimer);
document.querySelector('.tab-overflow-btn').addEventListener('mouseenter', () => clearTimeout(_overflowTimer));
document.querySelector('.tab-overflow-btn').addEventListener('mouseleave', () => {
    if (document.getElementById('overflowTray').classList.contains('open')) {
        _startOverflowTimer();
    }
});

// Observe panel resizes and recalculate tab overflow
new ResizeObserver(() => recalcTabs()).observe(document.getElementById('tabBar'));
recalcTabs();

// ══════════════════════════════════════════════════════════════
// Board Controls
// ══════════════════════════════════════════════════════════════
let STATE = null;
let _isConfigOpen = false;
let _isHiddenOpen = false;
let _firstRender = true;
let _uris = null;
let _probeMap = {};
let _currentProbes = [];

const SECTION_LABELS = { files: 'Files', actions: 'Actions', rtt: 'RTT', config: 'Config' };
const DEFAULT_ORDER = ['files', 'actions', 'rtt', 'config'];

let _editMode = false;
let _layout = { order: [...DEFAULT_ORDER], hidden: [] };
let _tomlLayout = null;
let _dragSectionId = null;

function applyLayout() {
    const container = document.getElementById('sectionsContainer');
    _layout.order.forEach(id => {
        const el = container.querySelector(`.panel-section[data-section="${id}"]`);
        if (el) { container.appendChild(el); }
    });
    if (!_editMode) {
        container.querySelectorAll('.panel-section').forEach(el => {
            const id = el.dataset.section;
            el.style.display = _layout.hidden.includes(id) ? 'none' : '';
        });
    }
}

function toggleEditMode() {
    _editMode = !_editMode;
    document.body.classList.toggle('edit-mode', _editMode);
    const btn = document.getElementById('editToggleBtn');
    btn.style.opacity = _editMode ? '1' : '0.5';
    btn.title = _editMode ? 'Done editing layout' : 'Edit panel layout';
    document.getElementById('resetLayoutBtn').style.display = _editMode ? 'block' : 'none';
    if (_editMode) {
        enterEditMode();
    } else {
        exitEditMode();
    }
}

function resetLayout() {
    _layout = _tomlLayout
        ? { order: [..._tomlLayout.order], hidden: [..._tomlLayout.hidden] }
        : { order: [...DEFAULT_ORDER], hidden: [] };
    applyLayout();
    const container = document.getElementById('sectionsContainer');
    container.querySelectorAll('.edit-bar').forEach(b => b.remove());
    container.querySelectorAll('.panel-section').forEach(el => {
        el.draggable = false;
        el.classList.remove('edit-section-hidden', 'drag-over-section', 'section-dragging');
        el.removeEventListener('dragstart', onSectionDragStart);
        el.removeEventListener('dragend', onSectionDragEnd);
        el.removeEventListener('dragover', onSectionDragOver);
        el.removeEventListener('drop', onSectionDrop);
    });
    enterEditMode();
}

function enterEditMode() {
    const container = document.getElementById('sectionsContainer');
    container.querySelectorAll('.panel-section').forEach(el => {
        const id = el.dataset.section;
        el.style.display = '';
        el.draggable = true;
        const isHidden = _layout.hidden.includes(id);
        el.classList.toggle('edit-section-hidden', isHidden);
        const bar = document.createElement('div');
        bar.className = 'edit-bar';
        const eyeBtn = document.createElement('button');
        eyeBtn.className = 'edit-eye-btn';
        eyeBtn.textContent = isHidden ? '\u25CB' : '\u25CF';
        eyeBtn.title = isHidden ? 'Show section' : 'Hide section';
        eyeBtn.addEventListener('click', e => {
            e.stopPropagation();
            toggleSectionVisibility(id, eyeBtn);
        });
        const handle = document.createElement('span');
        handle.className = 'edit-handle';
        handle.textContent = '\u2630';
        const nameEl = document.createElement('span');
        nameEl.className = 'edit-section-name';
        nameEl.textContent = SECTION_LABELS[id] || id;
        bar.appendChild(handle);
        bar.appendChild(nameEl);
        bar.appendChild(eyeBtn);
        el.insertBefore(bar, el.firstChild);
        el.addEventListener('dragstart', onSectionDragStart);
        el.addEventListener('dragend', onSectionDragEnd);
        el.addEventListener('dragover', onSectionDragOver);
        el.addEventListener('drop', onSectionDrop);
    });
}

function exitEditMode() {
    const container = document.getElementById('sectionsContainer');
    _layout.order = [...container.querySelectorAll('.panel-section')].map(el => el.dataset.section);
    container.querySelectorAll('.panel-section').forEach(el => {
        el.draggable = false;
        el.classList.remove('edit-section-hidden', 'drag-over-section', 'section-dragging');
        const bar = el.querySelector('.edit-bar');
        if (bar) { bar.remove(); }
        el.removeEventListener('dragstart', onSectionDragStart);
        el.removeEventListener('dragend', onSectionDragEnd);
        el.removeEventListener('dragover', onSectionDragOver);
        el.removeEventListener('drop', onSectionDrop);
        const id = el.dataset.section;
        el.style.display = _layout.hidden.includes(id) ? 'none' : '';
    });
    send('saveLayout', _layout);
}

function toggleSectionVisibility(id, eyeBtn) {
    const idx = _layout.hidden.indexOf(id);
    const el = document.querySelector(`.panel-section[data-section="${id}"]`);
    if (idx >= 0) {
        _layout.hidden.splice(idx, 1);
        el.classList.remove('edit-section-hidden');
        eyeBtn.textContent = '\u25CF';
        eyeBtn.title = 'Hide section';
    } else {
        _layout.hidden.push(id);
        el.classList.add('edit-section-hidden');
        eyeBtn.textContent = '\u25CB';
        eyeBtn.title = 'Show section';
    }
}

function onSectionDragStart(e) {
    _dragSectionId = e.currentTarget.dataset.section;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => e.currentTarget && e.currentTarget.classList.add('section-dragging'), 0);
}
function onSectionDragEnd(e) {
    e.currentTarget.classList.remove('section-dragging');
    document.querySelectorAll('.panel-section').forEach(el => el.classList.remove('drag-over-section'));
}
function onSectionDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.panel-section').forEach(el => el.classList.remove('drag-over-section'));
    const target = e.currentTarget;
    if (target.dataset.section !== _dragSectionId) {
        target.classList.add('drag-over-section');
    }
}
function onSectionDrop(e) {
    e.preventDefault();
    const target = e.currentTarget;
    const srcId = _dragSectionId;
    const tgtId = target.dataset.section;
    if (!srcId || srcId === tgtId) { return; }
    const container = target.parentElement;
    const srcEl = container.querySelector(`.panel-section[data-section="${srcId}"]`);
    container.insertBefore(srcEl, target);
    document.querySelectorAll('.panel-section').forEach(el => el.classList.remove('drag-over-section'));
    _dragSectionId = null;
}

// ── Panel Background Palette ──
const PALETTE_DARK = [
    { color: '#1e1e3a', title: 'Midnight Blue' },
    { color: '#1a3a1a', title: 'Forest Green' },
    { color: '#3a1a1a', title: 'Dark Red' },
    { color: '#3a2e1a', title: 'Warm Amber' },
    { color: '#2a1a3a', title: 'Dark Purple' },
    { color: '#1a3a3a', title: 'Dark Teal' },
    { color: '#2a2a2a', title: 'Charcoal' },
];
const PALETTE_LIGHT = [
    { color: '#dde4f7', title: 'Soft Blue' },
    { color: '#d5ecd5', title: 'Soft Green' },
    { color: '#f5d5d5', title: 'Soft Red' },
    { color: '#f5ead5', title: 'Soft Amber' },
    { color: '#ead5f5', title: 'Soft Lavender' },
    { color: '#d5f0ee', title: 'Soft Teal' },
    { color: '#e8e8e8', title: 'Light Gray' },
];

let _paletteOpen = false;
let _paletteDark = null; // null = auto-detect

function _vscodeIsDark() {
    const kind = document.body.getAttribute('data-vscode-theme-kind');
    // default to light if unset
    return kind === 'vscode-dark' || kind === 'vscode-high-contrast';
}

function _updatePaletteSwatches() {
    const isDark = _paletteDark !== null ? _paletteDark : _vscodeIsDark();
    const palette = isDark ? PALETTE_DARK : PALETTE_LIGHT;
    document.querySelectorAll('.palette-swatch').forEach((el, i) => {
        if (!palette[i]) { return; }
        el.style.background = palette[i].color;
        el.title = palette[i].title;
        el.onclick = () => applyPanelBg(palette[i].color);
    });
    const modeBtn = document.getElementById('paletteModeBtn');
    if (modeBtn) { modeBtn.textContent = isDark ? '\u263D' : '\u2600'; }
}

function togglePalette() {
    _paletteOpen = !_paletteOpen;
    const row = document.getElementById('paletteRow');
    const btn = document.getElementById('paletteToggleBtn');
    if (row) { row.style.display = _paletteOpen ? 'flex' : 'none'; }
    if (btn) { btn.style.opacity = _paletteOpen ? '1' : '0.5'; }
    if (_paletteOpen) { _updatePaletteSwatches(); }
}

function togglePaletteMode() {
    const cur = _paletteDark !== null ? _paletteDark : _vscodeIsDark();
    _paletteDark = !cur;
    _updatePaletteSwatches();
}

function applyPanelBg(color) {
    document.body.style.background = color;
    const swatch = document.getElementById('paletteBtnSwatch');
    if (swatch) {
        swatch.style.background = color;
        swatch.classList.add('palette-swatch-active');
    }
    document.querySelectorAll('.palette-swatch').forEach(el => {
        el.classList.toggle('palette-swatch-selected', el.style.background === color || el.style.backgroundColor === color);
    });
    const picker = document.getElementById('paletteColorPicker');
    if (picker && picker.value !== color) { try { picker.value = color; } catch (_) {} }
    send('setPanelBg', color);
}

function resetPanelBg() {
    document.body.style.background = '';
    const swatch = document.getElementById('paletteBtnSwatch');
    if (swatch) {
        swatch.style.background = '';
        swatch.classList.remove('palette-swatch-active');
    }
    document.querySelectorAll('.palette-swatch').forEach(el => el.classList.remove('palette-swatch-selected'));
    send('setPanelBg', null);
}

function safeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function basename(p) {
    return p.split(/[\\/]/).pop() || p;
}

// Returns a map of path → unique short label, deterministic via alphabetical sort of full paths.
// Duplicates get " (2)", " (3)", etc. in alphabetical order of full path.
function makeShortLabels(paths) {
    const sorted = [...paths].sort((a, b) => a.localeCompare(b));
    const nameCount = {};
    for (const p of sorted) {
        const n = basename(p);
        nameCount[n] = (nameCount[n] || 0) + 1;
    }
    const nameIdx = {};
    const result = {};
    for (const p of sorted) {
        const n = basename(p);
        if (nameCount[n] > 1) {
            nameIdx[n] = (nameIdx[n] || 0) + 1;
            result[p] = nameIdx[n] === 1 ? n : `${n} (${nameIdx[n]})`;
        } else {
            result[p] = n;
        }
    }
    return result;
}

function startSpin(btn, cmd, data) {
    if (btn.classList.contains('loading') || btn.classList.contains('done')) { return; }
    btn.classList.add('loading');
    btn.disabled = true;
    send(cmd, data);
    setTimeout(() => {
        btn.classList.remove('loading');
        btn.classList.add('done');
        setTimeout(() => { btn.classList.remove('done'); btn.disabled = false; }, 1000);
    }, 2000);
}

function findFlashBtn() {
    return document.querySelector('[data-action="flash"]');
}

function startFlash(btn) {
    if (btn.classList.contains('loading') || btn.classList.contains('flash-running') || btn.classList.contains('done')) { return; }
    btn.classList.add('loading', 'flash-running');
    btn.disabled = true;
    const bar = btn.querySelector('.btn-progress');
    const phaseLabel = btn.querySelector('.btn-phase-label');
    if (bar) { bar.style.width = '0%'; }
    if (phaseLabel) { phaseLabel.textContent = ''; }
    send('flash');
}

function onFlashProgress(event) {
    const btn = findFlashBtn();
    if (!btn) { return; }
    const bar = btn.querySelector('.btn-progress');
    const phaseLabel = btn.querySelector('.btn-phase-label');
    if (event.type === 'progress') {
        const label = event.phase === 'erasing' ? 'Erasing\u2026' : 'Programming\u2026';
        if (phaseLabel) { phaseLabel.textContent = label; }
        if (bar) { bar.style.width = event.pct + '%'; }
    } else if (event.type === 'done') {
        btn.classList.remove('loading', 'flash-running');
        if (bar) { bar.style.width = '0%'; }
        if (phaseLabel) { phaseLabel.textContent = ''; }
        if (event.success) {
            btn.classList.add('done');
            setTimeout(() => { btn.classList.remove('done'); btn.disabled = false; }, 1500);
        } else {
            btn.disabled = false;
        }
    }
}

function sendAction(btn, cmd) {
    if (cmd === 'flash') { startFlash(btn); return; }
    startSpin(btn, cmd);
}

function toggleDrop(e, id) {
    e.stopPropagation();
    const menu = document.getElementById(id);
    const btn = e.currentTarget;
    const wasOpen = menu.classList.contains('open');
    closeDrops();
    if (!wasOpen) {
        menu.classList.add('open');
        btn.classList.add('open');
    }
}
function closeDrops() {
    document.querySelectorAll('.drop-menu.open').forEach(m => m.classList.remove('open'));
    document.querySelectorAll('.cs-btn.open').forEach(b => b.classList.remove('open'));
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.tab-overflow-btn') && !e.target.closest('.overflow-menu')) {
        closeDrops();
    }
});

function onItemClick(_e, file) {
    send('selectFile', file);
}

function toggleConfig() {
    _isConfigOpen = !_isConfigOpen;
    const section = document.getElementById('configSection');
    const arrow = document.getElementById('configArrow');
    section.style.display = _isConfigOpen ? 'block' : 'none';
    arrow.classList.toggle('open', _isConfigOpen);
}

function toggleHidden() {
    _isHiddenOpen = !_isHiddenOpen;
    const section = document.getElementById('hiddenSection');
    const btn = document.getElementById('hiddenToggle');
    section.style.display = _isHiddenOpen ? 'block' : 'none';
    const hasHidden = STATE ? STATE.hiddenFiles.length > 0 : false;
    btn.style.opacity = _isHiddenOpen ? '0.5' : '1';
    const hiddenIcon = document.getElementById('hiddenIcon');
    if (hiddenIcon && _uris && !hasHidden) {
        hiddenIcon.src = _isHiddenOpen ? _uris.eyeSlash : _uris.eye;
    }
}

function toggleCheck() { send('toggleCheck'); }

let _checkRunning = false;
function runCheck() {
    if (_checkRunning) { return; }
    _checkRunning = true;
    const btn = document.getElementById('checkRunBtn');
    if (btn) { btn.classList.add('loading'); btn.disabled = true; }
    send('runCheck');
}

function refreshPorts() {
    spinRefresh('refreshPortIcon');
    send('listPorts');
}

function pickPort(val, label) {
    window.CURRENT_PORT = val;
    document.querySelectorAll('#menu-port .drop-item').forEach(el => {
        el.classList.toggle('drop-active', el.dataset.val === val);
    });
    const valEl = document.getElementById('cs-val-port');
    if (valEl) { valEl.textContent = label || 'auto'; }
    closeDrops();
    send('setPort', val);
}

function setUris(uris) {
    _uris = uris;
    const img = id => document.getElementById(id);
    img('refreshIcon').src = uris.refresh;
    img('hiddenIcon').src = uris.eye;
    img('rttRunIcon').src = uris.run;
    img('rttCheckIcon').src = uris.check;
    document.querySelector('#rttBtn .btn-spin-icon').src = uris.refresh;
    img('dropTarget').src = uris.drop;
    img('dropBoard').src = uris.drop;
    img('dropPort').src = uris.drop;
    img('refreshPortIcon').src = uris.refresh;
    img('configArrow').src = uris.drop;
    const editRefresh = img('editRefreshIcon');
    if (editRefresh) { editRefresh.src = uris.refresh; }
    const checkRun = document.getElementById('checkRunIcon');
    if (checkRun) { checkRun.src = uris.run; }
    const checkSpin = document.getElementById('checkSpinIcon');
    if (checkSpin) { checkSpin.src = uris.refresh; }
    const checkDoneIcon = document.getElementById('checkDoneIcon');
    if (checkDoneIcon) { checkDoneIcon.src = uris.check; }
    const toolIcon = document.getElementById('toolInstallIcon');
    if (toolIcon && uris.down) { toolIcon.src = uris.down; }
}

// ══════════════════════════════════════════════════════════════
// Tool Install Button
// ══════════════════════════════════════════════════════════════
let _toolState = 'idle'; // idle | confirm | installing | success | failed
let _toolConfirmTimer = null;
let _toolConfig = null;

function updateToolInstallArea(tool) {
    _toolConfig = tool;
    const area = document.getElementById('toolInstallArea');
    if (!tool) { area.style.display = 'none'; return; }
    // show area but check tool availability first
    area.style.display = '';
    send('checkTool');
}

function showToolInstall(show, toolName) {
    const area = document.getElementById('toolInstallArea');
    if (!show || !_toolConfig) { area.style.display = 'none'; return; }
    area.style.display = '';
    const title = document.getElementById('toolInstallTitle');
    title.textContent = 'Install ' + (_toolConfig.name || toolName || 'tool');
    setToolState('idle');
}

function setToolState(state) {
    _toolState = state;
    const btn = document.getElementById('toolInstallBtn');
    const title = document.getElementById('toolInstallTitle');
    if (_toolConfirmTimer) { clearTimeout(_toolConfirmTimer); _toolConfirmTimer = null; }

    btn.className = '';
    btn.classList.add('tool-install-btn');

    switch (state) {
        case 'idle':
            btn.classList.add('tool-idle');
            title.classList.remove('tool-title-above');
            btn.innerHTML = '<img id="toolInstallIcon" class="icon-svg" src="' + (_uris?.down || '') + '">';
            break;
        case 'confirm':
            btn.classList.add('tool-confirm');
            title.classList.add('tool-title-above');
            btn.textContent = 'Confirm';
            _toolConfirmTimer = setTimeout(() => setToolState('idle'), 3000);
            break;
        case 'installing':
            btn.classList.add('tool-installing');
            title.classList.add('tool-title-above');
            btn.textContent = 'Installing…';
            break;
        case 'success':
            btn.classList.add('tool-success');
            title.classList.add('tool-title-above');
            btn.innerHTML = '<img class="icon-svg tool-check-icon" src="' + (_uris?.check || '') + '">';
            break;
        case 'failed':
            btn.classList.add('tool-failed');
            title.classList.add('tool-title-above');
            btn.textContent = '✕';
            break;
    }
}

function toolInstallClick() {
    switch (_toolState) {
        case 'idle':
            setToolState('confirm');
            break;
        case 'confirm':
            setToolState('installing');
            send('installTool');
            break;
        case 'failed':
            setToolState('confirm');
            break;
    }
}

function cloneTpl(id) {
    return document.getElementById(id).content.cloneNode(true).firstElementChild;
}

function makeFileItem(f, i, label) {
    const el = cloneTpl('tpl-file-item');
    el.dataset.file = f;
    el.dataset.index = String(i);
    el.title = f;
    el.addEventListener('dragstart', e => onDragStart(e, +e.currentTarget.dataset.index));
    el.addEventListener('dragend', onDragEnd);
    el.addEventListener('dragover', e => onDragOver(e, +e.currentTarget.dataset.index));
    el.addEventListener('drop', e => onDrop(e, +e.currentTarget.dataset.index));
    el.addEventListener('click', e => onItemClick(e, f));
    el.querySelector('.file-name').textContent = label;
    el.querySelector('.remove-btn').addEventListener('click', e => {
        e.stopPropagation();
        send('hideFile', f);
    });
    return el;
}

function makeHiddenItem(f, label) {
    const el = cloneTpl('tpl-hidden-item');
    el.title = f;
    el.querySelector('.file-name').textContent = label;
    el.querySelector('.remove-btn').addEventListener('click', e => {
        e.stopPropagation();
        send('unhideFile', f);
    });
    return el;
}

function makeDropItem(label, isActive, onClick) {
    const el = cloneTpl('tpl-drop-item');
    el.textContent = label;
    if (isActive) { el.classList.add('drop-active'); }
    el.addEventListener('click', onClick);
    return el;
}

function makeActionBtn(cmd, actionCfg, uris, cmdPreviews) {
    const { label, color } = actionCfg;
    const tipCmd = cmdPreviews[cmd];
    const el = cloneTpl('tpl-action-simple');
    el.style.background = color;
    el.dataset.tipLabel = label;
    el.dataset.tipCmd = tipCmd;
    el.dataset.action = cmd;
    el.addEventListener('click', () => sendAction(el, cmd));
    el.querySelector('.btn-label').textContent = label;
    el.querySelector('.btn-run-icon').src = uris.run;
    el.querySelector('.btn-check-icon').src = uris.check;
    el.querySelector('.btn-spin-icon').src = uris.refresh;
    return el;
}

function render(state) {
    STATE = state;
    const { files, hiddenFiles, binTargets, pickedFile, boards, activeBoardFile, activeName,
        effectivePort, portIsFromConfig, portOverride, cmdPreviews, uris, layout, actions, tool, panelBg } = state;
    const _binTargets = binTargets || [];

    _tomlLayout = layout;
    const isFirst = _firstRender;
    if (isFirst) {
        _firstRender = false;
        window.CURRENT_PORT = portOverride;
        setUris(uris);
        if (layout) {
            if (layout.order && layout.order.length) { _layout.order = layout.order; }
            if (layout.hidden) { _layout.hidden = layout.hidden; }
        }
        applyLayout();
        if (panelBg) { applyPanelBg(panelBg); }
    }

    // Compute labels across all files (visible + hidden) for consistent deterministic naming
    const allFileLabels = makeShortLabels([...files, ...hiddenFiles]);

    const fileList = document.getElementById('fileList');
    fileList.innerHTML = '';
    if (files.length) {
        files.forEach((f, i) => fileList.appendChild(makeFileItem(f, i, allFileLabels[f])));
    } else {
        fileList.innerHTML = '<div class="file-empty">No files found</div>';
    }

    const hiddenList = document.getElementById('hiddenList');
    hiddenList.innerHTML = '';
    if (hiddenFiles.length) {
        hiddenFiles.forEach(f => hiddenList.appendChild(makeHiddenItem(f, allFileLabels[f])));
    } else {
        hiddenList.innerHTML = '<div class="file-empty">No hidden files</div>';
    }

    const hiddenToggle = document.getElementById('hiddenToggle');
    hiddenToggle.style.opacity = _isHiddenOpen ? '0.5' : '1';
    const hiddenIconEl = document.getElementById('hiddenIcon');
    let hiddenBadge = hiddenToggle.querySelector('.hidden-badge');
    if (!hiddenBadge) {
        hiddenBadge = document.createElement('span');
        hiddenBadge.className = 'hidden-badge';
        hiddenToggle.appendChild(hiddenBadge);
    }
    if (hiddenFiles.length > 0) {
        hiddenIconEl.style.display = 'none';
        hiddenBadge.textContent = hiddenFiles.length;
    } else {
        hiddenIconEl.style.display = '';
        hiddenBadge.textContent = '';
    }

    const actionBtns = document.getElementById('actionBtns');
    actionBtns.innerHTML = '';
    ['build', 'flash'].forEach(cmd => {
        const cfg = actions?.[cmd] ?? { label: cmd[0].toUpperCase() + cmd.slice(1), color: '#4caf50' };
        actionBtns.appendChild(makeActionBtn(cmd, cfg, uris, cmdPreviews));
    });

    const checkArea = document.getElementById('checkBtnArea');
    if (checkArea) { checkArea.style.display = state.checkEnabled ? 'block' : 'none'; }
    const checkToggleBtn = document.getElementById('checkToggleBtn');
    if (checkToggleBtn) { checkToggleBtn.classList.toggle('check-toggle-active', !!state.checkEnabled); }

    const rttBtn = document.getElementById('rttBtn');
    rttBtn.dataset.tipCmd = cmdPreviews.rtt;
    if (actions?.rtt) {
        rttBtn.style.background = actions.rtt.color;
        rttBtn.querySelector('.btn-label').textContent = actions.rtt.label;
    }

    const targetLabels = makeShortLabels(_binTargets.map(t => t.path));
    const activeTarget = pickedFile || (_binTargets.find(t => basename(t.path) === 'main.rs') ?? _binTargets[0])?.path;
    document.getElementById('cs-val-target').textContent = activeTarget ? (targetLabels[activeTarget] ?? basename(activeTarget)) : 'No targets';
    const menuTarget = document.getElementById('menu-target');
    menuTarget.innerHTML = '';
    if (_binTargets.length) {
        _binTargets.forEach(t => menuTarget.appendChild(makeDropItem(targetLabels[t.path], t.path === activeTarget, () => send('setTarget', t.path))));
    } else {
        menuTarget.innerHTML = '<div class="drop-item" style="opacity:0.5;cursor:default">No targets</div>';
    }

    const portDisplayName = effectivePort ? (_probeMap[effectivePort]?.name || effectivePort) : 'auto';
    document.getElementById('configSummary').textContent = `${activeName} \u00b7 ${portDisplayName}`;

    document.getElementById('cs-val-board').textContent = activeBoardFile ? activeBoardFile.replace(/\.toml$/, '') : '-- choose a board --';
    const menuBoard = document.getElementById('menu-board');
    menuBoard.innerHTML = '';
    if (boards.length) {
        boards.forEach(f => menuBoard.appendChild(makeDropItem(f.replace(/\.toml$/, ''), f === activeBoardFile, () => send('selectBoard', f))));
    } else {
        menuBoard.innerHTML = '<div class="drop-item" style="opacity:0.5;cursor:default">No boards</div>';
    }

    document.getElementById('activeBoardLabel').textContent = `Active: ${activeName}`;

    document.getElementById('portLabelEl').innerHTML = 'Port' + (portIsFromConfig
        ? ` <span style="opacity:0.6;font-style:italic">(from config: ${safeHtml(effectivePort)})</span>`
        : '');

    if (isFirst) {
        refreshPorts();
    }

    // Tool install
    updateToolInstallArea(tool);

    // Re-filter examples if loaded and board changed
    if (_examplesLoaded && allExamples.length) {
        exFilterExamples(document.getElementById('exSearch').value);
    }
}

// File drag & drop
let dragSrcIndex = null;

function onDragStart(e, index) {
    dragSrcIndex = index;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => e.currentTarget && e.currentTarget.classList.add('dragging'), 0);
}
function onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.file-item').forEach(el => el.classList.remove('drag-over'));
}
function onDragOver(e, index) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('#fileList .file-item').forEach(el => el.classList.remove('drag-over'));
    if (dragSrcIndex !== null && dragSrcIndex !== index) {
        e.currentTarget.classList.add('drag-over');
    }
    return false;
}
function onDrop(e, dropIndex) {
    e.preventDefault();
    if (dragSrcIndex === null || dragSrcIndex === dropIndex) { return; }
    const items = [...document.querySelectorAll('#fileList .file-item[data-file]')];
    const files = items.map(el => el.dataset.file);
    const [moved] = files.splice(dragSrcIndex, 1);
    files.splice(dropIndex, 0, moved);
    send('reorderFiles', files);
    const list = document.getElementById('fileList');
    const srcEl = items[dragSrcIndex];
    const dropEl = items[dropIndex];
    if (dragSrcIndex < dropIndex) {
        list.insertBefore(srcEl, dropEl.nextSibling);
    } else {
        list.insertBefore(srcEl, dropEl);
    }
    [...list.querySelectorAll('.file-item[data-index]')].forEach((el, i) => {
        el.dataset.index = String(i);
    });
    dragSrcIndex = null;
    document.querySelectorAll('.file-item').forEach(el => el.classList.remove('drag-over'));
}

// Probe naming
function renderProbeNaming(probes, probeMap) {
    _currentProbes = probes || [];
    _probeMap = probeMap || {};
    const area = document.getElementById('probeNamingArea');
    const list = document.getElementById('probeNamingList');
    if (!area || !list) { return; }
    if (_currentProbes.length === 0) { area.style.display = 'none'; return; }
    area.style.display = 'block';
    const draftValues = {};
    let focusedProbeId = null;
    list.querySelectorAll('.probe-name-input').forEach(el => {
        if (el.title) {
            draftValues[el.title] = el.value;
            if (el === document.activeElement) { focusedProbeId = el.title; }
        }
    });
    list.innerHTML = '';
    _currentProbes.forEach(probe => {
        const row = makeProbeNamingRow(probe, _probeMap[probe.id] || {});
        if (probe.id in draftValues) {
            const input = row.querySelector('.probe-name-input');
            if (input) { input.value = draftValues[probe.id]; }
        }
        list.appendChild(row);
    });
    if (focusedProbeId) {
        const toFocus = list.querySelector(`.probe-name-input[title="${CSS.escape(focusedProbeId)}"]`);
        if (toFocus) { toFocus.focus(); }
    }
}

function makeProbeNamingRow(probe, mapping) {
    const row = document.createElement('div');
    row.className = 'probe-naming-row';
    const nameInput = document.createElement('input');
    nameInput.className = 'probe-name-input';
    nameInput.type = 'text';
    nameInput.placeholder = probe.label || probe.id;
    nameInput.value = mapping.name || '';
    nameInput.title = probe.id;
    const right = document.createElement('div');
    right.className = 'probe-naming-right';
    if (mapping.board) {
        const boardLabel = document.createElement('span');
        boardLabel.className = 'probe-board-badge';
        boardLabel.textContent = mapping.board.replace(/\.toml$/, '');
        boardLabel.title = mapping.board;
        const clearBtn = document.createElement('button');
        clearBtn.className = 'probe-clear-btn';
        clearBtn.title = 'Clear board association (keeps name)';
        clearBtn.textContent = '\u2715';
        clearBtn.addEventListener('click', () => {
            send('clearProbeBoard', { probeId: probe.id });
            const m = _probeMap[probe.id] || {};
            delete m.board;
            _probeMap[probe.id] = m;
            renderProbeNaming(_currentProbes, _probeMap);
        });
        right.appendChild(boardLabel);
        right.appendChild(clearBtn);
    } else {
        const bookmarkBtn = document.createElement('button');
        bookmarkBtn.className = 'probe-bookmark-btn';
        bookmarkBtn.title = 'Associate current board with this probe';
        bookmarkBtn.textContent = '\u2605';
        bookmarkBtn.addEventListener('click', () => {
            const name = nameInput.value.trim() || probe.label;
            const boardFile = STATE && STATE.activeBoardFile;
            send('nameProbe', { probeId: probe.id, name, boardFile });
            _probeMap[probe.id] = { name, board: boardFile };
            renderProbeNaming(_currentProbes, _probeMap);
        });
        right.appendChild(bookmarkBtn);
    }
    nameInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            const name = nameInput.value.trim() || probe.label;
            send('nameProbe', { probeId: probe.id, name, boardFile: mapping.board });
            if (!_probeMap[probe.id]) { _probeMap[probe.id] = {}; }
            _probeMap[probe.id].name = name;
        }
    });
    row.appendChild(nameInput);
    row.appendChild(right);
    return row;
}

// Tooltip
(function initTooltips() {
    const tip = document.createElement('div');
    tip.className = 'btn-tooltip';
    document.body.appendChild(tip);
    let timer = null;
    document.addEventListener('mouseover', e => {
        const btn = e.target.closest('button[data-tip-cmd]');
        if (!btn) { return; }
        const rect = btn.getBoundingClientRect();
        tip.textContent = btn.dataset.tipLabel || '';
        tip.style.left = rect.left + 'px';
        tip.style.top = (rect.bottom + 6) + 'px';
        Anim.tooltipIn(tip);
        timer = setTimeout(() => { tip.textContent = btn.dataset.tipCmd || ''; }, 2000);
    });
    document.addEventListener('mouseout', e => {
        if (!e.target.closest('button[data-tip-cmd]')) { return; }
        clearTimeout(timer);
        Anim.tooltipOut(tip);
    });
})();

// ══════════════════════════════════════════════════════════════
// Board Library
// ══════════════════════════════════════════════════════════════
let LIB_CHECK_URI = '';
let LIB_DOWN_URI = '';
let LIB_REFRESH_URI = '';
let libAllBoards = [];
let libBoardIndex = {};

function libCheckBtn(name) { return `<button class="lib-added" data-board="${esc(name)}" ondblclick="libRemoveBoard(this)" title="Double-click to remove from project"><img src="${LIB_CHECK_URI}"></button>`; }
function libDownBtn(name, url) { return `<button class="lib-down" data-board="${esc(name)}" data-url="${esc(url)}" onclick="libDownloadBoard(this)" title="Add to project"><img src="${LIB_DOWN_URI}"></button>`; }
function libUpdateBtn(name, url) { return `<button class="lib-update" data-board="${esc(name)}" data-url="${esc(url)}" onclick="libUpdateBoard(this)" title="Update to latest version"><img src="${LIB_REFRESH_URI}"></button>`; }
function libStateBtns(b) {
    if (b.inWorkspace) {
        return `<span class="lib-btns">${libCheckBtn(b.name)}${b.hasUpdate ? libUpdateBtn(b.name, b.downloadUrl) : ''}</span>`;
    }
    return `<span class="lib-btns">${libDownBtn(b.name, b.downloadUrl)}</span>`;
}
function libRemoveBoard(btn) { const name = btn.dataset.board; btn.disabled = true; send('removeBoard', name); }

function libFindBtnsContainer(name) {
    const btn = document.querySelector(`#tab-library [data-board="${CSS.escape(name)}"]`);
    return btn ? btn.closest('.lib-btns') : null;
}

function libRenderList(boards) {
    if (!boards.length) {
        document.getElementById('libContent').innerHTML = '<div class="lib-status">No matches.</div>';
        return;
    }
    const rows = boards.map(b => {
        return `<div class="lib-item"><span class="lib-name" title="${esc(b.path)}">${esc(b.path.replace(/\.toml$/, ''))}</span>${libStateBtns(b)}</div>`;
    }).join('');
    document.getElementById('libContent').innerHTML = `<div class="lib-list">${rows}</div>`;
}

function libFilterBoards(query) {
    if (!libAllBoards.length) return;
    const q = query.trim();
    if (!q) { libRenderList(libAllBoards); return; }
    const scored = libAllBoards
        .map(b => ({ b, score: fuzzyScore(q, b.path.replace(/\.toml$/, '')) }))
        .filter(x => x.score > 0.25)
        .sort((a, z) => z.score - a.score);
    libRenderList(scored.map(x => x.b));
}

function libLoad() {
    spinRefresh('libRefreshIcon');
    document.getElementById('libContent').innerHTML = '<div class="lib-status">Loading\u2026</div>';
    send('fetchLibrary');
}

function libForceDownloadAll(btn) {
    btn.disabled = true;
    send('forceDownloadAll');
}

function libDownloadBoard(btn) {
    const name = btn.dataset.board;
    const downloadUrl = btn.dataset.url;
    btn.disabled = true; btn.innerHTML = '\u2026';
    send('downloadBoard', { name, downloadUrl });
}

function libUpdateBoard(btn) {
    const name = btn.dataset.board;
    const downloadUrl = btn.dataset.url;
    btn.disabled = true;
    const img = btn.querySelector('img');
    if (img) {
        img.classList.remove('spin-once');
        void img.offsetWidth;
        img.classList.add('spin-once');
    }
    send('updateBoard', { name, downloadUrl });
}

// ══════════════════════════════════════════════════════════════
// Examples
// ══════════════════════════════════════════════════════════════
let allExamples = [];
let exShowAllBoards = false;

function exLoad() {
    spinRefresh('exRefreshIcon');
    document.getElementById('exContent').innerHTML = '<div class="lib-status">Loading\u2026</div>';
    send('fetchExamples');
}

function exGetFiltered() {
    let list = allExamples;
    if (!exShowAllBoards && STATE?.activeBoardFile) {
        const boardName = STATE.activeBoardFile.replace(/\.toml$/, '').toLowerCase();
        list = list.filter(ex => ex.board.toLowerCase() === boardName);
    }
    return list;
}

function exFilterExamples(query) {
    let list = exGetFiltered();
    const q = (query || '').trim();
    if (q) {
        list = list
            .map(ex => ({ ex, score: fuzzyScore(q, ex.name) }))
            .filter(x => x.score > 0.25)
            .sort((a, z) => z.score - a.score)
            .map(x => x.ex);
    }
    exRenderList(list);
}

function exRenderList(examples) {
    if (!examples.length) {
        const msg = allExamples.length === 0 ? 'No examples found.' : 'No matching examples.';
        document.getElementById('exContent').innerHTML = `<div class="lib-status">${msg}</div>`;
        return;
    }
    const rows = examples.map(ex =>
        `<div class="lib-item example-item" onclick="exOpen('${esc(ex.name)}')" title="${esc(ex.codePath)}">` +
        `<span class="lib-name">${esc(ex.name)}</span>` +
        `<span class="example-board">${esc(ex.board)}</span>` +
        `</div>`
    ).join('');
    document.getElementById('exContent').innerHTML = `<div class="lib-list">${rows}</div>`;
}

function exToggleShowAll() {
    exShowAllBoards = document.getElementById('exShowAll').checked;
    exFilterExamples(document.getElementById('exSearch').value);
}

function exOpen(name) {
    const ex = allExamples.find(e => e.name === name);
    if (ex) { send('openExample', { name: ex.name, codePath: ex.codePath, codeContent: ex.codeContent }); }
}

// ══════════════════════════════════════════════════════════════
// New Project
// ══════════════════════════════════════════════════════════════
let npAllBoards = [];
let npActiveBoardFile = null;

function npRenderBoards(boards) {
    const list = document.getElementById('np-board-list');
    if (!boards.length) {
        list.innerHTML = '<div class="lib-status">No boards found.</div>';
        return;
    }
    list.innerHTML = boards.map(f => {
        const active = f === npActiveBoardFile;
        return `<div class="lib-item np-board-item${active ? ' np-active' : ''}" onclick="npSelectBoard('${esc(f)}')" data-file="${esc(f)}">` +
            `<span class="lib-name">${esc(f.replace(/\.toml$/, ''))}</span>` +
            `</div>`;
    }).join('');
}

function npFilterBoards(query) {
    if (!npAllBoards.length) return;
    const q = query.trim();
    if (!q) { npRenderBoards(npAllBoards); return; }
    const scored = npAllBoards
        .map(f => ({ f, score: fuzzyScore(q, f.replace(/\.toml$/, '')) }))
        .filter(x => x.score > 0.25)
        .sort((a, z) => z.score - a.score);
    npRenderBoards(scored.map(x => x.f));
}

function npSelectBoard(file) {
    npActiveBoardFile = file;
    npRenderBoards(npAllBoards);
    send('npSelectBoard', file);
}

function npBrowseLocation() { send('browseFolder'); }
function npSetupWorkspace() { send('setup'); }
function npApplyBoard() { send('applyBoard'); }

function npClearError(el) {
    el.classList.remove('np-error');
}

function npCreateProject() {
    const nameEl = document.getElementById('np-name');
    const locEl = document.getElementById('np-location');
    const name = nameEl.value.trim();
    const location = locEl.value.trim();
    nameEl.classList.remove('np-error');
    locEl.classList.remove('np-error');
    let valid = true;
    if (!name || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) { nameEl.classList.add('np-error'); valid = false; }
    if (!location) { locEl.classList.add('np-error'); valid = false; }
    if (!valid) { return; }
    send('createProject', { name, location });
}

function npRefreshBoards() {
    spinRefresh('npRefreshIcon');
    send('npRefreshBoards');
}

let npGenerateCommands = null;
let npSelectedGenCmd = null;

function npInitGenerate(commands) {
    npGenerateCommands = commands;
    npSelectedGenCmd = commands ? commands[0] : null;
    const wrap = document.getElementById('np-generate');
    if (!commands || commands.length === 0) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    const dropWrap = document.getElementById('np-gen-dropdown-wrap');
    const dropImg = document.getElementById('dropNpGen');
    if (dropImg && DROP_URI) { dropImg.src = DROP_URI; }
    if (commands.length > 1) {
        dropWrap.style.display = '';
        document.getElementById('cs-val-np-gen').textContent = commands[0].label;
        const menu = document.getElementById('menu-np-gen');
        menu.innerHTML = commands.map((c, i) =>
            `<div class="drop-item${i === 0 ? ' drop-active' : ''}" onclick="npPickGenCmd(${i})">${esc(c.label)}</div>`
        ).join('');
    } else {
        dropWrap.style.display = 'none';
    }
}

function npPickGenCmd(idx) {
    closeDrops();
    npSelectedGenCmd = npGenerateCommands[idx];
    document.getElementById('cs-val-np-gen').textContent = npSelectedGenCmd.label;
    document.querySelectorAll('#menu-np-gen .drop-item').forEach((el, i) => {
        el.classList.toggle('drop-active', i === idx);
    });
}

function npBrowseGenLocation() { send('browseGenFolder'); }

function npRunGenerate() {
    const nameEl = document.getElementById('np-gen-name');
    const locEl = document.getElementById('np-gen-location');
    const name = nameEl.value.trim();
    const location = locEl.value.trim();
    nameEl.classList.remove('np-error');
    locEl.classList.remove('np-error');
    let valid = true;
    if (!name || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) { nameEl.classList.add('np-error'); valid = false; }
    if (!location) { locEl.classList.add('np-error'); valid = false; }
    if (!valid) { return; }
    const cmd = npSelectedGenCmd || (npGenerateCommands && npGenerateCommands[0]);
    if (!cmd) { return; }
    send('generateProject', { name, location, command: cmd.command });
}

// ══════════════════════════════════════════════════════════════
// Board Maker
// ══════════════════════════════════════════════════════════════
const KNOWN_TARGETS = [
    "thumbv6m-none-eabi",
    "thumbv7m-none-eabi",
    "thumbv7em-none-eabi",
    "thumbv7em-none-eabihf",
    "thumbv8m.base-none-eabi",
    "thumbv8m.main-none-eabi",
    "thumbv8m.main-none-eabihf",
    "riscv32imc-unknown-none-elf",
    "riscv32imac-unknown-none-elf",
    "riscv64gc-unknown-none-elf",
];

const KNOWN_PROTOCOLS = ["Swd", "jtag"];

const BM_DEFAULTS = {
    "probe.speed": "4000",
};

const OPTIONAL_SECTIONS = {
    probe: {
        label: "[probe]",
        fields: [
            { name: "protocol", type: "combo", placeholder: "Swd", options: KNOWN_PROTOCOLS },
            { name: "speed", type: "number", placeholder: "4000", dataDefault: "4000" },
            { name: "port", type: "text", placeholder: "/dev/ttyUSB0 (optional)" },
        ],
    },
    flash: {
        label: "[flash]",
        fields: [
            { name: "restore_unwritten", type: "checkbox" },
            { name: "halt_afterwards", type: "checkbox" },
        ],
    },
    rtt: {
        label: "[rtt]",
        fields: [
            { name: "enabled", type: "checkbox" },
        ],
        hasChannels: true,
    },
    run: {
        label: "[run]",
        fields: [
            { name: "command", type: "text", placeholder: "espflash flash --monitor ..." },
        ],
    },
};

let bmChannelCount = 0;
let bmConfirmDefaults = false;
const bmActiveSections = new Set();

function bmCreateComboField(field, section) {
    const wrap = document.createElement('div');
    wrap.className = 'bm-combo-wrap';
    const input = document.createElement('input');
    input.className = 'bm-input bm-combo-input';
    input.type = 'text';
    input.placeholder = field.placeholder || '';
    input.dataset.section = section;
    input.dataset.field = field.name;
    input.autocomplete = 'off';
    const toggle = document.createElement('img');
    toggle.className = 'bm-combo-toggle';
    toggle.src = DROP_URI;
    toggle.alt = 'v';
    const list = document.createElement('div');
    list.className = 'bm-combo-list';

    function showSuggestions(forceAll) {
        const val = input.value.toLowerCase();
        const matches = forceAll
            ? field.options
            : field.options.filter(o => o.toLowerCase().includes(val));
        if (matches.length === 0 || (!forceAll && matches.length === 1 && matches[0] === input.value)) {
            list.style.display = 'none';
            return;
        }
        list.innerHTML = matches.map(o =>
            `<div class="bm-combo-item">${esc(o)}</div>`
        ).join('');
        list.querySelectorAll('.bm-combo-item').forEach(item => {
            item.addEventListener('mousedown', () => {
                input.value = item.textContent;
                list.style.display = 'none';
            });
        });
        list.style.display = '';
    }

    input.addEventListener('input', () => showSuggestions(false));
    input.addEventListener('focus', () => showSuggestions(false));
    input.addEventListener('blur', () => {
        setTimeout(() => { list.style.display = 'none'; }, 150);
    });
    toggle.addEventListener('click', () => {
        if (list.style.display === 'none' || !list.style.display) {
            showSuggestions(true);
            input.focus();
        } else {
            list.style.display = 'none';
        }
    });
    wrap.appendChild(input);
    wrap.appendChild(toggle);
    wrap.appendChild(list);
    return wrap;
}

function bmBuildSectionDom(key, def) {
    const section = document.createElement('div');
    section.className = 'bm-section';
    section.dataset.sectionKey = key;
    const header = document.createElement('div');
    header.className = 'bm-section-header bm-section-removable';
    header.innerHTML = `${esc(def.label)} <button class="bm-remove-section" title="Remove section">&times;</button>`;
    header.querySelector('.bm-remove-section').addEventListener('click', () => {
        section.remove();
        bmActiveSections.delete(key);
        bmUpdateAddMenu();
    });
    section.appendChild(header);
    const body = document.createElement('div');
    body.className = 'bm-section-body';
    body.style.display = 'block';
    for (const field of def.fields) {
        const row = document.createElement('div');
        row.className = 'bm-field-row';
        const label = document.createElement('span');
        label.className = 'bm-field-label';
        label.textContent = field.name;
        row.appendChild(label);
        if (field.type === 'combo') {
            row.appendChild(bmCreateComboField(field, key));
        } else if (field.type === 'checkbox') {
            const cb = document.createElement('input');
            cb.className = 'bm-check';
            cb.type = 'checkbox';
            cb.dataset.section = key;
            cb.dataset.field = field.name;
            row.appendChild(cb);
        } else if (field.type === 'number') {
            const inp = document.createElement('input');
            inp.className = 'bm-input';
            inp.type = 'number';
            inp.placeholder = field.placeholder || '';
            inp.dataset.section = key;
            inp.dataset.field = field.name;
            if (field.dataDefault) inp.dataset.default = field.dataDefault;
            row.appendChild(inp);
        } else {
            const inp = document.createElement('input');
            inp.className = 'bm-input';
            inp.type = 'text';
            inp.placeholder = field.placeholder || '';
            inp.dataset.section = key;
            inp.dataset.field = field.name;
            row.appendChild(inp);
        }
        body.appendChild(row);
    }
    if (def.hasChannels) {
        const chLabel = document.createElement('span');
        chLabel.className = 'bm-field-label';
        chLabel.textContent = 'channels';
        body.appendChild(chLabel);
        const chContainer = document.createElement('div');
        chContainer.className = 'bm-rtt-channels';
        body.appendChild(chContainer);
        const addBtn = document.createElement('button');
        addBtn.className = 'bm-add-btn';
        addBtn.textContent = '+ Add Channel';
        addBtn.addEventListener('click', () => bmAddChannel(chContainer));
        body.appendChild(addBtn);
    }
    section.appendChild(body);
    return section;
}

function bmAddSection(key) {
    if (bmActiveSections.has(key)) return;
    bmActiveSections.add(key);
    const def = OPTIONAL_SECTIONS[key];
    const dom = bmBuildSectionDom(key, def);
    document.getElementById('bm-optional-sections').appendChild(dom);
    bmUpdateAddMenu();
    bmHideAddMenu();
}

function bmToggleAddMenu() {
    const menu = document.getElementById('bm-add-menu');
    if (menu.style.display === 'none') {
        bmUpdateAddMenu();
        const available = Object.keys(OPTIONAL_SECTIONS).filter(k => !bmActiveSections.has(k));
        if (available.length === 0) return;
        menu.style.display = '';
    } else {
        menu.style.display = 'none';
    }
}

function bmHideAddMenu() {
    document.getElementById('bm-add-menu').style.display = 'none';
}

function bmUpdateAddMenu() {
    const menu = document.getElementById('bm-add-menu');
    const available = Object.keys(OPTIONAL_SECTIONS).filter(k => !bmActiveSections.has(k));
    if (available.length === 0) {
        document.getElementById('bm-add-section-btn').style.display = 'none';
        menu.style.display = 'none';
        return;
    }
    document.getElementById('bm-add-section-btn').style.display = '';
    menu.innerHTML = available.map(k =>
        `<div class="bm-add-menu-item" tabindex="0" data-key="${k}">${esc(OPTIONAL_SECTIONS[k].label)}</div>`
    ).join('');
    menu.querySelectorAll('.bm-add-menu-item').forEach(item => {
        item.addEventListener('click', () => bmAddSection(item.dataset.key));
    });
}

document.addEventListener('click', (e) => {
    const wrap = document.querySelector('.bm-add-section-wrap');
    if (wrap && !wrap.contains(e.target)) {
        bmHideAddMenu();
    }
});

// Board Maker target combo box
const bmTargetInput = document.querySelector('#tab-boardMaker [data-field="target"]');
const bmTargetList = document.getElementById('bm-target-list');
const bmTargetToggle = document.querySelector('#tab-boardMaker .bm-section .bm-combo-toggle');

function bmShowTargetSuggestions(forceAll) {
    const val = bmTargetInput.value.toLowerCase();
    const matches = forceAll
        ? KNOWN_TARGETS
        : KNOWN_TARGETS.filter(t => t.includes(val));
    if (matches.length === 0 || (!forceAll && matches.length === 1 && matches[0] === bmTargetInput.value)) {
        bmTargetList.style.display = 'none';
        return;
    }
    bmTargetList.innerHTML = matches.map(t =>
        `<div class="bm-combo-item" onmousedown="bmPickTarget('${t}')">${esc(t)}</div>`
    ).join('');
    bmTargetList.style.display = '';
}

if (bmTargetInput) {
    bmTargetInput.addEventListener('input', () => bmShowTargetSuggestions(false));
    bmTargetInput.addEventListener('focus', () => bmShowTargetSuggestions(false));
    bmTargetInput.addEventListener('blur', () => {
        setTimeout(() => { bmTargetList.style.display = 'none'; }, 150);
    });
}

if (bmTargetToggle) {
    bmTargetToggle.addEventListener('click', () => {
        if (bmTargetList.style.display === 'none' || !bmTargetList.style.display) {
            bmShowTargetSuggestions(true);
            bmTargetInput.focus();
        } else {
            bmTargetList.style.display = 'none';
        }
    });
}

function bmPickTarget(val) {
    bmTargetInput.value = val;
    bmTargetList.style.display = 'none';
}

// RTT Channels
function bmAddChannel(container) {
    if (!container) {
        container = document.querySelector('.bm-rtt-channels');
    }
    if (!container) return;
    const idx = bmChannelCount++;
    const row = document.createElement('div');
    row.className = 'bm-channel-row';
    row.dataset.idx = idx;
    row.innerHTML =
        `<input class="bm-input bm-channel-up" type="number" value="${idx}" placeholder="up" title="Channel index">` +
        `<input class="bm-input bm-channel-name" type="text" value="Terminal" placeholder="name" title="Channel name">` +
        `<button class="bm-remove-channel" onclick="bmRemoveChannel(this)" title="Remove channel">&times;</button>`;
    container.appendChild(row);
}

function bmRemoveChannel(btn) {
    btn.parentElement.remove();
}

// Board Maker keyboard navigation
const BM_FOCUSABLE = 'input, select, button, [tabindex]:not([tabindex="-1"])';

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Escape') return;
    const el = document.activeElement;
    if (!el || !el.closest('#tab-boardMaker') || !el.matches(BM_FOCUSABLE)) return;

    const menu = document.getElementById('bm-add-menu');
    const menuOpen = menu && menu.style.display !== 'none';

    if (e.key === 'Escape') {
        if (menuOpen) {
            e.preventDefault();
            bmHideAddMenu();
            document.getElementById('bm-add-section-btn').focus();
        }
        return;
    }

    if (e.key === 'Enter' && el.id === 'bm-add-section-btn') {
        e.preventDefault();
        bmToggleAddMenu();
        const firstItem = menu.querySelector('.bm-add-menu-item');
        if (firstItem) firstItem.focus();
        return;
    }

    if (e.key === 'Enter' && el.classList.contains('bm-add-menu-item')) {
        e.preventDefault();
        bmAddSection(el.dataset.key);
        document.getElementById('bm-add-section-btn').focus();
        return;
    }

    if (menuOpen && el.classList.contains('bm-add-menu-item') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const items = Array.from(menu.querySelectorAll('.bm-add-menu-item'));
        const idx = items.indexOf(el);
        const next = e.key === 'ArrowDown' ? items[idx + 1] : items[idx - 1];
        if (next) next.focus();
        return;
    }

    if (e.key === 'Enter') {
        e.preventDefault();
        const row = el.closest('.bm-field-row, .bm-channel-row');
        if (row) {
            const inputs = Array.from(row.querySelectorAll(BM_FOCUSABLE));
            const idx = inputs.indexOf(el);
            if (idx >= 0 && idx < inputs.length - 1) {
                inputs[idx + 1].focus();
                return;
            }
        }
        bmFocusNext(el, 1);
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        bmFocusNext(el, 1);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        bmFocusNext(el, -1);
    }
});

function bmFocusNext(current, direction) {
    const all = Array.from(document.querySelectorAll('#tab-boardMaker ' + BM_FOCUSABLE));
    const visible = all.filter(el => el.offsetParent !== null);
    const idx = visible.indexOf(current);
    if (idx < 0) return;
    const next = visible[idx + direction];
    if (next) next.focus();
}

function bmCollectData() {
    const data = {};
    document.querySelectorAll('#tab-boardMaker .bm-input[data-section], #tab-boardMaker .bm-select[data-section], #tab-boardMaker .bm-check[data-section]').forEach(el => {
        const section = el.dataset.section;
        const field = el.dataset.field;
        if (!section || !field) return;
        let val;
        if (el.type === 'checkbox') {
            val = el.checked;
        } else if (el.type === 'number') {
            val = el.value.trim() ? Number(el.value) : undefined;
        } else {
            val = el.value.trim() || undefined;
        }
        if (val === undefined && !el.checked) return;
        if (!data[section]) data[section] = {};
        data[section][field] = val;
    });
    const channelRows = document.querySelectorAll('#tab-boardMaker .bm-channel-row');
    if (channelRows.length > 0) {
        if (!data.rtt) data.rtt = {};
        data.rtt.channels = [];
        channelRows.forEach(row => {
            const up = parseInt(row.querySelector('.bm-channel-up').value, 10);
            const name = row.querySelector('.bm-channel-name').value.trim();
            if (!isNaN(up) && name) {
                data.rtt.channels.push({ up, name });
            }
        });
    }
    return data;
}

function bmGenerateToml(data) {
    let toml = '';
    if (data.board) {
        toml += '[board]\n';
        if (data.board.name) toml += `name   = ${bmQ(data.board.name)}\n`;
        if (data.board.chip) toml += `chip   = ${bmQ(data.board.chip)}\n`;
        if (data.board.target) toml += `target = ${bmQ(data.board.target)}\n`;
    }
    if (data.probe && Object.keys(data.probe).length) {
        toml += '\n[probe]\n';
        if (data.probe.protocol) toml += `protocol = ${bmQ(data.probe.protocol)}\n`;
        if (data.probe.speed != null) toml += `speed    = ${data.probe.speed}\n`;
        if (data.probe.port) toml += `port     = ${bmQ(data.probe.port)}\n`;
    }
    if (data.flash && Object.keys(data.flash).length) {
        toml += '\n[flash]\n';
        if (data.flash.restore_unwritten != null) toml += `restore_unwritten = ${data.flash.restore_unwritten}\n`;
        if (data.flash.halt_afterwards != null) toml += `halt_afterwards   = ${data.flash.halt_afterwards}\n`;
    }
    if (data.rtt) {
        toml += '\n[rtt]\n';
        toml += `enabled = ${data.rtt.enabled === true}\n`;
        if (data.rtt.channels && data.rtt.channels.length > 0) {
            toml += 'channels = [' +
                data.rtt.channels.map(c => `{ up = ${c.up}, name = ${bmQ(c.name)} }`).join(', ') +
                ']\n';
        }
    }
    if (data.run && data.run.command) {
        toml += '\n[run]\n';
        toml += `command = ${bmQ(data.run.command)}\n`;
    }
    return toml;
}

function bmQ(s) { return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; }

function bmValidate(data) {
    const errors = [];
    if (!data.board?.name) errors.push('board.name is required');
    if (!data.board?.chip) errors.push('board.chip is required');
    if (!data.board?.target) errors.push('board.target is required');
    const filename = document.getElementById('bm-filename').value.trim();
    if (!filename) errors.push('Filename is required');
    if (filename && !/^[a-zA-Z0-9_-]+$/.test(filename)) errors.push('Filename must be alphanumeric with dashes/underscores');
    return errors;
}

function bmHasDefaults(data) {
    const defaults = [];
    for (const [key, defaultVal] of Object.entries(BM_DEFAULTS)) {
        const [section, field] = key.split('.');
        if (data[section] && (data[section][field] === undefined || data[section][field] === '')) {
            defaults.push(`${key} (default: ${defaultVal})`);
        }
    }
    return defaults;
}

function bmSaveBoard() {
    const data = bmCollectData();
    const errors = bmValidate(data);
    const errorDiv = document.getElementById('bm-error');
    const warningDiv = document.getElementById('bm-defaults-warning');
    if (errors.length > 0) {
        errorDiv.textContent = errors.join('\n');
        errorDiv.style.display = '';
        warningDiv.style.display = 'none';
        bmConfirmDefaults = false;
        document.querySelectorAll('#tab-boardMaker .bm-input[data-section="board"]').forEach(el => {
            if (!el.value.trim()) el.classList.add('bm-field-error');
        });
        const filenameEl = document.getElementById('bm-filename');
        if (!filenameEl.value.trim()) filenameEl.classList.add('bm-field-error');
        return;
    }
    errorDiv.style.display = 'none';
    const defaultsUsed = bmHasDefaults(data);
    if (defaultsUsed.length > 0 && !bmConfirmDefaults) {
        warningDiv.textContent = `Using defaults: ${defaultsUsed.join(', ')}. Press Save again to confirm.`;
        warningDiv.style.display = '';
        bmConfirmDefaults = true;
        return;
    }
    for (const [key, defaultVal] of Object.entries(BM_DEFAULTS)) {
        const [section, field] = key.split('.');
        if (data[section] && (data[section][field] === undefined || data[section][field] === '')) {
            data[section][field] = isNaN(Number(defaultVal)) ? defaultVal : Number(defaultVal);
        }
    }
    warningDiv.style.display = 'none';
    bmConfirmDefaults = false;
    const filename = document.getElementById('bm-filename').value.trim();
    const toml = bmGenerateToml(data);
    send('saveBoard', { filename: filename + '.toml', content: toml });
}

function bmTogglePreview() {
    const pre = document.getElementById('bm-preview');
    if (pre.style.display === 'none') {
        const data = bmCollectData();
        for (const [key, defaultVal] of Object.entries(BM_DEFAULTS)) {
            const [section, field] = key.split('.');
            if (data[section] && (data[section][field] === undefined || data[section][field] === '')) {
                data[section][field] = isNaN(Number(defaultVal)) ? defaultVal : Number(defaultVal);
            }
        }
        pre.textContent = bmGenerateToml(data) || '(empty)';
        pre.style.display = '';
    } else {
        pre.style.display = 'none';
    }
}

document.addEventListener('input', (e) => {
    if (e.target.classList.contains('bm-input') && e.target.closest('#tab-boardMaker')) {
        e.target.classList.remove('bm-field-error');
        bmConfirmDefaults = false;
        document.getElementById('bm-defaults-warning').style.display = 'none';
    }
});

function bmPopulateForm(data) {
    if (data.board) {
        bmSetField('board', 'name', data.board.name);
        bmSetField('board', 'chip', data.board.chip);
        bmSetField('board', 'target', data.board.target);
    }
    if (data.probe) {
        bmAddSection('probe');
        bmSetField('probe', 'protocol', data.probe.protocol);
        bmSetField('probe', 'speed', data.probe.speed);
        bmSetField('probe', 'port', data.probe.port);
    }
    if (data.flash) {
        bmAddSection('flash');
        bmSetCheck('flash', 'restore_unwritten', data.flash.restore_unwritten);
        bmSetCheck('flash', 'halt_afterwards', data.flash.halt_afterwards);
    }
    if (data.rtt) {
        bmAddSection('rtt');
        bmSetCheck('rtt', 'enabled', data.rtt.enabled);
        if (data.rtt.channels) {
            const container = document.querySelector('#tab-boardMaker .bm-rtt-channels');
            data.rtt.channels.forEach(ch => {
                bmAddChannel(container);
                const rows = container.querySelectorAll('.bm-channel-row');
                const last = rows[rows.length - 1];
                last.querySelector('.bm-channel-up').value = ch.up;
                last.querySelector('.bm-channel-name').value = ch.name;
            });
        }
    }
    if (data.run) {
        bmAddSection('run');
        bmSetField('run', 'command', data.run.command);
    }
}

function bmSetField(section, field, value) {
    if (value == null) return;
    const el = document.querySelector(`#tab-boardMaker [data-section="${section}"][data-field="${field}"]`);
    if (el) el.value = value;
}

function bmSetCheck(section, field, value) {
    const el = document.querySelector(`#tab-boardMaker [data-section="${section}"][data-field="${field}"]`);
    if (el) el.checked = !!value;
}

bmUpdateAddMenu();

// ══════════════════════════════════════════════════════════════
// Unified message listener
// ══════════════════════════════════════════════════════════════
window.addEventListener('message', e => {
    const msg = e.data;
    switch (msg.command) {
        // ── Board Controls ──
        case 'init':
            render(msg.data);
            break;
        case 'ports': {
            const menu = document.getElementById('menu-port');
            const valEl = document.getElementById('cs-val-port');
            if (!menu) { break; }
            const cur = window.CURRENT_PORT || '';
            const ports = msg.data;
            const extra = cur && !ports.find(p => p.id === cur) ? [{ id: cur, label: cur }] : [];
            menu.innerHTML = '';
            [{ id: '', label: '-- auto --' }, ...ports, ...extra].forEach(p => {
                const displayName = p.id ? (_probeMap[p.id]?.name || p.label) : p.label;
                const el = makeDropItem(displayName, p.id === cur, () => pickPort(p.id, displayName));
                if (p.id) {
                    el.innerHTML = '';
                    const name = document.createElement('div');
                    name.className = 'drop-port-name';
                    name.textContent = displayName;
                    const id = document.createElement('div');
                    id.className = 'drop-port-id';
                    id.textContent = p.id;
                    el.appendChild(name);
                    el.appendChild(id);
                }
                el.dataset.val = p.id;
                menu.appendChild(el);
            });
            if (valEl) {
                const curPort = ports.find(p => p.id === cur);
                valEl.textContent = cur ? (_probeMap[cur]?.name || curPort?.label || cur) : 'auto';
            }
            break;
        }
        case 'probeRsStatus': {
            const area = document.getElementById('probeRsInstallArea');
            if (area) { area.style.display = msg.data.installed ? 'none' : 'block'; }
            break;
        }
        case 'toolStatus': {
            showToolInstall(!msg.data.found, _toolConfig?.name);
            break;
        }
        case 'toolInstallResult': {
            if (msg.data.success) {
                setToolState('success');
                const title = document.getElementById('toolInstallTitle');
                if (msg.data.message) { title.textContent = msg.data.message; }
                else { title.textContent = 'Installed'; }
            } else {
                setToolState('failed');
                const title = document.getElementById('toolInstallTitle');
                title.textContent = 'Failed';
            }
            break;
        }
        case 'checkDone':
            _checkRunning = false;
            { const btn = document.getElementById('checkRunBtn');
            if (btn) { btn.classList.remove('loading'); btn.disabled = false; } }
            break;
        case 'checkRunning':
            break;
        case 'flashProgress':
            onFlashProgress(msg.data);
            break;
        case 'probeStatus': {
            const dot = document.getElementById('probeDot');
            if (dot) {
                dot.className = 'probe-dot ' + (msg.data.connected ? 'connected' : 'disconnected');
                dot.title = msg.data.connected ? 'Probe connected' : 'No probe detected';
                if (msg.data.connected) {
                    dot.classList.remove('pulse');
                    void dot.offsetWidth;
                    dot.classList.add('pulse');
                }
            }
            if (!window.CURRENT_PORT) {
                const first = msg.data.probes?.[0];
                const firstName = first ? (msg.data.probeMap?.[first.id]?.name || first.label) : null;
                const autoText = firstName ? `auto \u00b7 ${firstName}` : 'auto';
                const valEl = document.getElementById('cs-val-port');
                if (valEl) { valEl.textContent = autoText; }
                const summary = document.getElementById('configSummary');
                if (summary && STATE) { summary.textContent = `${STATE.activeName} \u00b7 ${autoText}`; }
            }
            renderProbeNaming(msg.data.probes, msg.data.probeMap);
            break;
        }

        // ── Board Library ──
        case 'libSetup':
            LIB_CHECK_URI = msg.uris.check;
            LIB_DOWN_URI = msg.uris.down;
            LIB_REFRESH_URI = msg.uris.refresh;
            { const refreshIcon = document.getElementById('libRefreshIcon');
            if (refreshIcon) { refreshIcon.src = msg.uris.refresh; } }
            { const downIcon = document.getElementById('libDownIcon');
            if (downIcon) { downIcon.src = msg.uris.down; } }
            { const exRefresh = document.getElementById('exRefreshIcon');
            if (exRefresh) { exRefresh.src = msg.uris.refresh; } }
            { const npRefresh = document.getElementById('npRefreshIcon');
            if (npRefresh) { npRefresh.src = msg.uris.refresh; } }
            break;
        case 'libraryList':
            if (!msg.data.length) {
                document.getElementById('libContent').innerHTML = '<div class="lib-status">No .toml files found in repo.</div>';
                break;
            }
            libAllBoards = msg.data;
            libBoardIndex = Object.fromEntries(msg.data.map(b => [b.name, b.downloadUrl]));
            { const q = document.getElementById('libSearch').value;
            q.trim() ? libFilterBoards(q) : libRenderList(libAllBoards); }
            break;
        case 'libraryError': {
            const isConfig = msg.data.includes('No repo configured');
            document.getElementById('libContent').innerHTML = `
              <div class="lib-error">${esc(msg.data)}</div>
              ${isConfig ? '<button class="icon-btn" onclick="send(\'openSettings\')">Open Settings</button>' : ''}`;
            break;
        }
        case 'boardAddedToProject': {
            const idx = libAllBoards.findIndex(b => b.name === msg.data);
            if (idx !== -1) {
                libAllBoards[idx] = { ...libAllBoards[idx], inWorkspace: true };
                const c = libFindBtnsContainer(msg.data);
                if (c) { c.outerHTML = libStateBtns(libAllBoards[idx]); }
            }
            break;
        }
        case 'boardRemoved': {
            const idx = libAllBoards.findIndex(b => b.name === msg.data);
            if (idx !== -1) {
                libAllBoards[idx] = { ...libAllBoards[idx], inWorkspace: false };
                const c = libFindBtnsContainer(msg.data);
                if (c) { c.outerHTML = libStateBtns(libAllBoards[idx]); }
            }
            break;
        }
        case 'boardUpdated': {
            const idx = libAllBoards.findIndex(b => b.name === msg.data);
            if (idx !== -1) {
                libAllBoards[idx] = { ...libAllBoards[idx], hasUpdate: false };
                const c = libFindBtnsContainer(msg.data);
                if (c) { c.outerHTML = libStateBtns(libAllBoards[idx]); }
            }
            break;
        }
        case 'forceDownloadDone': {
            const btn = document.querySelector('#tab-library [title="Force check and download all from GitHub"]');
            if (btn) { btn.disabled = false; }
            libLoad();
            break;
        }
        case 'boardError': {
            const idx = libAllBoards.findIndex(b => b.name === msg.data.name);
            if (idx !== -1) {
                const c = libFindBtnsContainer(msg.data.name);
                if (c) { c.outerHTML = libStateBtns(libAllBoards[idx]); }
            }
            break;
        }

        // ── Examples ──
        case 'examplesList':
            allExamples = msg.data;
            exFilterExamples(document.getElementById('exSearch').value);
            break;
        case 'examplesError':
            document.getElementById('exContent').innerHTML = `<div class="lib-error">${esc(msg.data)}</div>`;
            break;

        // ── New Project ──
        case 'npInit': {
            const { hasConfig, hasBoardDir, boards, activeBoardFile: abf, uris, generateCommands } = msg.data;
            if (uris?.refresh) { document.getElementById('npRefreshIcon').src = uris.refresh; }
            npAllBoards = boards || [];
            npActiveBoardFile = abf || null;
            const q = document.getElementById('np-search').value;
            q.trim() ? npFilterBoards(q) : npRenderBoards(npAllBoards);
            const setupDiv = document.getElementById('np-setup');
            if (setupDiv) { setupDiv.style.display = hasBoardDir ? 'none' : ''; }
            document.getElementById('np-hint').style.display = hasConfig ? 'none' : '';
            document.getElementById('np-action').style.display = hasConfig ? 'block' : 'none';
            npInitGenerate(generateCommands || null);
            break;
        }
        case 'browseResult': {
            const locEl = document.getElementById('np-location');
            locEl.value = msg.data;
            locEl.classList.remove('np-error');
            break;
        }
        case 'browseGenResult': {
            const locEl = document.getElementById('np-gen-location');
            locEl.value = msg.data;
            locEl.classList.remove('np-error');
            break;
        }

        // ── Board Maker ──
        case 'loadBoard':
            bmPopulateForm(msg.data);
            break;
        case 'saved': {
            const btn = document.getElementById('bm-save-btn');
            btn.textContent = 'Saved!';
            btn.classList.add('done');
            setTimeout(() => { btn.textContent = 'Save Board'; btn.classList.remove('done'); }, 1500);
            break;
        }
        case 'saveError': {
            const errorDiv = document.getElementById('bm-error');
            errorDiv.textContent = msg.data;
            errorDiv.style.display = '';
            break;
        }
    }
});
