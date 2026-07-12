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

        // Wrapper — constrained width, centered
        const wrap = document.createElement('div');
        wrap.style.cssText = 'max-width:700px;margin:0 auto;';

        // Header
        const header = document.createElement('div');
        header.style.cssText = 'text-align:center;margin-bottom:28px;';
        header.innerHTML = `
            <p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.18em;color:var(--athletics,#3D9EFF);margin:0 0 10px;">[ ELITE PLAYERS ]</p>
            <h2 style="font-family:'Anton',sans-serif;font-size:clamp(22px,3vw,32px);text-transform:uppercase;margin:0;color:var(--text,#F5F4F0);">ATHLETES WE'VE WORKED WITH</h2>
        `;
        wrap.appendChild(header);

        // Slideshow window — overflow:hidden clips the track
        const window_ = document.createElement('div');
        window_.style.cssText = 'overflow:hidden;width:100%;border:1px solid #232529;';

        // Track — flex row, slides side by side
        const track = document.createElement('div');
        track.id = 'elite-track';
        track.style.cssText = 'display:flex;flex-direction:row;transition:transform 0.6s cubic-bezier(0.4,0,0.2,1);';

        players.forEach(p => {
            const slide = document.createElement('div');
            slide.style.cssText = 'min-width:100%;box-sizing:border-box;display:flex;flex-direction:row;background:var(--bg,#0D0E10);';

            // Photo — fixed small size on left
            const photoDiv = document.createElement('div');
            photoDiv.style.cssText = 'flex:0 0 200px;width:200px;height:200px;overflow:hidden;background:#15171A;flex-shrink:0;';

            if (p.image_data) {
                const img = document.createElement('img');
                img.src = p.image_data;
                img.alt = esc(p.name);
                img.style.cssText = 'width:100%;height:100%;object-fit:cover;object-position:center top;display:block;';
                img.loading = 'lazy';
                photoDiv.appendChild(img);
            } else {
                photoDiv.style.background = '#1a1c1f';
            }

            // Info — right side
            const infoDiv = document.createElement('div');
            infoDiv.style.cssText = 'padding:24px 28px;display:flex;flex-direction:column;justify-content:center;gap:8px;border-left:3px solid var(--athletics,#3D9EFF);flex:1;min-width:0;';

            infoDiv.innerHTML = `
                ${p.sport ? `<p style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.14em;color:var(--athletics,#3D9EFF);margin:0;">${esc(p.sport)}</p>` : ''}
                <h3 style="font-family:'Anton',sans-serif;font-size:clamp(18px,2.5vw,26px);text-transform:uppercase;line-height:1.05;color:var(--text,#F5F4F0);margin:0;">${esc(p.name)}</h3>
                ${p.achievement ? `<p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.06em;color:var(--text-muted,#8C8F96);margin:0;line-height:1.5;">${esc(p.achievement)}</p>` : ''}
                ${p.description ? `<p style="font-size:13px;line-height:1.65;color:var(--text-muted,#8C8F96);font-style:italic;margin:0;padding-top:8px;border-top:1px solid #232529;">"${esc(p.description)}"</p>` : ''}
            `;

            slide.appendChild(photoDiv);
            slide.appendChild(infoDiv);
            track.appendChild(slide);
        });

        window_.appendChild(track);
        wrap.appendChild(window_);

        // Dots (only if more than 1 player)
        let dots = [];
        if (players.length > 1) {
            const dotsWrap = document.createElement('div');
            dotsWrap.style.cssText = 'display:flex;justify-content:center;gap:8px;margin-top:16px;';

            players.forEach((_, i) => {
                const dot = document.createElement('button');
                dot.style.cssText = `width:7px;height:7px;border-radius:50%;border:none;padding:0;cursor:pointer;background:${i === 0 ? 'var(--athletics,#3D9EFF)' : '#2A2D31'};transition:background 0.25s ease,transform 0.25s ease;`;
                dot.setAttribute('aria-label', `Player ${i + 1}`);
                dot.dataset.index = i;
                dotsWrap.appendChild(dot);
                dots.push(dot);
            });

            wrap.appendChild(dotsWrap);
        }

        section.innerHTML = '';
        section.appendChild(wrap);

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