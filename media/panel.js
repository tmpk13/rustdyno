const vscode = acquireVsCodeApi();
function send(cmd, data) { vscode.postMessage({ command: cmd, data }); }

let STATE = null;
let _isConfigOpen = false;
let _isHiddenOpen = false;
let _firstRender = true;
let _uris = null;
let _probeMap = {};
let _currentProbes = [];

// --- Layout / edit mode ---

const SECTION_LABELS = { files: 'Files', actions: 'Actions', rtt: 'RTT', config: 'Config' };
const DEFAULT_ORDER = ['files', 'actions', 'rtt', 'config'];

let _editMode = false;
let _layout = { order: [...DEFAULT_ORDER], hidden: [] };
let _tomlLayout = null;
let _dragSectionId = null;

function applyLayout() {
    const container = document.getElementById('sectionsContainer');
    // Reorder sections to match _layout.order
    _layout.order.forEach(id => {
        const el = container.querySelector(`.panel-section[data-section="${id}"]`);
        if (el) { container.appendChild(el); }
    });
    // Apply visibility (only when not in edit mode)
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
    // Rebuild edit bars to reflect the restored state
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
    // No save here — saving happens when the user exits edit mode
}

function enterEditMode() {
    const container = document.getElementById('sectionsContainer');
    container.querySelectorAll('.panel-section').forEach(el => {
        const id = el.dataset.section;
        // Show all sections while editing
        el.style.display = '';
        el.draggable = true;

        const isHidden = _layout.hidden.includes(id);
        el.classList.toggle('edit-section-hidden', isHidden);

        // Insert edit bar at top of section
        const bar = document.createElement('div');
        bar.className = 'edit-bar';
        const eyeBtn = document.createElement('button');
        eyeBtn.className = 'edit-eye-btn';
        eyeBtn.textContent = isHidden ? '○' : '●';
        eyeBtn.title = isHidden ? 'Show section' : 'Hide section';
        eyeBtn.addEventListener('click', e => {
            e.stopPropagation();
            toggleSectionVisibility(id, eyeBtn);
        });
        const handle = document.createElement('span');
        handle.className = 'edit-handle';
        handle.textContent = '☰';
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
    // Capture current DOM order
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

        // Apply visibility
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
        eyeBtn.textContent = '●';
        eyeBtn.title = 'Hide section';
    } else {
        _layout.hidden.push(id);
        el.classList.add('edit-section-hidden');
        eyeBtn.textContent = '○';
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

// --- End layout / edit mode ---

function safeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function basename(p) {
    return p.split(/[\\/]/).pop() || p;
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
function sendAction(btn, cmd) { startSpin(btn, cmd); }

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
    document.querySelectorAll('.split-drop.open, .cs-btn.open').forEach(b => b.classList.remove('open'));
}
function pickTarget(file, cmd) {
    closeDrops();
    const btn = document.querySelector('#grp-' + cmd + ' .split-main');
    startSpin(btn, 'selectAndRun', { file, cmd });
}
document.addEventListener('click', closeDrops);

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

function spinRefresh(id) {
    const el = document.getElementById(id);
    if (!el) {return;}
    el.classList.remove('spin-once');
    void el.offsetWidth;
    el.classList.add('spin-once');
    el.addEventListener('animationend', () => el.classList.remove('spin-once'), { once: true });
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
    if (valEl) {valEl.textContent = label || 'auto';}
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
}

// --- Template helpers ---

function cloneTpl(id) {
    return document.getElementById(id).content.cloneNode(true).firstElementChild;
}

function makeFileItem(f, i, pickedFile) {
    const el = cloneTpl('tpl-file-item');
    if (f === pickedFile) { el.classList.add('active'); }
    el.dataset.file = f;
    el.dataset.index = String(i);
    el.title = f;
    el.addEventListener('dragstart', e => onDragStart(e, +e.currentTarget.dataset.index));
    el.addEventListener('dragend', onDragEnd);
    el.addEventListener('dragover', e => onDragOver(e, +e.currentTarget.dataset.index));
    el.addEventListener('drop', e => onDrop(e, +e.currentTarget.dataset.index));
    el.addEventListener('click', e => onItemClick(e, f));
    el.querySelector('.file-name').textContent = basename(f);
    el.querySelector('.remove-btn').addEventListener('click', e => {
        e.stopPropagation();
        send('hideFile', f);
    });
    return el;
}

function makeHiddenItem(f) {
    const el = cloneTpl('tpl-hidden-item');
    el.title = f;
    el.querySelector('.file-name').textContent = basename(f);
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

function makeActionBtn(cmd, actionCfg, files, pickedFile, uris, cmdPreviews) {
    const { label, color } = actionCfg;
    const tipCmd = cmdPreviews[cmd];
    if (files.length > 1) {
        const el = cloneTpl('tpl-action-split');
        el.id = 'grp-' + cmd;
        const main = el.querySelector('.split-main');
        main.style.background = color;
        main.dataset.tipLabel = label;
        main.dataset.tipCmd = tipCmd;
        main.addEventListener('click', () => sendAction(main, cmd));
        main.querySelector('.btn-label').textContent = label;
        main.querySelector('.btn-run-icon').src = uris.run;
        main.querySelector('.btn-check-icon').src = uris.check;
        main.querySelector('.btn-spin-icon').src = uris.refresh;
        const splitDrop = el.querySelector('.split-drop');
        splitDrop.style.background = color;
        splitDrop.querySelector('.drop-icon').src = uris.drop;
        splitDrop.addEventListener('click', e => toggleDrop(e, 'menu-' + cmd));
        const menu = el.querySelector('.drop-menu');
        menu.id = 'menu-' + cmd;
        files.forEach(f => menu.appendChild(makeDropItem(basename(f), f === pickedFile, () => pickTarget(f, cmd))));
        return el;
    } else {
        const el = cloneTpl('tpl-action-simple');
        el.style.background = color;
        el.dataset.tipLabel = label;
        el.dataset.tipCmd = tipCmd;
        el.addEventListener('click', () => sendAction(el, cmd));
        el.querySelector('.btn-label').textContent = label;
        el.querySelector('.btn-run-icon').src = uris.run;
        el.querySelector('.btn-check-icon').src = uris.check;
        el.querySelector('.btn-spin-icon').src = uris.refresh;
        return el;
    }
}

// --- Render ---

function render(state) {
    STATE = state;
    const { files, hiddenFiles, pickedFile, boards, activeBoardFile, activeName,
        effectivePort, portIsFromConfig, portOverride, cmdPreviews, uris, layout, actions } = state;

    // Always track the toml layout so reset knows what to restore to
    _tomlLayout = layout;

    const isFirst = _firstRender;
    if (isFirst) {
        _firstRender = false;
        window.CURRENT_PORT = portOverride;
        setUris(uris);
        // Load saved layout
        if (layout) {
            if (layout.order && layout.order.length) { _layout.order = layout.order; }
            if (layout.hidden) { _layout.hidden = layout.hidden; }
        }
        applyLayout();
    }

    // File list
    const fileList = document.getElementById('fileList');
    fileList.innerHTML = '';
    if (files.length) {
        files.forEach((f, i) => fileList.appendChild(makeFileItem(f, i, pickedFile)));
    } else {
        fileList.innerHTML = '<div class="file-empty">No files found</div>';
    }

    // Hidden file list
    const hiddenList = document.getElementById('hiddenList');
    hiddenList.innerHTML = '';
    if (hiddenFiles.length) {
        hiddenFiles.forEach(f => hiddenList.appendChild(makeHiddenItem(f)));
    } else {
        hiddenList.innerHTML = '<div class="file-empty">No hidden files</div>';
    }

    // Hidden toggle button
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

    // Action buttons
    const actionBtns = document.getElementById('actionBtns');
    actionBtns.innerHTML = '';
    ['build', 'flash'].forEach(cmd => {
        const cfg = actions?.[cmd] ?? { label: cmd[0].toUpperCase() + cmd.slice(1), color: '#4caf50' };
        actionBtns.appendChild(makeActionBtn(cmd, cfg, files, pickedFile, uris, cmdPreviews));
    });

    // RTT button
    const rttBtn = document.getElementById('rttBtn');
    rttBtn.dataset.tipCmd = cmdPreviews.rtt;
    if (actions?.rtt) {
        rttBtn.style.background = actions.rtt.color;
        rttBtn.querySelector('.btn-label').textContent = actions.rtt.label;
    }

    // Target dropdown
    document.getElementById('cs-val-target').textContent = pickedFile ? basename(pickedFile) : 'No files';
    const menuTarget = document.getElementById('menu-target');
    menuTarget.innerHTML = '';
    if (files.length) {
        files.forEach(f => menuTarget.appendChild(makeDropItem(basename(f), f === pickedFile, () => send('setTarget', f))));
    } else {
        menuTarget.innerHTML = '<div class="drop-item" style="opacity:0.5;cursor:default">No files</div>';
    }

    // Config summary
    const portDisplayName = effectivePort ? (_probeMap[effectivePort]?.name || effectivePort) : 'auto';
    document.getElementById('configSummary').textContent = `${activeName} \u00b7 ${portDisplayName}`;

    // Board dropdown
    document.getElementById('cs-val-board').textContent = activeBoardFile ? activeBoardFile.replace(/\.toml$/, '') : '-- choose a board --';
    const menuBoard = document.getElementById('menu-board');
    menuBoard.innerHTML = '';
    if (boards.length) {
        boards.forEach(f => menuBoard.appendChild(makeDropItem(f.replace(/\.toml$/, ''), f === activeBoardFile, () => send('selectBoard', f))));
    } else {
        menuBoard.innerHTML = '<div class="drop-item" style="opacity:0.5;cursor:default">No boards</div>';
    }

    // Active board label
    document.getElementById('activeBoardLabel').textContent = `Active: ${activeName}`;

    // Port label
    document.getElementById('portLabelEl').innerHTML = 'Port' + (portIsFromConfig
        ? ` <span style="opacity:0.6;font-style:italic">(from config: ${safeHtml(effectivePort)})</span>`
        : '');

    if (isFirst) {
        refreshPorts();
    }
}

window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.command === 'init') {
        render(msg.data);
    } else if (msg.command === 'ports') {
        const menu = document.getElementById('menu-port');
        const valEl = document.getElementById('cs-val-port');
        if (!menu) { return; }
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
    } else if (msg.command === 'probeStatus') {
        const dot = document.getElementById('probeDot');
        if (dot) {
            dot.className = 'probe-dot ' + (msg.data.connected ? 'connected' : 'disconnected');
            dot.title = msg.data.connected ? 'Probe connected' : 'No probe detected';
            if (msg.data.connected) {
                dot.classList.remove('pulse');
                void dot.offsetWidth; // reflow to restart animation
                dot.classList.add('pulse');
            }
        }
        if (!window.CURRENT_PORT) {
            const first = msg.data.probes?.[0];
            const firstName = first ? (msg.data.probeMap?.[first.id]?.name || first.label) : null;
            const autoText = firstName ? `auto · ${firstName}` : 'auto';
            const valEl = document.getElementById('cs-val-port');
            if (valEl) { valEl.textContent = autoText; }
            const summary = document.getElementById('configSummary');
            if (summary && STATE) { summary.textContent = `${STATE.activeName} \u00b7 ${autoText}`; }
        }
        renderProbeNaming(msg.data.probes, msg.data.probeMap);
    }
});

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

// --- Probe naming ---

function renderProbeNaming(probes, probeMap) {
    _currentProbes = probes || [];
    _probeMap = probeMap || {};
    const area = document.getElementById('probeNamingArea');
    const list = document.getElementById('probeNamingList');
    if (!area || !list) { return; }
    if (_currentProbes.length === 0) { area.style.display = 'none'; return; }
    area.style.display = 'block';
    // Preserve any in-progress input values and focus before re-rendering
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
        // Restore in-progress value if the user had typed something unsaved
        if (probe.id in draftValues) {
            const input = row.querySelector('.probe-name-input');
            if (input) { input.value = draftValues[probe.id]; }
        }
        list.appendChild(row);
    });
    // Restore focus
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

    // Save name alone (Enter key or when no board yet)
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

// --- End probe naming ---

// Tooltip — event delegation so it works after re-renders
(function initTooltips() {
    const tip = document.createElement('div');
    tip.className = 'btn-tooltip';
    document.body.appendChild(tip);
    let timer = null;

    document.addEventListener('mouseover', e => {
        const btn = e.target.closest('button[data-tip-cmd]');
        if (!btn) {return;}
        const rect = btn.getBoundingClientRect();
        tip.textContent = btn.dataset.tipLabel || '';
        tip.style.display = 'block';
        tip.style.left = rect.left + 'px';
        tip.style.top = (rect.bottom + 6) + 'px';
        timer = setTimeout(() => { tip.textContent = btn.dataset.tipCmd || ''; }, 2000);
    });

    document.addEventListener('mouseout', e => {
        if (!e.target.closest('button[data-tip-cmd]')) {return;}
        clearTimeout(timer);
        tip.style.display = 'none';
    });
})();
