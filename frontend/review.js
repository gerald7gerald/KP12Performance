const reviewBtn = document.getElementById("reviewBtn");

if (reviewBtn) {

    reviewBtn.addEventListener("click", () => {

        const user = localStorage.getItem("loggedInUser");

        if (user) {

            window.location.href = "reviews.html";

        } else {

            localStorage.setItem(
                "redirectAfterLogin",
                "reviews.html"
            );

            alert("Please create an account before leaving a review.");

            window.location.href = "signup.html";

        }

    });

}