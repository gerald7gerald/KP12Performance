// Fades/slides each .reveal section into place as it scrolls into view.
// Respects prefers-reduced-motion via the global CSS rule in style.css,
// which disables the transition entirely for those users.

document.addEventListener("DOMContentLoaded", () => {
    const revealEls = document.querySelectorAll(".reveal");

    if (!("IntersectionObserver" in window) || revealEls.length === 0) {
        // Fallback: just show everything immediately
        revealEls.forEach((el) => el.classList.add("in-view"));
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add("in-view");
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.15,
        rootMargin: "0px 0px -40px 0px"
    });

    revealEls.forEach((el) => observer.observe(el));
});