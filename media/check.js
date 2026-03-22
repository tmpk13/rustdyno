const vscode = acquireVsCodeApi();
function send(cmd, data) { vscode.postMessage({ command: cmd, data }); }

// ── filters ───────────────────────────────────────────────────────────────────

function applyFilters() {
    const showErrors   = document.getElementById('showErrors').checked;
    const showWarnings = document.getElementById('showWarnings').checked;
    const showNotes    = document.getElementById('showNotes').checked;
    const showCheck    = document.getElementById('showCheck').checked;
    const showClipy    = document.getElementById('showClipy').checked;

    document.querySelectorAll('.diag-item[data-level]').forEach(el => {
        const level  = el.dataset.level;
        const source = el.dataset.source;
        const levelOk = (level === 'error' && showErrors)
            || (level === 'warning' && showWarnings)
            || ((level === 'note' || level === 'help' || level === 'failure-note') && showNotes);
        const sourceOk = (source === 'check' && showCheck) || (source === 'clippy' && showClipy);
        el.classList.toggle('filtered', !(levelOk && sourceOk));
    });
}

['showErrors', 'showWarnings', 'showNotes', 'showCheck', 'showClipy'].forEach(id => {
    document.getElementById(id).addEventListener('change', applyFilters);
});

// ── template rendering ────────────────────────────────────────────────────────

function cloneTpl(id) {
    return document.getElementById(id).content.cloneNode(true).firstElementChild;
}

function renderSpan(span) {
    const el = cloneTpl('tpl-span');
    el.dataset.rank = String(span.rank);
    el.querySelector('.span-badge').textContent = span.is_primary ? 'primary' : 'secondary';
    const link = el.querySelector('.span-link');
    link.textContent = `${span.file_name}:${span.line_start}:${span.column_start}`;
    link.title = span.abs_path;
    link.addEventListener('click', () => {
        send('openFile', { path: span.abs_path, line: span.line_start, column: span.column_start });
    });
    const labelEl = el.querySelector('.span-label');
    labelEl.textContent = span.label ? ` \u2014 ${span.label}` : '';
    return el;
}

function renderDiag(diag) {
    const el = cloneTpl('tpl-diag');
    el.dataset.level  = diag.level;
    el.dataset.source = diag.source;
    el.classList.add(`level-${diag.level}`);

    const levelEl = el.querySelector('.diag-level');
    levelEl.textContent = diag.level;
    levelEl.className = `diag-level ${diag.level}`;

    el.querySelector('.diag-code').textContent    = diag.code ? `[${diag.code}]` : '';
    el.querySelector('.diag-message').textContent = diag.message;
    el.querySelector('.diag-source').textContent  = diag.source;

    const spansEl = el.querySelector('.diag-spans');
    diag.spans.forEach(span => spansEl.appendChild(renderSpan(span)));

    el.querySelector('.diag-rendered-pre').textContent = diag.rendered;
    if (!diag.rendered) {
        el.querySelector('.diag-rendered').style.display = 'none';
    }

    return el;
}

function renderResults(result) {
    document.getElementById('loadingMsg').style.display = 'none';

    const parts = [];
    if (result.errorCount)   { parts.push(`${result.errorCount} error${result.errorCount !== 1 ? 's' : ''}`); }
    if (result.warningCount) { parts.push(`${result.warningCount} warning${result.warningCount !== 1 ? 's' : ''}`); }
    if (!result.checkSuccess) { parts.push('check failed'); }
    else if (result.checkSuccess && !result.clippySuccess) { parts.push('clippy failed'); }
    document.getElementById('summary').textContent = parts.length ? parts.join(', ') : 'No issues \u2714';

    const list = document.getElementById('diagList');
    list.innerHTML = '';

    if (result.diagnostics.length === 0) {
        document.getElementById('emptyMsg').style.display = 'block';
    } else {
        document.getElementById('emptyMsg').style.display = 'none';
        // Sort: errors first, then warnings, then others
        const order = { error: 0, warning: 1, note: 2, help: 3, 'failure-note': 4 };
        const sorted = [...result.diagnostics].sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9));
        sorted.forEach(d => list.appendChild(renderDiag(d)));
    }

    applyFilters();
}

// ── message handler ───────────────────────────────────────────────────────────

window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.command === 'checkRunning') {
        document.getElementById('loadingMsg').style.display = 'block';
        document.getElementById('emptyMsg').style.display   = 'none';
        document.getElementById('diagList').innerHTML = '';
        document.getElementById('summary').textContent = 'Running\u2026';
    } else if (msg.command === 'checkResults') {
        renderResults(msg.data);
    }
});
