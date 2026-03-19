const vscode = acquireVsCodeApi();
let CHECK_URI = '';
let DOWN_URI = '';
let REFRESH_URI = '';

let boardIndex = {};
let allBoards = [];

function send(cmd, data) { vscode.postMessage({ command: cmd, data }); }
function checkBtn(name) { return `<button class="lib-added" data-board="${esc(name)}" ondblclick="removeBoard(this)" title="Double-click to remove from project"><img src="${CHECK_URI}"></button>`; }
function downBtn(name, url) { return `<button class="lib-down" data-board="${esc(name)}" data-url="${esc(url)}" onclick="downloadBoard(this)" title="Add to project"><img src="${DOWN_URI}"></button>`; }
function updateBtn(name, url) { return `<button class="lib-update" data-board="${esc(name)}" data-url="${esc(url)}" onclick="updateBoard(this)" title="Update to latest version"><img src="${REFRESH_URI}"></button>`; }
function stateBtns(b) {
    if (b.inWorkspace) {
        return `<span class="lib-btns">${checkBtn(b.name)}${b.hasUpdate ? updateBtn(b.name, b.downloadUrl) : ''}</span>`;
    }
    return `<span class="lib-btns">${downBtn(b.name, b.downloadUrl)}</span>`;
}
function removeBoard(btn) { const name = btn.dataset.board; btn.disabled = true; send('removeBoard', name); }

function findBtnsContainer(name) {
    const btn = document.querySelector(`[data-board="${CSS.escape(name)}"]`);
    return btn ? btn.closest('.lib-btns') : null;
}

// --- fuzzy search ---
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
// --------------------

function renderList(boards) {
    if (!boards.length) {
        document.getElementById('content').innerHTML = '<div class="lib-status">No matches.</div>';
        return;
    }
    const rows = boards.map(b => {
        return `<div class="lib-item"><span class="lib-name" title="${esc(b.path)}">${esc(b.path.replace(/\.toml$/, ''))}</span>${stateBtns(b)}</div>`;
    }).join('');
    document.getElementById('content').innerHTML = `<div class="lib-list">${rows}</div>`;
}

function filterBoards(query) {
    if (!allBoards.length) return;
    const q = query.trim();
    if (!q) { renderList(allBoards); return; }
    const scored = allBoards
        .map(b => ({ b, score: fuzzyScore(q, b.path.replace(/\.toml$/, '')) }))
        .filter(x => x.score > 0.25)
        .sort((a, z) => z.score - a.score);
    renderList(scored.map(x => x.b));
}

function spinImg(id) {
    const el = document.getElementById(id);
    if (!el) { return; }
    el.classList.remove('spin-once');
    void el.offsetWidth;
    el.classList.add('spin-once');
    el.addEventListener('animationend', () => el.classList.remove('spin-once'), { once: true });
}

function load() {
    spinImg('refreshIcon');
    document.getElementById('content').innerHTML = '<div class="lib-status">Loading…</div>';
    send('fetchLibrary');
}

function forceDownloadAll(btn) {
    btn.disabled = true;
    send('forceDownloadAll');
}

function downloadBoard(btn) {
    const name = btn.dataset.board;
    const downloadUrl = btn.dataset.url;
    btn.disabled = true; btn.innerHTML = '…';
    send('downloadBoard', { name, downloadUrl });
}

function updateBoard(btn) {
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

window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.command === 'setup') {
        CHECK_URI = msg.uris.check;
        DOWN_URI = msg.uris.down;
REFRESH_URI = msg.uris.refresh;
        const refreshIcon = document.getElementById('refreshIcon');
        if (refreshIcon) { refreshIcon.src = msg.uris.refresh; }
        const downIcon = document.getElementById('downIcon');
        if (downIcon) { downIcon.src = msg.uris.down; }
        load();
    } else if (msg.command === 'libraryList') {
        if (!msg.data.length) {
            document.getElementById('content').innerHTML = '<div class="lib-status">No .toml files found in repo.</div>';
            return;
        }
        allBoards = msg.data;
        boardIndex = Object.fromEntries(msg.data.map(b => [b.name, b.downloadUrl]));
        const q = document.getElementById('search').value;
        q.trim() ? filterBoards(q) : renderList(allBoards);
    } else if (msg.command === 'libraryError') {
        const isConfig = msg.data.includes('No repo configured');
        document.getElementById('content').innerHTML = `
          <div class="lib-error">${esc(msg.data)}</div>
          ${isConfig ? '<button class="icon-btn" onclick="send(\'openSettings\')">Open Settings</button>' : ''}`;
    } else if (msg.command === 'boardAddedToProject') {
        const idx = allBoards.findIndex(b => b.name === msg.data);
        if (idx !== -1) {
            allBoards[idx] = { ...allBoards[idx], inWorkspace: true };
            const c = findBtnsContainer(msg.data);
            if (c) { c.outerHTML = stateBtns(allBoards[idx]); }
        }
    } else if (msg.command === 'boardRemoved') {
        const idx = allBoards.findIndex(b => b.name === msg.data);
        if (idx !== -1) {
            allBoards[idx] = { ...allBoards[idx], inWorkspace: false };
            const c = findBtnsContainer(msg.data);
            if (c) { c.outerHTML = stateBtns(allBoards[idx]); }
        }
    } else if (msg.command === 'boardUpdated') {
        const idx = allBoards.findIndex(b => b.name === msg.data);
        if (idx !== -1) {
            allBoards[idx] = { ...allBoards[idx], hasUpdate: false };
            const c = findBtnsContainer(msg.data);
            if (c) { c.outerHTML = stateBtns(allBoards[idx]); }
        }
    } else if (msg.command === 'forceDownloadDone') {
        const btn = document.querySelector('[onclick^="forceDownloadAll"]') || document.querySelector('[title="Force check and download all from GitHub"]');
        if (btn) { btn.disabled = false; }
        load();
    } else if (msg.command === 'boardError') {
        const idx = allBoards.findIndex(b => b.name === msg.data.name);
        if (idx !== -1) {
            const c = findBtnsContainer(msg.data.name);
            if (c) { c.outerHTML = stateBtns(allBoards[idx]); }
        }
    }
});

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
