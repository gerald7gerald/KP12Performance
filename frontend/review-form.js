document.addEventListener("DOMContentLoaded", () => {

    const trainingType = document.getElementById("training-type");
    const reviewDetails = document.getElementById("review-details");
    const comment = document.getElementById("review-comment");
    const starButtons = document.querySelectorAll(".star-btn");
    const ratingValueInput = document.getElementById("rating-value");
    const submitBtn = document.getElementById("review-submit-btn");
    const form = document.getElementById("review-form");
    const errorEl = document.getElementById("review-form-error");
    const successEl = document.getElementById("review-success");
    const reviewList = document.getElementById("review-list");

    let selectedRating = 0;

    // ---- Step 1: picking a training type reveals the feedback box + stars ----
    trainingType.addEventListener("change", () => {
        if (trainingType.value) {
            reviewDetails.classList.add("is-visible");
        } else {
            reviewDetails.classList.remove("is-visible");
        }
        updateSubmitState();
    });

    // ---- Star rating ----
    function setStars(value) {
        selectedRating = value;
        ratingValueInput.value = value;
        starButtons.forEach((btn) => {
            const btnValue = parseInt(btn.dataset.value, 10);
            btn.classList.toggle("is-filled", btnValue <= value);
        });
        updateSubmitState();
    }

    starButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            setStars(parseInt(btn.dataset.value, 10));
        });
    });

    comment.addEventListener("input", updateSubmitState);

    function updateSubmitState() {
        const ready = trainingType.value && comment.value.trim().length > 0 && selectedRating > 0;
        submitBtn.disabled = !ready;
    }

    // ---- Submit ----
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        errorEl.textContent = "";
        errorEl.style.display = "none";
        submitBtn.disabled = true;

        try {
            const res = await fetch('/api/reviews', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trainingType: trainingType.value,
                    comment: comment.value.trim(),
                    rating: selectedRating
                })
            });

            const data = await res.json();

            if (!res.ok) {
                errorEl.textContent = data.error || "Something went wrong. Please try again.";
                errorEl.style.display = "block";
                submitBtn.disabled = false;
                return;
            }

            form.classList.add("is-hidden");
            successEl.classList.add("is-visible");

            setTimeout(() => {
                window.location.href = "index.html";
            }, 2200);

        } catch (err) {
            console.error(err);
            errorEl.textContent = "Couldn't reach the server. Please try again in a moment.";
            errorEl.style.display = "block";
            submitBtn.disabled = false;
        }
    });

    // ---- Load recent reviews ----
    fetch('/api/reviews')
        .then((res) => res.json())
        .then((reviews) => {
            if (!Array.isArray(reviews) || reviews.length === 0) {
                reviewList.innerHTML = '<p class="review-list-empty">Be the first athlete to leave a review.</p>';
                return;
            }

            reviewList.innerHTML = reviews.map((r) => {
                const stars = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);
                const safeComment = escapeHtml(r.comment);
                const safeUsername = escapeHtml(r.username || "Athlete");
                const safeType = escapeHtml(r.training_type);

                return `
                    <div class="review-list-item">
                        <div class="review-list-stars">${stars}</div>
                        <p class="review-list-comment">"${safeComment}"</p>
                        <p class="review-list-meta">— ${safeUsername} <span class="review-list-type">[ ${safeType} ]</span></p>
                    </div>
                `;
            }).join("");
        })
        .catch((err) => {
            console.error("Failed to load reviews:", err);
            reviewList.innerHTML = '<p class="review-list-empty">Couldn\'t load reviews right now.</p>';
        });

    // Basic HTML-escaping so review text/usernames can't inject markup
    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

});