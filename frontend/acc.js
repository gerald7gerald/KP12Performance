document.addEventListener("DOMContentLoaded", () => {
    const nameEl     = document.getElementById("account-username");
    const emailEl    = document.getElementById("account-email");
    const phoneEl    = document.getElementById("account-phone");
    const ageEl      = document.getElementById("account-age");
    const genderEl   = document.getElementById("account-gender");
    const logoutBtn  = document.getElementById("logout-btn");
    const editToggle = document.getElementById("edit-toggle-btn");
    const editForm   = document.getElementById("edit-profile-form");
    const cancelBtn  = document.getElementById("edit-cancel-btn");
    const editError  = document.getElementById("edit-error");
    const editSuccess= document.getElementById("edit-success");

    let currentUser = null;

    // ---- Load profile from server ----
    fetch('/api/auth/me')
        .then(res => {
            if (!res.ok) { window.location.href = "login.html"; return null; }
            return res.json();
        })
        .then(data => {
            if (!data) return;
            currentUser = data.user;

            if (nameEl)   nameEl.textContent   = `Welcome back, ${currentUser.username || "Athlete"}.`;
            if (emailEl)  emailEl.textContent  = currentUser.email || "";
            if (phoneEl)  phoneEl.textContent  = currentUser.phone  || "—";
            if (ageEl)    ageEl.textContent     = currentUser.age    || "—";
            if (genderEl) genderEl.textContent  = currentUser.gender || "—";

            // Pre-fill edit form with current values
            if (document.getElementById("edit-phone"))
                document.getElementById("edit-phone").value  = currentUser.phone  || "";
            if (document.getElementById("edit-age"))
                document.getElementById("edit-age").value    = currentUser.age    || "";
            if (document.getElementById("edit-gender"))
                document.getElementById("edit-gender").value = currentUser.gender || "";
        })
        .catch(() => { window.location.href = "login.html"; });

    // ---- Toggle edit form ----
    if (editToggle) {
        editToggle.addEventListener("click", () => {
            editForm.style.display = "flex";
            editToggle.style.display = "none";
            editError.style.display = "none";
            editSuccess.style.display = "none";
        });
    }

    if (cancelBtn) {
        cancelBtn.addEventListener("click", () => {
            editForm.style.display = "none";
            editToggle.style.display = "inline-block";
        });
    }

    // ---- Save profile changes ----
    if (editForm) {
        editForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            editError.style.display = "none";
            editSuccess.style.display = "none";

            const phone  = document.getElementById("edit-phone").value.trim();
            const age    = document.getElementById("edit-age").value;
            const gender = document.getElementById("edit-gender").value;
            const saveBtn = editForm.querySelector(".edit-save-btn");
            saveBtn.disabled = true;

            try {
                const res = await fetch('/api/auth/profile', {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ phone, age, gender })
                });
                const data = await res.json();

                if (!res.ok) {
                    editError.textContent = data.error || "Couldn't save changes.";
                    editError.style.display = "block";
                    saveBtn.disabled = false;
                    return;
                }

                // Update the displayed values immediately
                if (phoneEl)  phoneEl.textContent  = phone  || "—";
                if (ageEl)    ageEl.textContent     = age    || "—";
                if (genderEl) genderEl.textContent  = gender || "—";

                editSuccess.textContent = "Profile updated successfully.";
                editSuccess.style.display = "block";
                saveBtn.disabled = false;

                setTimeout(() => {
                    editForm.style.display = "none";
                    editToggle.style.display = "inline-block";
                    editSuccess.style.display = "none";
                }, 1600);

            } catch (err) {
                console.error(err);
                editError.textContent = "Couldn't reach the server. Please try again.";
                editError.style.display = "block";
                saveBtn.disabled = false;
            }
        });
    }

    // ---- Logout ----
    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            fetch('/api/auth/logout', { method: 'POST' })
                .then(() => { window.location.href = "index.html"; })
                .catch(() => { window.location.href = "index.html"; });
        });
    }
}); 