// Auto-rotating background slideshow for the homepage hero.
// Crossfades between .hero-slide layers by toggling .is-active.
// If prefers-reduced-motion is on, just show the first slide and stop —
// no motion, no setInterval running in the background.

document.addEventListener("DOMContentLoaded", () => {
    const slides = document.querySelectorAll(".hero-slide");
    if (slides.length < 2) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    let current = 0;
    const INTERVAL_MS = 5000;

    setInterval(() => {
        slides[current].classList.remove("is-active");
        current = (current + 1) % slides.length;
        slides[current].classList.add("is-active");
    }, INTERVAL_MS);
});