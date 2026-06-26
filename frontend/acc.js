document.addEventListener("DOMContentLoaded", () => {
    const stored = localStorage.getItem("kp12_user");

    // Not signed in — send them to log in instead
    if (!stored) {
        window.location.href = "login.html";
        return;
    }

    let user;
    try {
        user = JSON.parse(stored);
    } catch (err) {
        localStorage.removeItem("kp12_user");
        window.location.href = "login.html";
        return;
    }

    const nameEl = document.getElementById("account-username");
    const emailEl = document.getElementById("account-email");

    if (nameEl) {
        nameEl.textContent = `Welcome back, ${user.username || "Athlete"}.`;
    }
    if (emailEl && user.email) {
        emailEl.textContent = user.email;
    }

    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            localStorage.removeItem("kp12_user");
            window.location.href = "index.html";
        });
    }
});