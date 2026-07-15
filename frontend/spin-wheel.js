(function () {
    // Don't show if already seen this session or claimed
    if (sessionStorage.getItem('kp12-wheel-seen')) return;

    const SEGMENTS = [
        { label: 'FREE\nASSESSMENT', color: '#FF5630', textColor: '#0D0E10' },
        { label: '20% OFF',         color: '#3D9EFF', textColor: '#0D0E10' },
        { label: '10% OFF',         color: '#2ECC71', textColor: '#0D0E10' },
        { label: '5% OFF',          color: '#15171A', textColor: '#F5F4F0' },
        { label: '15% OFF',         color: '#FFC247', textColor: '#0D0E10' },
    ];

    const WINNER_IDX   = 0;   // Free Assessment — always wins
    const SEG_ANGLE    = (2 * Math.PI) / SEGMENTS.length;
    const SPIN_ROTATIONS = 6; // how many full spins before landing

    // Target: center of winning segment at the pointer (right side = 0 rad)
    // Segment i starts at i * SEG_ANGLE. Center of winner is at WINNER_IDX * SEG_ANGLE + SEG_ANGLE/2
    const winnerCenter = WINNER_IDX * SEG_ANGLE + SEG_ANGLE / 2;
    const targetRot    = SPIN_ROTATIONS * 2 * Math.PI + (2 * Math.PI - winnerCenter);

    let startTime   = null;
    let spinning    = false;
    let done        = false;
    let currentRot  = 0;
    const DURATION  = 4500; // ms

    // ---- Build modal ----
    const overlay = document.createElement('div');
    overlay.id = 'wheel-overlay';
    overlay.style.cssText = `
        position:fixed;inset:0;z-index:99999;
        background:rgba(13,14,16,0.88);backdrop-filter:blur(6px);
        display:flex;align-items:center;justify-content:center;
        padding:20px;opacity:0;transition:opacity 0.5s ease;
    `;

    overlay.innerHTML = `
        <div id="wheel-modal" style="background:#15171A;border:1px solid #232529;max-width:460px;width:100%;
             position:relative;box-shadow:0 32px 80px rgba(0,0,0,0.6);text-align:center;overflow:hidden;">

            <!-- Close -->
            <button id="wheel-close" style="position:absolute;top:14px;right:14px;background:transparent;
                border:1px solid #2A2D31;color:#8C8F96;width:32px;height:32px;cursor:pointer;
                font-size:16px;display:flex;align-items:center;justify-content:center;z-index:2;">✕</button>

            <!-- Header -->
            <div style="background:#0D0E10;padding:24px 32px 20px;border-bottom:1px solid #232529;">
                <p style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.18em;
                          color:#FF5630;margin:0 0 8px;">[ LIMITED OFFER ]</p>
                <h2 style="font-family:'Anton',sans-serif;font-size:26px;text-transform:uppercase;
                           margin:0;color:#F5F4F0;line-height:1.1;">SPIN TO WIN!</h2>
                <p style="color:#8C8F96;font-size:13px;margin:8px 0 0;">Try your luck — one spin per visit.</p>
            </div>

            <!-- Wheel wrapper -->
            <div style="padding:28px 20px 16px;position:relative;display:flex;
                        flex-direction:column;align-items:center;gap:0;">

                <!-- Pointer arrow pointing LEFT (at the right of wheel) -->
                <div style="position:relative;display:flex;align-items:center;justify-content:center;">
                    <canvas id="wheel-canvas" width="280" height="280"></canvas>
                    <!-- Arrow pointer at right edge -->
                    <div style="position:absolute;right:-12px;top:50%;transform:translateY(-50%);
                                width:0;height:0;
                                border-top:14px solid transparent;
                                border-bottom:14px solid transparent;
                                border-right:22px solid #F5F4F0;
                                filter:drop-shadow(0 0 4px rgba(255,255,255,0.4));"></div>
                </div>

                <p id="wheel-result-msg" style="font-family:'JetBrains Mono',monospace;font-size:12px;
                   letter-spacing:0.08em;color:#8C8F96;margin:16px 0 4px;min-height:18px;"></p>

                <!-- Spin button -->
                <button id="wheel-spin-btn" style="margin-top:8px;background:#FF5630;color:#0D0E10;
                    border:none;padding:14px 36px;font-family:'JetBrains Mono',monospace;font-size:13px;
                    letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;width:100%;
                    transition:filter 0.2s;">SPIN THE WHEEL</button>

                <!-- Claim button (hidden until won) -->
                <button id="wheel-claim-btn" style="display:none;margin-top:10px;background:#2ECC71;
                    color:#0D0E10;border:none;padding:14px 36px;font-family:'JetBrains Mono',monospace;
                    font-size:13px;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;width:100%;">
                    LOGIN TO CLAIM →
                </button>

                <button id="wheel-nothanks" style="background:transparent;border:none;color:#5A5D63;
                    font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.08em;
                    cursor:pointer;margin-top:10px;padding:6px;">No thanks</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // ---- Draw wheel ----
    const canvas = document.getElementById('wheel-canvas');
    const ctx    = canvas.getContext('2d');
    const cx     = canvas.width  / 2;
    const cy     = canvas.height / 2;
    const radius = Math.min(cx, cy) - 4;

    function drawWheel(rotation) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        SEGMENTS.forEach((seg, i) => {
            const startAngle = rotation + i * SEG_ANGLE;
            const endAngle   = startAngle + SEG_ANGLE;

            // Segment fill
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, radius, startAngle, endAngle);
            ctx.closePath();
            ctx.fillStyle = seg.color;
            ctx.fill();
            ctx.strokeStyle = '#232529';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Label
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(startAngle + SEG_ANGLE / 2);
            ctx.textAlign    = 'right';
            ctx.fillStyle    = seg.textColor;
            ctx.font         = 'bold 12px "JetBrains Mono", monospace';
            const lines = seg.label.split('\n');
            if (lines.length === 1) {
                ctx.fillText(lines[0], radius - 12, 4);
            } else {
                ctx.fillText(lines[0], radius - 12, -4);
                ctx.fillText(lines[1], radius - 12, 12);
            }
            ctx.restore();
        });

        // Center circle
        ctx.beginPath();
        ctx.arc(cx, cy, 18, 0, 2 * Math.PI);
        ctx.fillStyle = '#0D0E10';
        ctx.fill();
        ctx.strokeStyle = '#FF5630';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    drawWheel(0);

    // ---- Easing ----
    function easeOut(t) {
        return 1 - Math.pow(1 - t, 4);
    }

    function animate(timestamp) {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const t       = Math.min(elapsed / DURATION, 1);
        currentRot    = easeOut(t) * targetRot;

        drawWheel(currentRot);

        if (t < 1) {
            requestAnimationFrame(animate);
        } else {
            // Landed!
            spinning = false;
            done     = true;
            const msg  = document.getElementById('wheel-result-msg');
            const spin = document.getElementById('wheel-spin-btn');
            const claim = document.getElementById('wheel-claim-btn');

            msg.textContent  = '🎉 You won a FREE Initial Assessment!';
            msg.style.color  = '#FF5630';
            spin.style.display  = 'none';
            claim.style.display = 'block';

            // Store the win
            sessionStorage.setItem('kp12-won-assessment', '1');
        }
    }

    // ---- Spin ----
    document.getElementById('wheel-spin-btn').addEventListener('click', () => {
        if (spinning || done) return;
        spinning  = true;
        startTime = null;
        document.getElementById('wheel-spin-btn').disabled = true;
        document.getElementById('wheel-spin-btn').textContent = 'SPINNING...';
        requestAnimationFrame(animate);
    });

    // ---- Claim ----
    document.getElementById('wheel-claim-btn').addEventListener('click', async () => {
        // Check if logged in
        try {
            const res = await fetch('/api/auth/me');
            if (res.ok) {
                // Logged in — send the email and show success
                const claimRes = await fetch('/api/claim-assessment', { method: 'POST' });
                const btn = document.getElementById('wheel-claim-btn');
                if (claimRes.ok) {
                    btn.textContent    = '✓ EMAIL SENT — CHECK YOUR INBOX!';
                    btn.style.background = '#2ECC71';
                    btn.disabled = true;
                    sessionStorage.setItem('kp12-wheel-seen', '1');
                    setTimeout(closeWheel, 3000);
                } else {
                    btn.textContent = 'ERROR — TRY AGAIN';
                }
            } else {
                // Not logged in — store intent and go to login
                sessionStorage.setItem('kp12-claim-on-login', '1');
                window.location.href = 'login.html?claim=assessment';
            }
        } catch {
            sessionStorage.setItem('kp12-claim-on-login', '1');
            window.location.href = 'login.html?claim=assessment';
        }
    });

    // ---- Close ----
    function closeWheel() {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 500);
        sessionStorage.setItem('kp12-wheel-seen', '1');
    }

    document.getElementById('wheel-close').addEventListener('click', closeWheel);
    document.getElementById('wheel-nothanks').addEventListener('click', closeWheel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeWheel(); });

    // ---- Show after 5 seconds ----
    setTimeout(() => {
        overlay.style.opacity = '1';
    }, 5000);

})();