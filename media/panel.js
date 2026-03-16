const vscode = acquireVsCodeApi();
function send(cmd, data) { vscode.postMessage({ command: cmd, data }); }

function startSpin(btn, cmd, data) {
    if (btn.classList.contains('loading') || btn.classList.contains('done')) return;
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
    const section = document.getElementById('configSection');
    const arrow = document.getElementById('configArrow');
    const open = section.style.display === 'none';
    section.style.display = open ? 'block' : 'none';
    arrow.classList.toggle('open', open);
}

function toggleHidden() {
    const section = document.getElementById('hiddenSection');
    const btn = document.getElementById('hiddenToggle');
    const opening = section.style.display === 'none';
    section.style.display = opening ? 'block' : 'none';
    btn.style.opacity = opening ? '1' : (window.HIDDEN_COUNT > 0 ? '1' : '0.5');
}

function safeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function refreshPorts() {
    send('listPorts');
}

function pickPort(val, label) {
    window.CURRENT_PORT = val;
    document.querySelectorAll('#menu-port .drop-item').forEach(el => {
        el.classList.toggle('drop-active', el.dataset.val === val);
    });
    const valEl = document.getElementById('cs-val-port');
    if (valEl) valEl.textContent = label || 'auto';
    closeDrops();
    send('setPort', val);
}

window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.command === 'ports') {
        const menu = document.getElementById('menu-port');
        const valEl = document.getElementById('cs-val-port');
        if (!menu) { return; }
        const cur = window.CURRENT_PORT || '';
        const ports = msg.data;
        const extra = cur && !ports.find(p => p.id === cur) ? [{ id: cur, label: cur }] : [];
        menu.innerHTML = [{ id: '', label: '-- auto --' }, ...ports, ...extra]
            .map(p => `<div class="drop-item${p.id === cur ? ' drop-active' : ''}" data-val="${safeHtml(p.id)}" onclick="pickPort(${JSON.stringify(p.id)},${JSON.stringify(p.label)})">${safeHtml(p.label)}</div>`)
            .join('');
        if (valEl) valEl.textContent = cur ? (ports.find(p => p.id === cur)?.label ?? cur) : 'auto';
    } else if (msg.command === 'probeStatus') {
        const dot = document.getElementById('probeDot');
        if (!dot) { return; }
        dot.className = 'probe-dot ' + (msg.data.connected ? 'connected' : 'disconnected');
        dot.title = msg.data.connected ? 'Probe connected' : 'No probe detected';
    }
});

refreshPorts();

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
    if (dragSrcIndex === null || dragSrcIndex === dropIndex) return;

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
        el.setAttribute('ondragstart', 'onDragStart(event,' + i + ')');
        el.setAttribute('ondragover', 'onDragOver(event,' + i + ')');
        el.setAttribute('ondrop', 'onDrop(event,' + i + ')');
    });

    dragSrcIndex = null;
    document.querySelectorAll('.file-item').forEach(el => el.classList.remove('drag-over'));
}

(function initTooltips() {
    const tip = document.createElement('div');
    tip.className = 'btn-tooltip';
    document.body.appendChild(tip);
    let timer = null;

    document.querySelectorAll('button[data-tip-cmd]').forEach(btn => {
        btn.addEventListener('mouseenter', () => {
            const rect = btn.getBoundingClientRect();
            tip.textContent = btn.dataset.tipLabel || '';
            tip.style.display = 'block';
            tip.style.left = rect.left + 'px';
            tip.style.top = (rect.bottom + 6) + 'px';
            timer = setTimeout(() => {
                tip.textContent = btn.dataset.tipCmd || '';
            }, 2000);
        });
        btn.addEventListener('mouseleave', () => {
            clearTimeout(timer);
            tip.style.display = 'none';
        });
    });
})();