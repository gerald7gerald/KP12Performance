(function () {
    const INTERVAL = 6000;

    function init() {
        const section = document.getElementById('elite-players-section');
        if (!section) return;

        fetch('/api/elite-players')
            .then(r => {
                if (!r.ok) throw new Error('API error');
                return r.json();
            })
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

        section.innerHTML = '';
        section.style.cssText = 'padding:60px 6vw;background:var(--bg-panel,#15171A);border-bottom:1px solid #232529;';

        // Header
        const header = document.createElement('div');
        header.style.cssText = 'text-align:center;margin-bottom:32px;';
        header.innerHTML = `
            <p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.18em;color:var(--athletics,#3D9EFF);margin:0 0 10px;">[ ELITE PLAYERS ]</p>
            <h2 style="font-family:'Anton',sans-serif;font-size:clamp(24px,3.5vw,40px);text-transform:uppercase;margin:0;color:#F5F4F0;line-height:1.05;">ATHLETES WE'VE<br>WORKED WITH</h2>
        `;
        section.appendChild(header);

        // Constrained slideshow wrapper
        const outerWrap = document.createElement('div');
        outerWrap.style.cssText = 'max-width:780px;margin:0 auto;';

        // Clipping window — MUST have position:relative + overflow:hidden
        const clipWindow = document.createElement('div');
        clipWindow.style.cssText = 'position:relative;overflow:hidden;width:100%;border:1px solid #232529;border-left:3px solid var(--athletics,#3D9EFF);';

        // Track — flex row
        const track = document.createElement('div');
        track.id = 'elite-track';
        track.style.cssText = 'display:flex;flex-direction:row;width:100%;transition:transform 0.55s cubic-bezier(0.4,0,0.2,1);';

        players.forEach(p => {
            const slide = document.createElement('div');
            // CRITICAL: min-width + flex-shrink:0 locks each slide to exactly 100% of the window
            slide.style.cssText = 'min-width:100%;flex-shrink:0;box-sizing:border-box;display:flex;flex-direction:row;align-items:stretch;background:var(--bg,#0D0E10);';

            // Photo — fixed column, portrait crop
            const photoDiv = document.createElement('div');
            photoDiv.style.cssText = 'flex:0 0 280px;width:280px;height:320px;overflow:hidden;background:#15171A;';

            if (p.image_data) {
                const img = document.createElement('img');
                img.src = p.image_data;
                img.alt = esc(p.name);
                img.style.cssText = 'width:100%;height:100%;object-fit:cover;object-position:center top;display:block;';
                img.loading = 'lazy';
                photoDiv.appendChild(img);
            }

            // Info — right side
            const infoDiv = document.createElement('div');
            infoDiv.style.cssText = 'flex:1;padding:36px 40px;display:flex;flex-direction:column;justify-content:center;gap:12px;min-width:0;';

            infoDiv.innerHTML = `
                ${p.sport ? `<p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.14em;color:var(--athletics,#3D9EFF);margin:0;">${esc(p.sport)}</p>` : ''}
                <h3 style="font-family:'Anton',sans-serif;font-size:clamp(22px,3vw,36px);text-transform:uppercase;line-height:1.05;color:#F5F4F0;margin:0;">${esc(p.name)}</h3>
                ${p.achievement ? `<p style="font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.06em;color:#8C8F96;margin:0;line-height:1.5;">${esc(p.achievement)}</p>` : ''}
                ${p.description ? `<p style="font-size:14px;line-height:1.7;color:#8C8F96;font-style:italic;margin:0;padding-top:12px;border-top:1px solid #232529;">"${esc(p.description)}"</p>` : ''}
            `;

            slide.appendChild(photoDiv);
            slide.appendChild(infoDiv);
            track.appendChild(slide);
        });

        clipWindow.appendChild(track);
        outerWrap.appendChild(clipWindow);

        // Dots
        let dots = [];
        if (players.length > 1) {
            const dotsWrap = document.createElement('div');
            dotsWrap.style.cssText = 'display:flex;justify-content:center;gap:8px;margin-top:16px;';

            players.forEach((_, i) => {
                const dot = document.createElement('button');
                dot.style.cssText = `width:7px;height:7px;border-radius:50%;border:none;padding:0;cursor:pointer;transition:background 0.25s,transform 0.25s;background:${i===0?'var(--athletics,#3D9EFF)':'#2A2D31'};`;
                dot.dataset.index = i;
                dotsWrap.appendChild(dot);
                dots.push(dot);
            });

            outerWrap.appendChild(dotsWrap);
        }

        section.appendChild(outerWrap);

        if (players.length <= 1) return;

        function goTo(idx) {
            current = (idx + players.length) % players.length;
            track.style.transform = `translateX(${-100 * current}%)`;
            dots.forEach((d, i) => {
                d.style.background = i === current ? 'var(--athletics,#3D9EFF)' : '#2A2D31';
                d.style.transform  = i === current ? 'scale(1.3)' : 'scale(1)';
            });
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