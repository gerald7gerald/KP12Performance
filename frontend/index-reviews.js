document.addEventListener("DOMContentLoaded", async () => {
    const container = document.getElementById("index-reviews-container");
    if (!container) return;

    let currentSlide = 0;
    let slideInterval;

    try {
        // 1. Fetch live public reviews from your backend
        const response = await fetch('/api/reviews');
        const reviews = await response.json();

        if (!reviews || reviews.length === 0) {
            container.innerHTML = `
                <div class="review-card-slide">
                    <div class="stars">★★★★★</div>
                    <p class="review-text">"Be the first athlete to leave a review and share your experience."</p>
                    <p class="review-author">— Your Name Here</p>
                </div>`;
            return;
        }

        // 2. Build the markup strings for the slides dynamically
        container.innerHTML = reviews.map(review => `
            <div class="review-card-slide">
                <div class="stars">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</div>
                <p class="review-text">"${review.comment}"</p>
                <p class="review-author">— ${review.username} (${review.training_type})</p>
            </div>
        `).join('');

        const slides = document.querySelectorAll(".review-card-slide");
        
        // 3. Slideshow transition function
        function showSlide(index) {
            if (index >= slides.length) currentSlide = 0;
            else if (index < 0) currentSlide = slides.length - 1;
            else currentSlide = index;

            // Shift them horizontally out of view based on active index
            slides.forEach((slide) => {
                slide.style.transform = `translateX(${-100 * currentSlide}%)`;
            });
        }

        // 4. Set up auto rotation timers
        function startAutoSlide() {
            slideInterval = setInterval(() => {
                showSlide(currentSlide + 1);
            }, 5000); // Transitions to the next slide every 5 seconds
        }

        // Initialize display layouts and start the autocyclic track loop
        showSlide(0);
        startAutoSlide();

    } catch (err) {
        console.error("Failed to compile live slider review stream:", err);
    }
});