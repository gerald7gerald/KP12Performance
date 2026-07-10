// schedule-widget.js
// Drop a <div id="schedule-widget"></div> anywhere on a page,
// include this script, and the live schedule will render inside it.

(function () {
    const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    const CATEGORY_COLORS = {
        'Athletics': 'var(--athletics)',
        'Training':  'var(--training)',
        'Nutrition': 'var(--nutrition, #FFC247)'
    };

    function formatTime(t) { return t || ""; }

    function groupByDay(slots) {
        const map = {};
        DAYS.forEach(d => { map[d] = []; });
        slots.forEach(s => {
            if (map[s.day_of_week]) map[s.day_of_week].push(s);
        });
        return map;
    }

    function render(slots, container) {
        if (!container) return;
        const byDay = groupByDay(slots);

        const hasAny = slots.length > 0;

        if (!hasAny) {
            container.innerHTML = `
                <p style="font-family:'JetBrains Mono',monospace;font-size:13px;color:#8C8F96;text-align:center;padding:32px 0;">
                    No sessions scheduled yet — check back soon.
                </p>`;
            return;
        }

        container.innerHTML = `
            <div class="sched-grid">
                ${DAYS.map(day => {
                    const daySlots = byDay[day];
                    return `
                        <div class="sched-day ${daySlots.length === 0 ? 'sched-day--empty' : ''}">
                            <p class="sched-day-label">${day.toUpperCase()}</p>
                            <div class="sched-slots">
                                ${daySlots.length === 0
                                    ? '<p class="sched-no-slots">—</p>'
                                    : daySlots.map(s => `
                                        <div class="sched-slot" style="border-left-color:${CATEGORY_COLORS[s.category] || '#8C8F96'}">
                                            <span class="sched-slot-cat" style="color:${CATEGORY_COLORS[s.category] || '#8C8F96'}">${s.category}</span>
                                            ${s.subcategory ? `<span class="sched-slot-sub">${s.subcategory}</span>` : ""}
                                            <span class="sched-slot-time">${formatTime(s.start_time)} – ${formatTime(s.end_time)}</span>
                                        </div>
                                    `).join("")
                                }
                            </div>
                        </div>
                    `;
                }).join("")}
            </div>
        `;
    }

    function init() {
        const container = document.getElementById("schedule-widget");
        if (!container) return;

        container.innerHTML = `<p style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#8C8F96;text-align:center;padding:24px;">Loading schedule...</p>`;

        fetch('/api/schedule')
            .then(res => res.json())
            .then(slots => render(slots, container))
            .catch(() => {
                container.innerHTML = `<p style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#8C8F96;text-align:center;padding:24px;">Couldn't load schedule right now.</p>`;
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();