// elite-players.js
// Fetches admin-curated elite athletes and renders them in a cycling slideshow.
// Drop <div id="elite-players-section"></div> on any page and include this script.

(function () {
    const INTERVAL = 6000;

    function init() {
        const section = document.getElementById('elite-players-section');
        if (!section) return;

        fetch('/api/elite-players')
            .then(r => r.json())
            .then(players => {
                if (!Array.isArray(players) || players.length === 0) {
                    section.style.display = 'none';
                    return;
                }
                render(players, section);
            })
            .catch(() => { section.style.display = 'none'; });
    }

    function esc(str) {
        if (!str) return '';
        const d = document.createElement('div');
        d.textContent = String(str);
        return d.innerHTML;
    }

    function render(players, section) {
        let current = 0;

        section.innerHTML = `
            <div class="elite-header">
                <p class="eyebrow">[ ELITE PLAYERS ]</p>
                <h2 class="elite-title">ATHLETES WE'VE<br>WORKED WITH</h2>
            </div>
            <div class="elite-slideshow-wrap">
                <div class="elite-track" id="elite-track">
                    ${players.map(p => `
                        <div class="elite-slide">
                            <div class="elite-slide-photo">
                                ${p.image_data
                                    ? `<img src="${p.image_data}" alt="${esc(p.name)}" class="elite-img" loading="lazy">`
                                    : `<div class="elite-img-placeholder"></div>`}
                            </div>
                            <div class="elite-slide-info">
                                ${p.sport ? `<p class="elite-sport">[ ${esc(p.sport)} ]</p>` : ''}
                                <h3 class="elite-name">${esc(p.name)}</h3>
                                ${p.achievement ? `<p class="elite-achievement">${esc(p.achievement)}</p>` : ''}
                                ${p.description ? `<p class="elite-desc">"${esc(p.description)}"</p>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
                ${players.length > 1 ? `
                <div class="elite-dots" id="elite-dots">
                    ${players.map((_, i) => `<button class="elite-dot ${i === 0 ? 'is-active' : ''}" data-index="${i}" aria-label="Player ${i+1}"></button>`).join('')}
                </div>` : ''}
            </div>
        `;

        if (players.length <= 1) return;

        const track = document.getElementById('elite-track');
        const dots  = document.querySelectorAll('.elite-dot');

        function goTo(idx) {
            current = (idx + players.length) % players.length;
            track.style.transform = `translateX(${-100 * current}%)`;
            dots.forEach((d, i) => d.classList.toggle('is-active', i === current));
        }

        dots.forEach(dot => {
            dot.addEventListener('click', () => {
                clearInterval(timer);
                goTo(parseInt(dot.dataset.index));
                timer = setInterval(() => goTo(current + 1), INTERVAL);
            });
        });

        let timer = setInterval(() => goTo(current + 1), INTERVAL);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();