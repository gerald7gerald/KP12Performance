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

            // If the review has a photo, show it above the text in the card
            const imgBlock = r.image_data
                ? `<div class="review-slide-img-wrap">
                       <img src="${r.image_data}" alt="${safeUser}" class="review-slide-img" loading="lazy">
                   </div>`
                : "";

            return `
                <div class="review-card-slide ${r.image_data ? 'review-card-slide--has-img' : ''}">
                    ${imgBlock}
                    <div class="review-slide-body">
                        <div class="stars">${stars}</div>
                        <p class="review-text">"${safeComment}"</p>
                        <p class="review-author">— ${safeUser} <span class="review-list-type">[ ${safeType} ]</span></p>
                    </div>
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