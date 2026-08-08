// ============================================================
// STRIPE + CREDIT BOOKING FLOW — KP12 Performance
// ============================================================

// ---- CHECK CREDIT BALANCE ----
async function loadCreditBalance() {
    try {
        const res  = await fetch('/api/credits', { credentials: 'include' });
        if (!res.ok) return 0;
        const data = await res.json();
        return data.credits || 0;
    } catch {
        return 0;
    }
}

// ---- RENDER PAYMENT OR CREDIT BUTTONS ----
// Call this when the user has selected a package and slots and hits "Confirm"
async function renderPaymentOptions(serviceKey, serviceTitle, packageLabel, slots, selectedAthletes, selectedPkg) {
    const credits   = await loadCreditBalance();
    const container = document.getElementById('payment-options-wrap');
    if (!container) return;

    const priceStr    = selectedPkg?.price || '$50';
    // Use pre-calculated amountCents if provided (multi-athlete total already included)
    const amountCents = selectedPkg?.amountCents
                        || (selectedPkg ? parseInt((selectedPkg.price || '$0').replace(/[^0-9]/g, ''), 10) * 100 : 5000);
    const packageName = selectedPkg ? `${serviceTitle} - ${selectedPkg.label}` : serviceTitle;

    if (credits > 0) {
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
                OR PAY ${priceStr} FOR THIS PACKAGE
            </button>
        `;

        document.getElementById('book-with-credit-btn').addEventListener('click', () =>
            bookWithCredit(serviceKey, serviceTitle, packageLabel, slots, selectedAthletes)
        );
        // Pass ALL booking data so the backend can save it
        document.getElementById('pay-new-btn').addEventListener('click', () =>
            startStripeCheckout(serviceKey, serviceTitle, packageLabel, slots, selectedAthletes, amountCents, packageName)
        );

    } else {
        container.innerHTML = `
            <p style="font-family:'JetBrains Mono',monospace;font-size:12px;
                      color:var(--text-muted);margin:0 0 14px;">
                No session credits available. Pay to book.
            </p>
            <button id="pay-stripe-btn"
                style="width:100%;background:#FF5630;color:#0D0E10;border:none;
                       padding:16px;font-family:'JetBrains Mono',monospace;font-size:13px;
                       letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;">
                PAY ${priceStr} — BOOK PACKAGE
            </button>
        `;
        document.getElementById('pay-stripe-btn').addEventListener('click', () =>
            startStripeCheckout(serviceKey, serviceTitle, packageLabel, slots, selectedAthletes, amountCents, packageName)
        );
    }
}

// ---- BOOK USING AN EXISTING CREDIT (no Stripe needed) ----
async function bookWithCredit(serviceKey, serviceTitle, packageLabel, slots, selectedAthletes) {
    const btn = document.getElementById('book-with-credit-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Booking...'; }

    try {
        const res  = await fetch('/api/bookings/use-credit', {
            method:      'POST',
            headers:     { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ serviceKey, serviceTitle, packageLabel, slots, selectedAthletes })
        });
        const data = await res.json();

        if (!res.ok) {
            if (res.status === 402) {
                // Credit ran out — fall back to Stripe
                alert('Your credit was already used. Redirecting to payment...');
                startStripeCheckout(serviceKey, serviceTitle, packageLabel, slots, selectedAthletes);
            } else {
                alert(data.error || 'Booking failed. Please try again.');
                if (btn) { btn.disabled = false; btn.textContent = '✓ USE 1 CREDIT — BOOK FREE'; }
            }
            return;
        }

        showBookingSuccess(data.bookingId, serviceTitle, slots, data.creditsRemaining);

    } catch (err) {
        console.error(err);
        alert('Could not connect. Please try again.');
        if (btn) { btn.disabled = false; btn.textContent = '✓ USE 1 CREDIT — BOOK FREE'; }
    }
}

// ---- START STRIPE CHECKOUT ----
// Sends ALL booking data to the backend so it's saved in the DB.
// No longer sends userId/email — server reads those from the session cookie.
async function startStripeCheckout(serviceKey, serviceTitle, packageLabel, slots, selectedAthletes, amountCents = 5000, packageName = null) {
    const btn = document.getElementById('pay-stripe-btn') || document.getElementById('pay-new-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Redirecting to payment...'; }

    try {
        const res = await fetch('/api/stripe/create-checkout', {
            method:      'POST',
            headers:     { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                serviceKey,
                serviceTitle:  packageName || serviceTitle,
                packageLabel,
                slots,
                selectedAthletes: selectedAthletes || [],
                amountCents,
            })
        });

        const data = await res.json();

        if (res.status === 401) {
            alert('Please sign in to continue.');
            window.location.href = 'login.html';
            return;
        }

        if (!res.ok || !data.url) {
            alert(data.error || 'Could not start checkout. Please try again.');
            if (btn) { btn.disabled = false; btn.textContent = 'PAY TO BOOK'; }
            return;
        }

        window.location.href = data.url;

    } catch (err) {
        console.error(err);
        alert('Network error. Please try again.');
        if (btn) { btn.disabled = false; }
    }
}

// ---- HANDLE RETURN FROM STRIPE ----
// Uses /api/stripe/complete-booking instead of sessionStorage.
// This endpoint asks Stripe directly if payment succeeded,
// so there's no webhook race condition.
// Safe on refresh — server returns 'already_booked' if booking exists.
(async function checkPaymentReturn() {
    const params  = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const sid     = params.get('sid'); // Stripe checkout session ID from success_url

    if (!payment) return;

    if (payment === 'cancelled') {
        cleanUrl();
        showBanner('Payment cancelled — no charge was made.', '#FF5630');
        return;
    }

    if (payment === 'success') {
        if (!sid) {
            // No session ID — just show the credit banner (shouldn't normally happen)
            cleanUrl();
            showBanner('✓ Payment received! 1 session credit added to your account.', '#2ECC71');
            return;
        }

        showProcessingState();

        // Verify auth before calling complete-booking
        try {
            const authRes = await fetch('/api/auth/me', { credentials: 'include' });
            if (!authRes.ok) {
                // Session expired during checkout — save sid and redirect to login
                try { sessionStorage.setItem('kp12_complete_sid', sid); } catch (e) {}
                window.location.href = `login.html?redirect=${encodeURIComponent(`booking.html?complete_sid=${sid}`)}`;
                return;
            }
        } catch (e) {
            showBanner('Connection error. Please refresh.', '#FF5630');
            return;
        }

        cleanUrl(); // Clean URL before completing so refresh is safe
        await completeStripeBooking(sid);
    }

    // Handle returning after login with a pending booking
    const completeSid = params.get('complete_sid');
    if (completeSid) {
        showProcessingState();
        const authRes = await fetch('/api/auth/me', { credentials: 'include' });
        if (authRes.ok) {
            cleanUrl();
            await completeStripeBooking(completeSid);
        } else {
            showBanner('Please sign in to complete your booking.', '#FFC247');
        }
    }
})();

// ---- COMPLETE BOOKING AFTER STRIPE RETURN ----
async function completeStripeBooking(stripeSessionId) {
    try {
        const res  = await fetch('/api/stripe/complete-booking', {
            method:      'POST',
            headers:     { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ stripeSessionId })
        });
        const data = await res.json();

        if (!res.ok) {
            switch (data.error) {
                case 'not_authenticated':
                    showBanner('Session expired. Please sign in again.', '#FF5630');
                    setTimeout(() => window.location.href = 'login.html', 2000);
                    return;

                case 'payment_not_complete':
                    // Webhook hasn't fired yet — retry once after 2s
                    console.log('Payment not yet confirmed by Stripe, retrying...');
                    setTimeout(() => completeStripeBooking(stripeSessionId), 2000);
                    return;

                default:
                    showBanner(
                        data.error || 'Booking failed. Your payment was received — contact support@kp12performance.com',
                        '#FF5630'
                    );
                    return;
            }
        }

        if (data.status === 'already_booked') {
            showBanner('✓ You\'re already booked! Redirecting to your schedule...', '#2ECC71');
            setTimeout(() => window.location.href = 'my-schedule.html', 2500);
            return;
        }

        if (data.status === 'booked') {
            // Clear any leftover sessionStorage
            try { sessionStorage.removeItem('kp12_pending_booking'); } catch (e) {}
            showBookingSuccess(data.bookingId, data.serviceKey, data.slots, data.creditsRemaining);
        }

    } catch (err) {
        console.error('completeStripeBooking error:', err);
        showBanner('Network error. Please refresh the page.', '#FF5630');
    }
}

// ---- SHOW BOOKING SUCCESS STATE ----
function showBookingSuccess(bookingId, serviceTitle, slots, creditsRemaining) {
    // Try to find the booking page container, fall back to a banner
    const container = document.getElementById('booking-page-content')
                   || document.getElementById('booking-page')
                   || document.querySelector('.booking-page');

    if (!container) {
        showBanner('✓ Booking confirmed! Check your email.', '#2ECC71');
        return;
    }

    const slotLines = (slots || []).map(s =>
        `<div style="display:flex;justify-content:space-between;align-items:center;
                     padding:10px 0;border-bottom:1px solid #232529;">
           <span style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#3D9EFF;">${s.day}</span>
           <span style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#8C8F96;">${s.start} – ${s.end}</span>
         </div>`
    ).join('');

    container.innerHTML = `
        <div style="max-width:520px;margin:80px auto;padding:0 20px;text-align:center;">
            <p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.16em;
                      color:var(--athletics,#3D9EFF);margin:0 0 14px;">[ BOOKING CONFIRMED ]</p>
            <h1 style="font-family:'Anton',sans-serif;font-size:clamp(32px,5vw,48px);
                       text-transform:uppercase;margin:0 0 12px;">You're Booked! 💪</h1>
            <p style="color:var(--text-muted,#8C8F96);font-size:15px;margin:0 0 32px;">
                Check your email for confirmation. See you at the session!
            </p>
            <div style="background:var(--bg-panel,#15171A);border:1px solid #232529;
                        border-top:3px solid var(--athletics,#3D9EFF);padding:24px;
                        text-align:left;margin-bottom:20px;">
                <p style="font-family:'JetBrains Mono',monospace;font-size:10px;
                          color:var(--athletics,#3D9EFF);margin:0 0 10px;">YOUR SESSION</p>
                <p style="font-size:16px;font-weight:600;margin:0 0 14px;">${serviceTitle || 'Training Session'}</p>
                ${slotLines}
                ${creditsRemaining !== undefined
                    ? `<p style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#8C8F96;
                                 margin:14px 0 0;padding-top:12px;border-top:1px solid #232529;">
                           Credits remaining: <strong style="color:var(--athletics,#3D9EFF);">${creditsRemaining}</strong>
                       </p>` : ''}
            </div>
            <a href="my-schedule.html"
               style="display:inline-block;font-family:'JetBrains Mono',monospace;
                      font-size:12px;letter-spacing:0.1em;text-transform:uppercase;
                      color:var(--athletics,#3D9EFF);border-bottom:1px solid var(--athletics,#3D9EFF);
                      padding-bottom:3px;text-decoration:none;">
                View My Schedule →
            </a>
        </div>
    `;
}

// ---- SHOW PROCESSING STATE ----
function showProcessingState() {
    const container = document.getElementById('booking-page-content')
                   || document.getElementById('booking-page')
                   || document.querySelector('.booking-page');
    if (!container) return;
    container.innerHTML = `
        <div style="max-width:400px;margin:120px auto;text-align:center;padding:0 20px;">
            <p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.16em;
                      color:#2ECC71;margin:0 0 16px;">[ PAYMENT RECEIVED ]</p>
            <h2 style="font-family:'Anton',sans-serif;font-size:28px;
                       text-transform:uppercase;margin:0 0 14px;">Locking in your session...</h2>
            <p style="color:#8C8F96;font-size:14px;margin:0;">Please wait — this takes just a second.</p>
        </div>
    `;
}

// ---- HELPERS ----
function showBanner(text, bgColor = '#2ECC71') {
    const existing = document.getElementById('kp12-payment-banner');
    if (existing) existing.remove();
    const banner = document.createElement('div');
    banner.id = 'kp12-payment-banner';
    banner.style.cssText = `
        position:fixed;top:80px;left:50%;transform:translateX(-50%);
        background:${bgColor};color:#0D0E10;padding:14px 28px;
        font-family:'JetBrains Mono',monospace;font-size:13px;letter-spacing:0.08em;
        z-index:9999;border-radius:2px;box-shadow:0 8px 24px rgba(0,0,0,0.3);
        max-width:90vw;text-align:center;
    `;
    banner.textContent = text;
    document.body.appendChild(banner);
    setTimeout(() => banner?.remove(), 7000);
}

function cleanUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete('payment');
    url.searchParams.delete('sid');
    url.searchParams.delete('complete_sid');
    window.history.replaceState({}, '', url.toString());
}