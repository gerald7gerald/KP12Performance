document.addEventListener("DOMContentLoaded", () => {
    const nameEl = document.getElementById("account-username");
    const emailEl = document.getElementById("account-email");
    const logoutBtn = document.getElementById("logout-btn");

    // Ask the server who's logged in — the cookie is httpOnly, so this
    // is the only way the frontend can know
    fetch('/api/auth/me')
        .then(res => {
            if (!res.ok) {
                // Not logged in — send them to log in instead
                window.location.href = "login.html";
                return null;
            }
            return res.json();
        })
        .then(data => {
            if (!data) return;

            const user = data.user;
            if (nameEl) {
                nameEl.textContent = `Welcome back, ${user.username || "Athlete"}.`;
            }
            if (emailEl && user.email) {
                emailEl.textContent = user.email;
            }
        })
        .catch(err => {
            console.error("Failed to load account info:", err);
            window.location.href = "login.html";
        });

    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            // The login cookie is httpOnly, so it can only be cleared by
            // the server — calling /api/auth/logout, not localStorage
            fetch('/api/auth/logout', { method: 'POST' })
                .then(() => {
                    window.location.href = "index.html";
                })
                .catch(err => {
                    console.error("Logout failed:", err);
                    // Still send them home even if the request failed,
                    // so they're not stuck on the account page
                    window.location.href = "index.html";
                });
        });
    }
});