(function () {
    const INTERVAL = 6000;

    function isMobile() { return window.innerWidth < 640; }

    function init() {
        const section = document.getElementById('elite-players-section');
        if (!section) return;

        fetch('/api/elite-players')
            .then(r => { if (!r.ok) throw new Error(); return r.json(); })
            .then(players => {
                if (!Array.isArray(players) || !players.length) {
                    section.style.display = 'none'; return;
                }
                render(players, section);
                let lastMobile = isMobile();
                window.addEventListener('resize', () => {
                    const nowMobile = isMobile();
                    if (nowMobile !== lastMobile) {
                        lastMobile = nowMobile;
                        section.innerHTML = '';
                        render(players, section);
                    }
                });
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
        const mobile = isMobile();

        section.style.cssText = mobile
            ? 'padding:32px 5vw;background:var(--bg-panel,#15171A);border-bottom:1px solid #232529;'
            : 'padding:56px 5vw;background:var(--bg-panel,#15171A);border-bottom:1px solid #232529;';

        // Header
        const header = document.createElement('div');
        header.style.cssText = mobile ? 'text-align:center;margin-bottom:18px;' : 'text-align:center;margin-bottom:28px;';
        header.innerHTML = `
            <p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.18em;color:var(--athletics,#3D9EFF);margin:0 0 10px;">[ ELITE PLAYERS ]</p>
            <h2 style="font-family:'Anton',sans-serif;font-size:clamp(22px,4vw,38px);text-transform:uppercase;margin:0;color:#F5F4F0;line-height:1.05;">ATHLETES WE'VE<br>WORKED WITH</h2>
        `;
        section.appendChild(header);

        const outerWrap = document.createElement('div');
        outerWrap.style.cssText = 'max-width:780px;width:100%;margin:0 auto;box-sizing:border-box;overflow:hidden;';

        // Clip window — overflow:hidden is the key. Height is set dynamically per
        // slide below (see slideHeights) so a shorter athlete bio doesn't leave a
        // stretched blank gap, and a longer one never gets clipped off.
        const clipWindow = document.createElement('div');
        clipWindow.style.cssText = 'overflow:hidden;width:100%;max-width:100%;border:1px solid #232529;border-left:3px solid var(--athletics,#3D9EFF);box-sizing:border-box;transition:height 0.35s ease;';

        // Track — width:100% is required here. Without it, translateX(%) resolves
        // against the track's own (ambiguous) content width instead of the visible
        // window's width, causing "next" to not reliably land on exactly one slide.
        const track = document.createElement('div');
        track.style.cssText = 'display:flex;flex-direction:row;align-items:flex-start;width:100%;max-width:100%;transition:transform 0.55s cubic-bezier(0.4,0,0.2,1);';

        players.forEach(p => {
            const slide = document.createElement('div');
            slide.style.cssText = mobile
                ? 'min-width:100%;flex-shrink:0;box-sizing:border-box;display:flex;flex-direction:column;background:var(--bg,#0D0E10);'
                : 'min-width:100%;flex-shrink:0;box-sizing:border-box;display:flex;flex-direction:row;align-items:stretch;background:var(--bg,#0D0E10);';

            // Photo
            const photoDiv = document.createElement('div');
            if (mobile) {
                // object-fit:contain (not cover) — athlete photos vary between portrait
                // and landscape, and a fixed aspect-ratio box with `cover` was cropping
                // tall/portrait photos down to an unrecognizable sliver. `contain` always
                // shows the whole photo, letterboxed on the dark background if needed.
                photoDiv.style.cssText = 'width:100%;height:240px;overflow:hidden;flex-shrink:0;background:#15171A;display:flex;align-items:center;justify-content:center;';
            } else {
                photoDiv.style.cssText = 'flex:0 0 260px;width:260px;height:auto;min-height:200px;overflow:hidden;background:#15171A;flex-shrink:0;';
            }

            if (p.image_data) {
                const img = document.createElement('img');
                img.src = p.image_data;
                img.alt = esc(p.name);
                img.style.cssText = mobile
                    ? 'width:100%;height:100%;object-fit:contain;display:block;'
                    : 'width:100%;height:100%;object-fit:cover;object-position:center 35%;display:block;';
                img.loading = 'lazy';
                photoDiv.appendChild(img);
            }

            // Info — the key is flex:1 + min-width:0 + overflow:hidden to prevent text blowout
            const infoDiv = document.createElement('div');
            infoDiv.style.cssText = mobile
                ? 'padding:16px 18px 20px;box-sizing:border-box;width:100%;'
                : 'flex:1;min-width:0;width:0;overflow:hidden;padding:24px 28px;box-sizing:border-box;display:block;';

            if (p.sport) {
                const sport = document.createElement('p');
                sport.style.cssText = "font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.12em;color:var(--athletics,#3D9EFF);margin:0 0 8px;display:block;";
                sport.textContent = p.sport;
                infoDiv.appendChild(sport);
            }

            const name = document.createElement('h3');
            name.style.cssText = "font-family:'Anton',sans-serif;font-size:clamp(20px,2.5vw,28px);text-transform:uppercase;line-height:1.05;color:#F5F4F0;margin:0 0 8px;display:block;word-break:break-word;";
            name.textContent = p.name || '';
            infoDiv.appendChild(name);

            if (p.achievement) {
                const ach = document.createElement('p');
                ach.style.cssText = "font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.05em;color:#8C8F96;margin:0 0 8px;display:block;line-height:1.55;word-break:break-word;";
                ach.textContent = p.achievement;
                infoDiv.appendChild(ach);
            }

            if (p.description) {
                const desc = document.createElement('p');
                desc.style.cssText = 'font-size:13px;line-height:1.7;color:#8C8F96;font-style:italic;margin:0;padding-top:10px;border-top:1px solid #232529;word-break:break-word;overflow-wrap:break-word;white-space:normal;display:block;width:100%;';
                desc.textContent = '\u201c' + p.description + '\u201d';
                infoDiv.appendChild(desc);
            }

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
            dotsWrap.style.cssText = 'display:flex;justify-content:center;gap:8px;margin-top:14px;';
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

        // Each slide's own natural height (track no longer stretches slides to
        // match the tallest sibling — see align-items:flex-start above — so this
        // reads each slide's real content height for its own athlete's bio).
        const slideEls = Array.from(track.children);
        const slideHeights = slideEls.map(s => s.offsetHeight);
        clipWindow.style.height = slideHeights[0] + 'px';

        function goTo(idx) {
            current = (idx + players.length) % players.length;
            track.style.transform = `translateX(${-100 * current}%)`;
            clipWindow.style.height = slideHeights[current] + 'px';
            dots.forEach((d, i) => {
                d.style.background = i === current ? 'var(--athletics,#3D9EFF)' : '#2A2D31';
                d.style.transform  = i === current ? 'scale(1.3)' : 'scale(1)';
            });
        }

        dots.forEach(dot => dot.addEventListener('click', () => {
            clearInterval(timer);
            goTo(parseInt(dot.dataset.index));
            timer = setInterval(() => goTo(current + 1), INTERVAL);
        }));

        // Swipe support (touch) — previously missing entirely, so swiping did nothing.
        let touchStartX = 0, touchStartY = 0;
        clipWindow.addEventListener('touchstart', e => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }, { passive: true });
        clipWindow.addEventListener('touchend', e => {
            const dx = e.changedTouches[0].clientX - touchStartX;
            const dy = e.changedTouches[0].clientY - touchStartY;
            if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return; // not a horizontal swipe
            clearInterval(timer);
            goTo(current + (dx < 0 ? 1 : -1));
            timer = setInterval(() => goTo(current + 1), INTERVAL);
        }, { passive: true });

        let timer = setInterval(() => goTo(current + 1), INTERVAL);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();