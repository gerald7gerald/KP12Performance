document.addEventListener("DOMContentLoaded", async () => {
    const container = document.getElementById("review-list");
    if (!container) return;

    let isAdmin = false;
    let currentImageData = null; // holds compressed base64 string if user picked a photo

    // ---- Check admin status ----
    fetch('/api/auth/me')
        .then(res => res.ok ? res.json() : null)
        .then(data => { isAdmin = !!(data && data.user && data.user.is_admin); })
        .catch(() => { isAdmin = false; })
        .finally(loadReviews);

    // ---- Image compression — crops to 4:3 and compresses ----
    function compressImage(file) {
        return new Promise((resolve, reject) => {
            if (!file.type.startsWith('image/')) {
                reject(new Error('File must be an image.'));
                return;
            }
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const TARGET_W = 900;
                    const TARGET_H = 675; // 4:3 ratio
                    const canvas = document.createElement('canvas');
                    canvas.width  = TARGET_W;
                    canvas.height = TARGET_H;
                    const ctx = canvas.getContext('2d');

                    // Fill black background first (for images with transparency)
                    ctx.fillStyle = '#0D0E10';
                    ctx.fillRect(0, 0, TARGET_W, TARGET_H);

                    // Center-crop to 4:3
                    const srcRatio = img.width / img.height;
                    const dstRatio = TARGET_W / TARGET_H;
                    let sx, sy, sw, sh;
                    if (srcRatio > dstRatio) {
                        // Image is wider — crop sides
                        sh = img.height;
                        sw = img.height * dstRatio;
                        sx = (img.width - sw) / 2;
                        sy = 0;
                    } else {
                        // Image is taller — crop top/bottom
                        sw = img.width;
                        sh = img.width / dstRatio;
                        sx = 0;
                        sy = (img.height - sh) / 2;
                    }
                    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, TARGET_W, TARGET_H);
                    resolve(canvas.toDataURL('image/jpeg', 0.78));
                };
                img.onerror = () => reject(new Error('Could not load image.'));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('Could not read file.'));
            reader.readAsDataURL(file);
        });
    }

    // ---- Wire up the image picker if it's on the page ----
    const photoInput   = document.getElementById('review-photo-input');
    const photoDropZone= document.getElementById('review-photo-drop');
    const photoPreview = document.getElementById('review-photo-preview');
    const photoRemove  = document.getElementById('review-photo-remove');
    const photoStatus  = document.getElementById('review-photo-status');

    function showPreview(dataUrl) {
        if (!photoPreview) return;
        photoPreview.src = dataUrl;
        photoPreview.style.display = 'block';
        if (photoDropZone) photoDropZone.classList.add('has-image');
        if (photoRemove) photoRemove.style.display = 'inline-block';
        if (photoStatus) photoStatus.textContent = 'Photo ready.';
    }

    function clearPhoto() {
        currentImageData = null;
        if (photoPreview) { photoPreview.src = ''; photoPreview.style.display = 'none'; }
        if (photoInput)   photoInput.value = '';
        if (photoDropZone) photoDropZone.classList.remove('has-image');
        if (photoRemove)  photoRemove.style.display = 'none';
        if (photoStatus)  photoStatus.textContent = '';
    }

    async function handleFile(file) {
        if (!file) return;
        if (photoStatus) photoStatus.textContent = 'Processing…';
        try {
            currentImageData = await compressImage(file);
            showPreview(currentImageData);
        } catch (err) {
            if (photoStatus) photoStatus.textContent = err.message || 'Could not process image.';
            currentImageData = null;
        }
    }

    if (photoInput) {
        photoInput.addEventListener('change', () => {
            if (photoInput.files[0]) handleFile(photoInput.files[0]);
        });
    }

    if (photoDropZone) {
        photoDropZone.addEventListener('click', () => photoInput && photoInput.click());
        photoDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            photoDropZone.classList.add('drag-over');
        });
        photoDropZone.addEventListener('dragleave', () => photoDropZone.classList.remove('drag-over'));
        photoDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            photoDropZone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
        });
    }

    if (photoRemove) {
        photoRemove.addEventListener('click', (e) => { e.stopPropagation(); clearPhoto(); });
    }

    // ---- Intercept form submit to include image ----
    const reviewForm = document.getElementById('review-form') || document.querySelector('form');
    if (reviewForm) {
        reviewForm.addEventListener('submit', async (e) => {
            // The existing submit handler in auth.js / inline will fire;
            // we just need to make sure imageData is included in the fetch.
            // If the form already has its own handler, we attach imageData to a
            // hidden field so the handler can pick it up.
            const hiddenImg = document.getElementById('review-image-data');
            if (hiddenImg && currentImageData) {
                hiddenImg.value = currentImageData;
            }
        }, true); // capture phase so it runs before other handlers
    }

    // ---- Load + render reviews ----
    function loadReviews() {
        fetch('/api/reviews')
            .then(res => res.json())
            .then(reviews => {
                if (!Array.isArray(reviews) || reviews.length === 0) {
                    container.innerHTML = '<p class="review-list-empty">Be the first athlete to leave a review.</p>';
                    return;
                }

                container.innerHTML = reviews.map(r => {
                    const stars      = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);
                    const safeComment= escapeHtml(r.comment);
                    const safeUser   = escapeHtml(r.username || "Athlete");
                    const safeType   = escapeHtml(r.training_type);
                    const deleteBtn  = isAdmin
                        ? `<button type="button" class="review-delete-btn" data-id="${r.id}" aria-label="Delete review">Delete</button>`
                        : "";

                    const imgBlock = r.image_data
                        ? `<div class="review-list-img-wrap">
                               <img src="${r.image_data}" alt="${safeUser} in action" class="review-list-img" loading="lazy">
                           </div>`
                        : "";

                    return `
                        <div class="review-list-item" data-review-id="${r.id}">
                            ${imgBlock}
                            <div class="review-list-top">
                                <div class="review-list-stars">${stars}</div>
                                ${deleteBtn}
                            </div>
                            <p class="review-list-comment">"${safeComment}"</p>
                            <p class="review-list-meta">— ${safeUser} <span class="review-list-type">[ ${safeType} ]</span></p>
                        </div>
                    `;
                }).join("");

                if (isAdmin) {
                    document.querySelectorAll(".review-delete-btn").forEach(btn => {
                        btn.addEventListener("click", handleDelete);
                    });
                }
            })
            .catch(err => {
                console.error("Failed to load reviews:", err);
                container.innerHTML = '<p class="review-list-empty">Couldn\'t load reviews right now.</p>';
            });
    }

    function handleDelete(e) {
        const id = e.target.dataset.id;
        if (!confirm("Delete this review? This can't be undone.")) return;
        fetch(`/api/reviews/${id}`, { method: 'DELETE' })
            .then(res => res.json().then(data => ({ ok: res.ok, data })))
            .then(({ ok, data }) => {
                if (!ok) { alert(data.error || "Couldn't delete."); return; }
                const item = document.querySelector(`.review-list-item[data-review-id="${id}"]`);
                if (item) item.remove();
            })
            .catch(() => alert("Couldn't reach the server."));
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }
});