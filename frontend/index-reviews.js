document.addEventListener("DOMContentLoaded", async () => {
    const container = document.getElementById("index-reviews-container");
    if (!container) return;

    let currentSlide = 0;
    let totalSlides = 0;
    let slideInterval;

    try {
        // 1. Fetch live public reviews from your backend
        const response = await fetch('/api/reviews');
        const reviews = await response.json();

        if (!reviews || reviews.length === 0) {
            container.innerHTML = `
                <div class="review-card-slide" style="min-width:100%;box-sizing:border-box;padding:30px;text-align:center;background:var(--bg-panel,#15171A);border:1px solid rgba(255,255,255,0.1);">
                    <div class="stars" style="color:#B8FF3F;margin-bottom:10px;">★★★★★</div>
                    <p class="review-text" style="font-family:'Work Sans',sans-serif;font-style:italic;font-size:1.1rem;line-height:1.6;">"Be the first athlete to leave a review and share your experience."</p>
                    <p class="review-author" style="font-family:'JetBrains Mono',monospace;margin-top:15px;color:var(--text-muted,#8C8F96);">— Your Name Here</p>
                </div>`;
            return;
        }

        // 2. Build slide markup — each card is 100% wide so they sit side-by-side
        //    inside the flex container, which we then translate to reveal each one
        container.innerHTML = reviews.map(review => {
            const stars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
            const safeComment = escapeHtml(review.comment);
            const safeUsername = escapeHtml(review.username || "Athlete");
            const safeType = escapeHtml(review.training_type);
            return `
                <div class="review-card-slide" style="min-width:100%;box-sizing:border-box;padding:30px;text-align:center;background:var(--bg-panel,#15171A);border:1px solid rgba(255,255,255,0.1);">
                    <div class="stars" style="color:#B8FF3F;margin-bottom:10px;font-size:20px;letter-spacing:4px;">${stars}</div>
                    <p class="review-text" style="font-family:'Work Sans',sans-serif;font-style:italic;font-size:1.05rem;line-height:1.65;color:#F5F4F0;">"${safeComment}"</p>
                    <p class="review-author" style="font-family:'JetBrains Mono',monospace;margin-top:15px;color:#8C8F96;font-size:12px;letter-spacing:0.06em;">— ${safeUsername} <span style="opacity:0.6;">[ ${safeType} ]</span></p>
                </div>
            `;
        }).join('');

        totalSlides = reviews.length;

        // 3. Move the CONTAINER left to reveal each slide —
        //    the individual slides stay put, the track shifts under them
        function showSlide(index) {
            if (index >= totalSlides) currentSlide = 0;
            else if (index < 0) currentSlide = totalSlides - 1;
            else currentSlide = index;

            container.style.transform = `translateX(${-100 * currentSlide}%)`;
        }

        // 4. Auto-rotate every 5 seconds
        function startAutoSlide() {
            slideInterval = setInterval(() => {
                showSlide(currentSlide + 1);
            }, 5000);
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