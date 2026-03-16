const vscode = acquireVsCodeApi();
function send(cmd, data) { vscode.postMessage({ command: cmd, data }); }

let STATE = null;
let _isConfigOpen = false;
let _isHiddenOpen = false;
let _firstRender = true;

function safeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function basename(p) {
    return p.split(/[\\/]/).pop() || p;
}

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
    btn.style.opacity = (_isHiddenOpen || hasHidden) ? '1' : '0.5';
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

function render(state) {
    STATE = state;
    const esc = safeHtml;
    const { files, hiddenFiles, pickedFile, boards, activeBoardFile, activeName,
        effectivePort, portIsFromConfig, portOverride, cmdPreviews, uris } = state;

    // Seed CURRENT_PORT only on first render (pickPort manages it after that)
    if (_firstRender) {
        window.CURRENT_PORT = portOverride;
    }

    const fileItems = files.length
        ? files.map((f, i) =>
            `<div class="file-item${f === pickedFile ? ' active' : ''}" draggable="true" data-file="${esc(f)}" data-index="${i}" ondragstart="onDragStart(event,${i})" ondragend="onDragEnd(event)" ondragover="onDragOver(event,${i})" ondrop="onDrop(event,${i})" onclick="onItemClick(event,${esc(JSON.stringify(f))})" title="${esc(f)}">
  <span class="file-name">${esc(basename(f))}</span>
  <button class="remove-btn" draggable="false" onclick="event.stopPropagation();send('hideFile',${esc(JSON.stringify(f))})" title="Hide file">✕</button>
</div>`).join('\n')
        : '<div class="file-empty">No files found</div>';

    const hiddenItems = hiddenFiles.length
        ? hiddenFiles.map(f =>
            `<div class="file-item hidden-item" title="${esc(f)}">
  <span class="file-name">${esc(basename(f))}</span>
  <button class="remove-btn" onclick="event.stopPropagation();send('unhideFile',${esc(JSON.stringify(f))})" title="Restore file">✕</button>
</div>`).join('\n')
        : '<div class="file-empty">No hidden files</div>';

    const actionBtns = ['build', 'flash'].map(cmd => {
        const label = cmd[0].toUpperCase() + cmd.slice(1);
        const tipCmd = esc(cmdPreviews[cmd]);
        const inner = `<span class="btn-icon"><img src="${uris.run}" class="btn-run-icon"></span>
  <span class="btn-label">${label}</span>
  <span class="btn-check"><img src="${uris.check}" class="btn-check-icon"></span>`;
        if (files.length > 1) {
            const dropItems = files.map(f =>
                `<div class="drop-item${f === pickedFile ? ' drop-active' : ''}" onclick="pickTarget(${esc(JSON.stringify(f))},'${cmd}')">${esc(basename(f))}</div>`
            ).join('');
            return `<div class="split-group" id="grp-${cmd}">
  <button class="split-main action-button" onclick="sendAction(this,'${cmd}')" data-tip-label="${label}" data-tip-cmd="${tipCmd}">${inner}</button>
  <button class="split-drop" onclick="toggleDrop(event,'menu-${cmd}')"><img src="${uris.drop}" class="drop-icon"></button>
  <div class="drop-menu" id="menu-${cmd}">${dropItems}</div>
</div>`;
        }
        return `<button onclick="sendAction(this,'${cmd}')" class="action-button" data-tip-label="${label}" data-tip-cmd="${tipCmd}">${inner}</button>`;
    }).join('\n');

    const boardItems = boards.length
        ? boards.map(f => `<div class="drop-item${f === activeBoardFile ? ' drop-active' : ''}" onclick="send('selectBoard',${esc(JSON.stringify(f))})">${esc(f.replace(/\.toml$/, ''))}</div>`).join('')
        : '<div class="drop-item" style="opacity:0.5;cursor:default">No boards</div>';

    const targetItems = files.length
        ? files.map(f => `<div class="drop-item${f === pickedFile ? ' drop-active' : ''}" onclick="send('selectFile',${esc(JSON.stringify(f))})">${esc(basename(f))}</div>`).join('')
        : '<div class="drop-item" style="opacity:0.5;cursor:default">No files</div>';

    const portSummary = effectivePort ? esc(effectivePort) : 'auto';
    const configSummary = `${activeName} · ${portSummary}`;
    const portLabel = portIsFromConfig
        ? ` <span style="opacity:0.6;font-style:italic">(from config: ${esc(effectivePort)})</span>`
        : '';

    document.getElementById('root').innerHTML = `<div class="section-row">
  <span class="label">Files</span>
  <div style="display:flex;gap:4px">
    <button class="icon-btn" id="hiddenToggle" onclick="toggleHidden()" title="Toggle hidden files" style="opacity:${hiddenFiles.length > 0 ? '1' : '0.5'}">◌${hiddenFiles.length > 0 ? ` ${hiddenFiles.length}` : ''}</button>
    <button class="icon-btn" onclick="send('refresh')" title="Refresh file list"><img src="${uris.refresh}" class="icon-svg"></button>
  </div>
</div>
<div class="file-list" id="fileList">
  ${fileItems}
</div>
<div id="hiddenSection" style="display:none">
  <div class="label" style="margin-top:4px">Hidden</div>
  <div class="file-list">
    ${hiddenItems}
  </div>
</div>
${actionBtns}
<button onclick="sendAction(this,'rtt')" class="action-button" data-tip-label="RTT Monitor" data-tip-cmd="${esc(cmdPreviews.rtt)}">
  <span class="btn-icon"><img src="${uris.run}" class="btn-run-icon"></span>
  <span class="btn-label">RTT Monitor</span>
  <span class="btn-check"><img src="${uris.check}" class="btn-check-icon"></span>
</button>
<div class="label">Target</div>
<div class="cs-wrap">
  <div class="cs-btn" onclick="toggleDrop(event,'menu-target')">
    <span class="cs-val">${pickedFile ? esc(basename(pickedFile)) : 'No files'}</span>
    <img src="${uris.drop}" class="drop-icon">
  </div>
  <div class="drop-menu" id="menu-target">${targetItems}</div>
</div>
<div class="config-header" onclick="toggleConfig()">
  <img src="${uris.drop}" class="config-arrow" id="configArrow">
  <span class="config-summary" id="configSummary">${configSummary}</span>
  <span id="probeDot" class="probe-dot" title="Checking..."></span>
</div>
<div id="configSection" style="display:none">
  <div class="label" style="margin-top:6px">Board</div>
  <div class="cs-wrap">
    <div class="cs-btn" onclick="toggleDrop(event,'menu-board')">
      <span class="cs-val">${activeBoardFile ? esc(activeBoardFile.replace(/\.toml$/, '')) : '-- choose a board --'}</span>
      <img src="${uris.drop}" class="drop-icon">
    </div>
    <div class="drop-menu" id="menu-board">${boardItems}</div>
  </div>
  <div class="active-board">Active: ${activeName}</div>
  <div class="label">Port${portLabel}</div>
  <div style="display:flex;gap:4px;margin-bottom:8px">
    <div class="cs-wrap" style="flex:1;margin:0">
      <div class="cs-btn" onclick="toggleDrop(event,'menu-port')">
        <span class="cs-val" id="cs-val-port">${effectivePort || 'auto'}</span>
        <img src="${uris.drop}" class="drop-icon">
      </div>
      <div class="drop-menu" id="menu-port">
        <div class="drop-item${!portOverride ? ' drop-active' : ''}" data-val="" onclick="pickPort('','auto')">-- auto --</div>
      </div>
    </div>
    <button class="icon-btn" onclick="refreshPorts()" title="Refresh port list" style="flex-shrink:0"><img src="${uris.refresh}" class="icon-svg"></button>
  </div>
</div>`;

    // Restore open/closed state across re-renders
    if (_isConfigOpen) {
        document.getElementById('configSection').style.display = 'block';
        document.getElementById('configArrow').classList.add('open');
    }
    if (_isHiddenOpen) {
        document.getElementById('hiddenSection').style.display = 'block';
    }

    if (_firstRender) {
        _firstRender = false;
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

// Tooltip — event delegation so it works after re-renders
(function initTooltips() {
    const tip = document.createElement('div');
    tip.className = 'btn-tooltip';
    document.body.appendChild(tip);
    let timer = null;

    document.addEventListener('mouseover', e => {
        const btn = e.target.closest('button[data-tip-cmd]');
        if (!btn) return;
        const rect = btn.getBoundingClientRect();
        tip.textContent = btn.dataset.tipLabel || '';
        tip.style.display = 'block';
        tip.style.left = rect.left + 'px';
        tip.style.top = (rect.bottom + 6) + 'px';
        timer = setTimeout(() => { tip.textContent = btn.dataset.tipCmd || ''; }, 2000);
    });

    document.addEventListener('mouseout', e => {
        if (!e.target.closest('button[data-tip-cmd]')) return;
        clearTimeout(timer);
        tip.style.display = 'none';
    });
})();
