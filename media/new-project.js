const vscode = acquireVsCodeApi();
function send(cmd, data) { vscode.postMessage({ command: cmd, data }); }

let allBoards = [];
let activeBoardFile = null;

// --- fuzzy search (same as library.js) ---
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
// -----------------------------------------

function renderBoards(boards) {
    const list = document.getElementById('np-board-list');
    if (!boards.length) {
        list.innerHTML = '<div class="lib-status">No boards found.</div>';
        return;
    }
    list.innerHTML = boards.map(f => {
        const active = f === activeBoardFile;
        return `<div class="lib-item np-board-item${active ? ' np-active' : ''}" onclick="selectBoard('${esc(f)}')" data-file="${esc(f)}">` +
            `<span class="lib-name">${esc(f.replace(/\.toml$/, ''))}</span>` +
            `</div>`;
    }).join('');
}

function filterBoards(query) {
    if (!allBoards.length) return;
    const q = query.trim();
    if (!q) { renderBoards(allBoards); return; }
    const scored = allBoards
        .map(f => ({ f, score: fuzzyScore(q, f.replace(/\.toml$/, '')) }))
        .filter(x => x.score > 0.25)
        .sort((a, z) => z.score - a.score);
    renderBoards(scored.map(x => x.f));
}

function selectBoard(file) {
    activeBoardFile = file;
    renderBoards(allBoards);
    send('selectBoard', file);
}

function browseLocation() {
    send('browseFolder');
}

function clearError(el) {
    el.classList.remove('np-error');
}

function createProject() {
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

function spinRefresh(id) {
    const el = document.getElementById(id);
    if (!el) { return; }
    el.classList.remove('spin-once');
    void el.offsetWidth;
    el.classList.add('spin-once');
    el.addEventListener('animationend', () => el.classList.remove('spin-once'), { once: true });
}

function refreshBoards() {
    spinRefresh('npRefreshIcon');
    send('refreshBoards');
}

window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.command === 'init') {
        const { hasConfig, boards, activeBoardFile: abf, uris } = msg.data;
        if (uris?.refresh) { document.getElementById('npRefreshIcon').src = uris.refresh; }
        allBoards = boards || [];
        activeBoardFile = abf || null;

        const q = document.getElementById('np-search').value;
        q.trim() ? filterBoards(q) : renderBoards(allBoards);

        document.getElementById('np-hint').style.display = hasConfig ? 'none' : '';
        document.getElementById('np-action').style.display = hasConfig ? '' : 'none';
    } else if (msg.command === 'browseResult') {
        const locEl = document.getElementById('np-location');
        locEl.value = msg.data;
        locEl.classList.remove('np-error');
    }
});

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
