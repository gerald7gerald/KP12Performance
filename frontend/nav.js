// Swaps the nav's auth link between "Sign Up" (logged out)
// and "My Account" (logged in) based on what's stored locally.
//
// NOTE: this is a lightweight, client-side-only check — it's not a real
// session. It's just enough to reflect login state in the UI until the
// backend issues real sessions/tokens.

document.addEventListener("DOMContentLoaded", () => {
    const authLink = document.getElementById("auth-nav-link");
    if (!authLink) return;

    const stored = localStorage.getItem("kp12_user");

    if (stored) {
        try {
            JSON.parse(stored); // just confirms it's valid
            authLink.textContent = "My Account";
            authLink.setAttribute("href", "acc.html");
        } catch (err) {
            // Corrupted data — treat as logged out
            localStorage.removeItem("kp12_user");
            authLink.textContent = "Sign Up";
            authLink.setAttribute("href", "signup.html");
        }
    } else {
        authLink.textContent = "Sign Up";
        authLink.setAttribute("href", "signup.html");
    }
});

// ---- Fixed nav: add a background once the page has scrolled,
// so the nav stays legible over whatever content passes underneath it ----
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

    updateNavBackground(); // handle page loads that aren't scrolled to top
    window.addEventListener("scroll", updateNavBackground, { passive: true });
});