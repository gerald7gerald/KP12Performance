// ============================================================
// STRIPE + CREDIT BOOKING FLOW — KP12 Performance
// Add this to booking.html (or a shared script)
// ============================================================

// ---- CHECK CREDIT BALANCE + SHOW CORRECT BUTTON ----
async function loadCreditBalance() {
    try {
        const res  = await fetch('/api/credits');
        const data = await res.json();
        return data.credits || 0;
    } catch {
        return 0;
    }
}

// Call this when the booking confirm step is shown
async function renderPaymentOptions(serviceKey, serviceTitle, packageLabel, slots, selectedAthletes) {
    const credits = await loadCreditBalance();
    const container = document.getElementById('payment-options-wrap');
    if (!container) return;

    if (credits > 0) {
        // Has credits — show credit button AND pay option
        container.innerHTML = `
            <div style="background:rgba(61,158,255,0.07);border:1px solid rgba(61,158,255,0.3);
                        padding:16px 20px;margin-bottom:16px;border-radius:2px;">
                <p style="font-family:'JetBrains Mono',monospace;font-size:11px;
                          letter-spacing:0.1em;color:var(--athletics);margin:0 0 6px;">
                    ✓ YOU HAVE ${credits} SESSION CREDIT${credits !== 1 ? 'S' : ''}
                </p>
                <p style="font-size:13px;color:var(--text-muted);margin:0;">
                    Use a credit to book this session for free.
                </p>
            </div>

            <button id="book-with-credit-btn"
                style="width:100%;background:var(--athletics);color:#0D0E10;border:none;
                       padding:16px;font-family:'JetBrains Mono',monospace;font-size:13px;
                       letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;
                       margin-bottom:12px;transition:filter 0.2s;">
                ✓ USE 1 CREDIT — BOOK FREE
            </button>

            <button id="pay-new-btn"
                style="width:100%;background:transparent;color:var(--text-muted);border:1px solid #2A2D31;
                       padding:14px;font-family:'JetBrains Mono',monospace;font-size:12px;
                       letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;">
                OR PAY $50 FOR A NEW SESSION
            </button>
        `;

        document.getElementById('book-with-credit-btn').addEventListener('click', () =>
            bookWithCredit(serviceKey, serviceTitle, packageLabel, slots, selectedAthletes)
        );
        document.getElementById('pay-new-btn').addEventListener('click', () =>
            startStripeCheckout()
        );

    } else {
        // No credits — show pay button only
        container.innerHTML = `
            <p style="font-family:'JetBrains Mono',monospace;font-size:12px;
                      color:var(--text-muted);margin:0 0 14px;">
                No session credits available. Pay to book.
            </p>
            <button id="pay-stripe-btn"
                style="width:100%;background:#FF5630;color:#0D0E10;border:none;
                       padding:16px;font-family:'JetBrains Mono',monospace;font-size:13px;
                       letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;">
                PAY $50 — BOOK SESSION
            </button>
        `;
        document.getElementById('pay-stripe-btn').addEventListener('click', startStripeCheckout);
    }
}


// ---- BOOK USING A CREDIT ----
async function bookWithCredit(serviceKey, serviceTitle, packageLabel, slots, selectedAthletes) {
    const btn = document.getElementById('book-with-credit-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Booking...'; }

    try {
        const res  = await fetch('/api/bookings/use-credit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serviceKey, serviceTitle, packageLabel, slots, selectedAthletes })
        });
        const data = await res.json();

        if (!res.ok) {
            if (res.status === 402) {
                // No credits — fall back to Stripe
                alert('Your credit was already used. Redirecting to payment...');
                startStripeCheckout();
            } else {
                alert(data.error || 'Booking failed. Please try again.');
                if (btn) { btn.disabled = false; btn.textContent = '✓ USE 1 CREDIT — BOOK FREE'; }
            }
            return;
        }

        // Success — show confirmation
        showBookingSuccess(data.bookingId, serviceTitle, slots, data.creditsRemaining);

    } catch (err) {
        console.error(err);
        alert('Could not connect. Please try again.');
        if (btn) { btn.disabled = false; btn.textContent = '✓ USE 1 CREDIT — BOOK FREE'; }
    }
}


// ---- START STRIPE CHECKOUT ----
async function startStripeCheckout() {
    const btn = document.getElementById('pay-stripe-btn') || document.getElementById('pay-new-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Redirecting to payment...'; }

    try {
        // Fetch logged-in user profile info first
        const meRes = await fetch('/api/auth/me', { credentials: 'include' });
        const meData = meRes.ok ? await meRes.json() : {};
        const user = meData.user || {};

        const res = await fetch('/api/stripe/create-checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include', // Ensure session cookies are sent
            body: JSON.stringify({
                userId: user.id || null,
                email: user.email || null
            })
        });

        const data = await res.json();

        if (!res.ok || !data.url) {
            alert(data.error || 'Could not start checkout. Please try again.');
            if (btn) { btn.disabled = false; btn.textContent = 'PAY $50 — BOOK SESSION'; }
            return;
        }

        window.location.href = data.url;
    } catch (err) {
        console.error(err);
        alert('Network error. Please try again.');
        if (btn) { btn.disabled = false; btn.textContent = 'PAY $50 — BOOK SESSION'; }
    }
}


// ---- SHOW BOOKING SUCCESS STATE ----
function showBookingSuccess(bookingId, serviceTitle, slots, creditsRemaining) {
    const wrap = document.getElementById('booking-success-wrap') || document.body;
    const slotLines = slots.map(s =>
        `<p style="font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--text-muted);margin:4px 0;">
            ${s.day} · ${s.start} – ${s.end}
         </p>`
    ).join('');

    wrap.innerHTML = `
        <div style="text-align:center;padding:60px 20px;">
            <p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.16em;
                      color:var(--athletics);margin:0 0 16px;">[ BOOKING CONFIRMED ]</p>
            <h1 style="font-family:'Anton',sans-serif;font-size:clamp(32px,5vw,48px);
                       text-transform:uppercase;margin:0 0 12px;">You're Booked! 💪</h1>
            <p style="color:var(--text-muted);font-size:15px;margin:0 0 32px;">
                1 session credit was used. Check your email for confirmation.
            </p>
            <div style="background:var(--bg-panel);border:1px solid #232529;
                        border-top:3px solid var(--athletics);padding:24px;
                        max-width:420px;margin:0 auto 24px;text-align:left;">
                <p style="font-family:'JetBrains Mono',monospace;font-size:11px;
                          color:var(--athletics);margin:0 0 10px;">YOUR SESSION</p>
                <p style="font-size:16px;font-weight:600;margin:0 0 12px;">${serviceTitle}</p>
                ${slotLines}
                ${creditsRemaining !== undefined ?
                    `<p style="font-family:'JetBrains Mono',monospace;font-size:11px;
                              color:var(--text-muted);margin:14px 0 0;border-top:1px solid #232529;padding-top:12px;">
                        Credits remaining: <strong style="color:var(--athletics);">${creditsRemaining}</strong>
                     </p>` : ''}
            </div>
            <a href="my-schedule.html"
               style="display:inline-block;font-family:'JetBrains Mono',monospace;
                      font-size:12px;letter-spacing:0.1em;text-transform:uppercase;
                      color:var(--athletics);border-bottom:1px solid var(--athletics);
                      padding-bottom:3px;">
                View My Schedule →
            </a>
        </div>
    `;
}


// ---- HANDLE RETURN FROM STRIPE (on page load) ----
(function checkPaymentReturn() {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    if (!payment) return;

    if (payment === 'success') {
        // Show success banner
        const banner = document.createElement('div');
        banner.style.cssText = `
            position:fixed;top:80px;left:50%;transform:translateX(-50%);
            background:#2ECC71;color:#0D0E10;padding:14px 28px;
            font-family:'JetBrains Mono',monospace;font-size:13px;
            letter-spacing:0.08em;z-index:999;border-radius:2px;
            box-shadow:0 8px 24px rgba(0,0,0,0.3);
        `;
        banner.textContent = '✓ Payment received! 1 session credit added to your account.';
        document.body.appendChild(banner);
        setTimeout(() => banner.remove(), 6000);

        // Clean up URL
        window.history.replaceState({}, '', window.location.pathname);
    } else if (payment === 'cancelled') {
        const banner = document.createElement('div');
        banner.style.cssText = `
            position:fixed;top:80px;left:50%;transform:translateX(-50%);
            background:#FF5630;color:#0D0E10;padding:14px 28px;
            font-family:'JetBrains Mono',monospace;font-size:13px;
            letter-spacing:0.08em;z-index:999;border-radius:2px;
        `;
        banner.textContent = 'Payment cancelled — no charge was made.';
        document.body.appendChild(banner);
        setTimeout(() => banner.remove(), 5000);
        window.history.replaceState({}, '', window.location.pathname);
    }
})();


// ---- HANDLE ATTENDANCE CONFIRMATION RETURN ----
(function checkAttendanceReturn() {
    const params = new URLSearchParams(window.location.search);
    const attendance = params.get('attendance');
    if (!attendance) return;

    const messages = {
        confirmed:         { text: '✓ Attendance confirmed! See you out there.', color: '#2ECC71' },
        already_confirmed: { text: 'You already confirmed attendance for this session.', color: '#FFC247' },
        expired:           { text: 'This check-in link has expired.', color: '#FF5630' },
        invalid:           { text: 'Invalid check-in link.', color: '#FF5630' },
        error:             { text: 'Something went wrong. Please contact us.', color: '#FF5630' },
    };

    const msg = messages[attendance];
    if (!msg) return;

    const banner = document.createElement('div');
    banner.style.cssText = `
        position:fixed;top:80px;left:50%;transform:translateX(-50%);
        background:${msg.color};color:#0D0E10;padding:14px 28px;
        font-family:'JetBrains Mono',monospace;font-size:13px;
        letter-spacing:0.08em;z-index:999;border-radius:2px;
        box-shadow:0 8px 24px rgba(0,0,0,0.3);max-width:90vw;text-align:center;
    `;
    banner.textContent = msg.text;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 7000);
    window.history.replaceState({}, '', window.location.pathname);
})();