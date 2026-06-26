const reviewBtn = document.getElementById("reviewBtn");

if (reviewBtn) {

    reviewBtn.addEventListener("click", () => {

        const user = localStorage.getItem("kp12_user");

        if (user) {

            window.location.href = "review.html";

        } else {

            localStorage.setItem("redirectAfterLogin", "review.html");

            alert("Please sign in or create an account before leaving a review.");

            window.location.href = "signup.html";

        }

    });

}