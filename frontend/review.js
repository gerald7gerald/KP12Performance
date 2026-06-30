const reviewBtn = document.getElementById("reviewBtn");

if (reviewBtn) {
    reviewBtn.addEventListener("click", () => {
        // Ask the server directly, same as nav.js
        fetch('/api/auth/status')
            .then(response => response.json())
            .then(data => {
                if (data.loggedIn) {
                    window.location.href = "review.html";
                } else {
                    localStorage.setItem("redirectAfterLogin", "review.html");
                    alert("Please sign in or create an account before leaving a review.");
                    window.location.href = "signup.html";
                }
            })
            .catch(err => {
                console.error("Auth status check failed:", err);
                localStorage.setItem("redirectAfterLogin", "review.html");
                alert("Please sign in or create an account before leaving a review.");
                window.location.href = "signup.html";
            });
    });
}

// ==========================================
// NEW: LOAD AND DISPLAY REVIEWS WITH ADMIN CONTROLS
// ==========================================

document.addEventListener("DOMContentLoaded", async () => {
    // Only run this code if we are actually on the page that displays reviews
    const reviewsContainer = document.getElementById("reviews-container"); // Make sure your HTML has an element with this ID!
    if (!reviewsContainer) return;

    let isAdmin = false;

    // 1. Check if the current user is an admin
    try {
        const userRes = await fetch('/api/auth/me');
        if (userRes.ok) {
            const userData = await userRes.json();
            isAdmin = userData.user.is_admin; // Grab true/false from your PG database
        }
    } catch (err) {
        console.error("Error checking admin status:", err);
    }

    // 2. Fetch all reviews from the backend database
    try {
        const response = await fetch('/api/reviews');
        const reviews = await response.json();

        if (reviews.length === 0) {
            reviewsContainer.innerHTML = `<p class="no-reviews">No reviews left yet. Be the first!</p>`;
            return;
        }

        reviewsContainer.innerHTML = ""; // Clear out any placeholder text

        // 3. Loop through and draw each review onto the page
        reviews.forEach(review => {
            const reviewCard = document.createElement("div");
            reviewCard.className = "review-card";

            // If the user is an admin, generate a delete button holding the review's database ID
            let deleteButtonHTML = "";
            if (isAdmin) {
                deleteButtonHTML = `
                    <button class="review-button delete-btn" style="background: red; color: white; border: none; margin-top: 10px; cursor: pointer;" onclick="deleteReview(${review.id})">
                        DELETE REVIEW
                    </button>
                `;
            }

            reviewCard.innerHTML = `
                <div class="review-header">
                    <strong>${review.username}</strong> — <span class="training-tag">${review.training_type}</span>
                </div>
                <div class="review-rating">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</div>
                <p class="review-comment">${review.comment}</p>
                ${deleteButtonHTML}
            `;

            reviewsContainer.appendChild(reviewCard);
        });
    } catch (err) {
        console.error("Error loading reviews:", err);
        reviewsContainer.innerHTML = `<p class="error">Could not load reviews at this time.</p>`;
    }
});

// ==========================================
// NEW: ACTION TO SEND THE DELETE REQUEST TO BACKEND
// ==========================================
async function deleteReview(reviewId) {
    if (!confirm("Are you sure you want to permanently delete this review?")) return;

    try {
        const res = await fetch(`/api/reviews/${reviewId}`, {
            method: "DELETE"
        });
        const data = await res.json();

        if (!res.ok) {
            alert(data.error || "Could not delete review.");
            return;
        }

        alert("Review deleted successfully.");
        window.location.reload(); // Refresh the page to update the list
    } catch (err) {
        console.error("Error running delete fetch:", err);
        alert("An error occurred while deleting.");
    }
}