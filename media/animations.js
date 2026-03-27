// ══════════════════════════════════════════════════════════════
// Shared animation helpers for rustdyno webviews
// ══════════════════════════════════════════════════════════════

const Anim = (() => {
    const EXPAND_MS  = 180;
    const SNAP_MS    = 90;

    // Shared tooltip element — created once, reused everywhere
    let _tip = null;
    function getTip() {
        if (!_tip) {
            _tip = document.createElement('div');
            _tip.className = 'btn-tooltip';
            document.body.appendChild(_tip);
        }
        return _tip;
    }

    /**
     * Position the tooltip near `anchor` rect, preferring width-first layout.
     * Picks whichever vertical/horizontal direction has room in the viewport.
     * Returns the chosen transform-origin string for animations.
     */
    function positionTip(tip, anchorRect) {
        const gap = 6;
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;

        // Make visible off-screen so we can measure natural size
        tip.style.display = 'block';
        tip.style.left = '-9999px';
        tip.style.top = '-9999px';
        tip.style.maxWidth = '';

        // Let it fill available width first to avoid over-clamping
        const availW = vw - 16; // 8px margin each side
        tip.style.maxWidth = availW + 'px';

        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;

        // Horizontal: prefer left-aligned with anchor, shift left if overflows
        let x = anchorRect.left;
        let originX = 'left';
        if (x + tw > vw - 8) {
            x = anchorRect.right - tw;
            originX = 'right';
        }
        if (x < 8) {
            x = 8;
            originX = 'left';
        }

        // Vertical: prefer below anchor, flip above if no room
        let y = anchorRect.bottom + gap;
        let originY = 'top';
        if (y + th > vh - 8) {
            y = anchorRect.top - gap - th;
            originY = 'bottom';
        }
        if (y < 8) {
            y = 8;
            originY = 'top';
        }

        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
        return originX + ' ' + originY;
    }

    /** Show tooltip with expand animation */
    function tooltipIn(el, origin) {
        const o = origin || 'left top';
        el.getAnimations().forEach(a => a.cancel());
        el.animate([
            { opacity: 0, transform: 'scaleX(0)',   transformOrigin: o },
            { opacity: 1, transform: 'scaleX(1)',   transformOrigin: o }
        ], { duration: EXPAND_MS, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' });
    }

    /** Hide tooltip with fast snap-out */
    function tooltipOut(el, origin) {
        const o = origin || 'left top';
        const anim = el.animate([
            { opacity: 1, transform: 'scaleX(1)',   transformOrigin: o },
            { opacity: 0, transform: 'scaleX(0.6)', transformOrigin: o }
        ], { duration: SNAP_MS, easing: 'ease-in', fill: 'forwards' });
        anim.onfinish = () => { el.style.display = 'none'; };
    }

    // ── Native title-attribute replacement ──────────────────────
    // Replaces browser default tooltips on [title] elements with
    // the same animated .btn-tooltip style.

    function initTitleTooltips() {
        const tip = getTip();
        let activeEl = null;

        // Move title into data-title so the browser doesn't show its own.
        // Re-stash if title was updated dynamically after initial stash.
        function stash(el) {
            if (el.title) {
                el.dataset.title = el.title;
                el.title = '';
            }
        }

        document.addEventListener('mouseover', e => {
            // Skip elements handled by the data-tip-cmd system
            if (e.target.closest('[data-tip-cmd]')) return;

            const el = e.target.closest('[title], [data-title]');
            if (!el) return;

            stash(el);
            const text = el.dataset.title;
            if (!text) return;
            if (activeEl === el) return;
            activeEl = el;

            const rect = el.getBoundingClientRect();
            tip.textContent = text;
            const origin = positionTip(tip, rect);
            tooltipIn(tip, origin);
        });

        document.addEventListener('mouseout', e => {
            const el = e.target.closest('[data-title]');
            if (!el || el !== activeEl) return;
            activeEl = null;
            tooltipOut(tip);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTitleTooltips);
    } else {
        initTitleTooltips();
    }

    return { getTip, positionTip, tooltipIn, tooltipOut };
})();
