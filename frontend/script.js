document.addEventListener("DOMContentLoaded", () => {
    const authLink = document.getElementById("auth-nav-link");
    if (!authLink) return;

    // Ask the server directly if the user is authenticated
    fetch('/api/auth/status')
        .then(response => response.json())
        .then(data => {
            if (data.loggedIn) {
                // Server verified they have an active login stamp!
                authLink.textContent = "My Account";
                authLink.setAttribute("href", "acc.html");
            } else {
                // Server says they are a guest
                authLink.textContent = "Sign Up";
                authLink.setAttribute("href", "signup.html");
            }
        })
        .catch(err => {
            console.error("Auth status verification failed:", err);
            // Fallback UI safety state
            authLink.textContent = "Sign Up";
            authLink.setAttribute("href", "signup.html");
        });
});