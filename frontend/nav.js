// ---- Auth nav link: "Sign Up" (logged out) vs "My Account" (logged in) ----
// ---- + Employee link: only injected for admin accounts ----

document.addEventListener("DOMContentLoaded", () => {
    const authLink = document.getElementById("auth-nav-link");
    const navLinks = document.querySelector(".nav-links");
    if (!authLink || !navLinks) return;

    // Ask the server who's logged in — this is the authoritative check
    fetch('/api/auth/me')
        .then(res => res.ok ? res.json() : null)
        .then(data => {
            if (data && data.user) {
                // Logged in
                authLink.textContent = "My Account";
                authLink.setAttribute("href", "acc.html");

                // If admin, inject the Employee link into the nav
                if (data.user.is_admin) {
                    const existing = document.getElementById("employee-nav-link");
                    if (!existing) {
                        const li = document.createElement("li");
                        const a = document.createElement("a");
                        a.id = "employee-nav-link";
                        a.href = "employee.html";
                        a.textContent = "Employee";
                        li.appendChild(a);
                        // Insert before the last item (Shop)
                        const items = navLinks.querySelectorAll("li");
                        const lastItem = items[items.length - 1];
                        navLinks.insertBefore(li, lastItem);
                    }
                }
            } else {
                // Logged out
                authLink.textContent = "Sign Up";
                authLink.setAttribute("href", "signup.html");
            }
        })
        .catch(() => {
            // Server unreachable — fall back to logged-out state
            authLink.textContent = "Sign Up";
            authLink.setAttribute("href", "signup.html");
        });
});

// ---- Fixed nav: blur background on scroll ----
document.addEventListener("DOMContentLoaded", () => {
    const nav = document.querySelector(".nav");
    if (!nav) return;

    const SCROLL_THRESHOLD = 24;

    const updateNavBackground = () => {
        if (window.scrollY > SCROLL_THRESHOLD) {
            nav.classList.add("nav-scrolled");
        } else {
            nav.classList.remove("nav-scrolled");
        }
    };

    updateNavBackground();
    window.addEventListener("scroll", updateNavBackground, { passive: true });
});

// ---- HELP modal — injected into every page via nav.js ----
document.addEventListener('DOMContentLoaded', () => {
    const navLinks = document.querySelector('.nav-links');
    if (!navLinks) return;

    // Inject HELP link into nav before Shop
    const existingHelp = document.getElementById('help-nav-link');
    if (!existingHelp) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.id = 'help-nav-link';
        a.href = '#';
        a.textContent = 'Help';
        a.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('help-modal-overlay').style.display = 'flex';
            document.body.style.overflow = 'hidden';
        });
        li.appendChild(a);
        // Insert before the last item (Shop)
        const items = navLinks.querySelectorAll('li');
        const lastItem = items[items.length - 1];
        navLinks.insertBefore(li, lastItem);
    }

    // Build modal if it doesn't exist yet
    if (document.getElementById('help-modal-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'help-modal-overlay';
    overlay.style.cssText = `
        display:none;position:fixed;inset:0;z-index:9999;
        background:rgba(13,14,16,0.85);backdrop-filter:blur(6px);
        align-items:center;justify-content:center;padding:24px;
    `;

    overlay.innerHTML = `
        <div style="background:#15171A;border:1px solid #232529;max-width:560px;width:100%;position:relative;box-shadow:0 24px 64px rgba(0,0,0,0.5);">

            <!-- Header -->
            <div style="padding:28px 32px 20px;border-bottom:1px solid #232529;display:flex;align-items:center;justify-content:space-between;">
                <div>
                    <p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.16em;color:#3D9EFF;margin:0 0 6px;">[ SUPPORT ]</p>
                    <h2 style="font-family:'Anton',sans-serif;font-size:26px;text-transform:uppercase;margin:0;color:#F5F4F0;">How Can We Help?</h2>
                </div>
                <button id="help-modal-close" style="background:transparent;border:1px solid #2A2D31;color:#8C8F96;width:36px;height:36px;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:border-color 0.2s,color 0.2s;" onmouseover="this.style.borderColor='#F5F4F0';this.style.color='#F5F4F0'" onmouseout="this.style.borderColor='#2A2D31';this.style.color='#8C8F96'">✕</button>
            </div>

            <!-- Body -->
            <div style="padding:28px 32px;display:flex;flex-direction:column;gap:20px;">

                <!-- Section 1 -->
                <div style="background:#0D0E10;border:1px solid #232529;border-left:3px solid #3D9EFF;padding:22px 24px;">
                    <p style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.14em;color:#3D9EFF;margin:0 0 10px;">BOOKING & GENERAL</p>
                    <p style="font-family:'Anton',sans-serif;font-size:18px;text-transform:uppercase;margin:0 0 10px;color:#F5F4F0;">Booking Issues, Questions & More</p>
                    <p style="font-size:14px;color:#8C8F96;line-height:1.65;margin:0 0 14px;">
                        Having trouble booking a session, looking for information about our programs, or have any other question?
                        We're here to help.
                    </p>
                    <a href="mailto:support@kp12performance.com?subject=Help%20Request%20-%20Booking%20%26%20General"
                       style="font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#3D9EFF;text-decoration:none;display:inline-flex;align-items:center;gap:6px;border-bottom:1px solid rgba(61,158,255,0.4);padding-bottom:3px;">
                        support@kp12performance.com →
                    </a>
                </div>

                <!-- Section 2 -->
                <div style="background:#0D0E10;border:1px solid #232529;border-left:3px solid #FF5630;padding:22px 24px;">
                    <p style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.14em;color:#FF5630;margin:0 0 10px;">TECHNICAL</p>
                    <p style="font-family:'Anton',sans-serif;font-size:18px;text-transform:uppercase;margin:0 0 10px;color:#F5F4F0;">Website Issues</p>
                    <p style="font-size:14px;color:#8C8F96;line-height:1.65;margin:0 0 14px;">
                        Found a bug, something not loading correctly, or running into an error on the site?
                        Let us know and we'll get it fixed as soon as possible.
                    </p>
                    <a href="mailto:support@kp12performance.com?subject=Website%20Issue%20Report"
                       style="font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#FF5630;text-decoration:none;display:inline-flex;align-items:center;gap:6px;border-bottom:1px solid rgba(255,86,48,0.4);padding-bottom:3px;">
                        support@kp12performance.com →
                    </a>
                </div>

                <p style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#8C8F96;letter-spacing:0.06em;margin:0;text-align:center;opacity:0.7;">
                    We typically respond within 24 hours.
                </p>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Close handlers
    document.getElementById('help-modal-close').addEventListener('click', closeHelp);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeHelp(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeHelp(); });

    function closeHelp() {
        overlay.style.display = 'none';
        document.body.style.overflow = '';
    }
});