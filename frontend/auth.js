// ---- Backend config ----
const API_BASE_URL = "https://kp12performance.onrender.com";

function showError(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.style.display = "block";
}

function clearError(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = "";
    el.style.display = "none";
}

document.addEventListener("DOMContentLoaded", () => {

    // ---- SIGN UP ----
    const signupForm = document.getElementById("signup-form");
    if (signupForm) {
        signupForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            clearError("signup-error");

            const username = document.getElementById("signup-username").value.trim();
            const email = document.getElementById("signup-email").value.trim();
            const password = document.getElementById("signup-password").value;

            const submitBtn = signupForm.querySelector("button[type='submit']");
            submitBtn.disabled = true;

            try {
                const res = await fetch(`${API_BASE_URL}/api/auth/signup`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username, email, password })
                });
                const data = await res.json();

                if (!res.ok) {
                    showError("signup-error", data.error || "Something went wrong. Please try again.");
                    submitBtn.disabled = false;
                    return;
                }

                // Signed up successfully — send them back to the homepage
                window.location.href = "index.html";
            } catch (err) {
                console.error(err);
                showError("signup-error", "Couldn't reach the server. Please try again in a moment.");
                submitBtn.disabled = false;
            }
        });
    }

    // ---- LOG IN ----
    const loginForm = document.getElementById("login-form");
    if (loginForm) {
        loginForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            clearError("login-error");

            const email = document.getElementById("login-email").value.trim();
            const password = document.getElementById("login-password").value;

            const submitBtn = loginForm.querySelector("button[type='submit']");
            submitBtn.disabled = true;

            try {
                const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, password })
                });
                const data = await res.json();

                if (!res.ok) {
                    showError("login-error", data.error || "Invalid email or password.");
                    submitBtn.disabled = false;
                    return;
                }

                // Logged in successfully — send them back to the homepage
                window.location.href = "index.html";
            } catch (err) {
                console.error(err);
                showError("login-error", "Couldn't reach the server. Please try again in a moment.");
                submitBtn.disabled = false;
            }
        });
    }

});