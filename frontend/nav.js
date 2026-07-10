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