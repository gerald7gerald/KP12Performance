const reviewBtn = document.getElementById("reviewBtn");

if (reviewBtn) {

    reviewBtn.addEventListener("click", () => {

        // Ask the server directly, same as nav.js — keeps both pieces of UI
        // agreeing on login status instead of trusting a locally-cached value
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
                // Fail safe: treat as logged out rather than letting
                // an unverified user through
                localStorage.setItem("redirectAfterLogin", "review.html");
                alert("Please sign in or create an account before leaving a review.");
                window.location.href = "signup.html";
            });

    });

}