document.addEventListener("DOMContentLoaded", async () => {
    const container = document.getElementById("index-reviews-container");
    if (!container) return;

    let currentSlide = 0;
    let totalSlides  = 0;
    let slideInterval;

    try {
        const response = await fetch('/api/reviews');
        const reviews  = await response.json();

        if (!reviews || reviews.length === 0) {
            container.innerHTML = `
                <div class="review-card-slide">
                    <div class="stars">★★★★★</div>
                    <p class="review-text">"Be the first athlete to leave a review and share your experience."</p>
                    <p class="review-author">— Your Name Here</p>
                </div>`;
            return;
        }

        // Force the window and all parents to clip properly on mobile
        const win = container.parentElement;
        if (win) {
            win.style.cssText = 'overflow:hidden;width:100%;max-width:100%;box-sizing:border-box;display:block;';
            // Also constrain the grandparent section
            if (win.parentElement) {
                win.parentElement.style.overflowX = 'hidden';
                win.parentElement.style.maxWidth  = '100vw';
            }
        }
        // Ensure container is a proper flex row — no overflow
        container.style.cssText = 'display:flex;flex-direction:row;transition:transform 0.55s cubic-bezier(0.4,0,0.2,1);width:100%;max-width:100%;';

        container.innerHTML = reviews.map(r => {
            const stars      = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);
            const safeComment= escapeHtml(r.comment);
            const safeUser   = escapeHtml(r.username || "Athlete");
            const safeType   = escapeHtml(r.training_type);

            // Profile picture avatar — falls back to a colored initial circle
            const initial = safeUser.charAt(0).toUpperCase();
            const avatarBlock = r.profile_image
                ? `<img src="${r.profile_image}" alt="${safeUser}" loading="lazy"
                        style="width:72px;height:72px;border-radius:50%;object-fit:cover;
                               object-position:center top;display:block;margin:0 auto 16px;
                               border:2px solid var(--athletics,#3D9EFF);">`
                : `<div style="width:72px;height:72px;border-radius:50%;background:rgba(61,158,255,0.15);
                               border:2px solid var(--athletics,#3D9EFF);display:flex;align-items:center;
                               justify-content:center;margin:0 auto 16px;
                               font-family:'Anton',sans-serif;font-size:28px;color:var(--athletics,#3D9EFF);">
                       ${initial}
                   </div>`;

            return `
                <div style="min-width:100%;flex-shrink:0;box-sizing:border-box;
                            padding:clamp(20px,5vw,36px) clamp(16px,5vw,40px);text-align:center;
                            background:var(--bg-panel,#15171A);border:1px solid #232529;
                            overflow:hidden;max-width:100vw;">
                    ${avatarBlock}
                    <div style="color:var(--athletics,#3D9EFF);font-size:18px;letter-spacing:3px;margin-bottom:14px;">${stars}</div>
                    <p style="font-family:'Work Sans',sans-serif;font-style:italic;font-size:15px;
                              line-height:1.7;color:#F5F4F0;margin:0 0 18px;">"${safeComment}"</p>
                    <p style="font-family:'JetBrains Mono',monospace;font-size:11px;
                              letter-spacing:0.06em;color:#8C8F96;margin:0;word-break:break-word;">
                        — ${safeUser} <span style="opacity:0.6;">[ ${safeType} ]</span>
                    </p>
                </div>
            `;
        }).join('');

        totalSlides = reviews.length;

        function showSlide(index) {
            if (index >= totalSlides) currentSlide = 0;
            else if (index < 0)       currentSlide = totalSlides - 1;
            else                       currentSlide = index;
            container.style.transform = `translateX(${-100 * currentSlide}%)`;
        }

        function startAutoSlide() {
            slideInterval = setInterval(() => showSlide(currentSlide + 1), 5000);
        }

        showSlide(0);
        startAutoSlide();

    } catch (err) {
        console.error("Failed to load reviews:", err);
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }
});