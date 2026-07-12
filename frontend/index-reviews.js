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

        container.innerHTML = reviews.map(r => {
            const stars      = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);
            const safeComment= escapeHtml(r.comment);
            const safeUser   = escapeHtml(r.username || "Athlete");
            const safeType   = escapeHtml(r.training_type);

            // Photo as a small circular avatar thumbnail — never a banner
            const imgBlock = r.image_data
                ? `<img src="${r.image_data}" alt="${safeUser}" loading="lazy"
                        style="width:72px;height:72px;border-radius:50%;object-fit:cover;
                               object-position:center top;display:block;margin:0 auto 16px;
                               border:2px solid var(--athletics,#3D9EFF);flex-shrink:0;">`
                : "";

            return `
                <div style="min-width:100%;flex-shrink:0;box-sizing:border-box;
                            padding:32px 36px;text-align:center;
                            background:var(--bg-panel,#15171A);border:1px solid #232529;">
                    ${imgBlock}
                    <div style="color:var(--athletics,#3D9EFF);font-size:18px;letter-spacing:3px;margin-bottom:14px;">${stars}</div>
                    <p style="font-family:'Work Sans',sans-serif;font-style:italic;font-size:15px;
                              line-height:1.65;color:#F5F4F0;margin:0 0 16px;">"${safeComment}"</p>
                    <p style="font-family:'JetBrains Mono',monospace;font-size:11px;
                              letter-spacing:0.06em;color:#8C8F96;margin:0;">
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