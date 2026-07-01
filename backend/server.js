const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const path = require('path');
const crypto = require('crypto'); // Built-in Node module — no install needed
const { Resend } = require('resend'); // npm install resend

const resend = new Resend(process.env.RESEND_API_KEY);

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS so your frontend can talk to your backend safely
app.use(cors());
app.use(express.json());

// Force Express to strictly resolve your static frontend assets directory relative to this script
app.use(express.static(path.resolve(__dirname, '..', 'frontend')));

// Set up PostgreSQL database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Ensures secure connection over Render
  }
});

// Automatically create the users table if it doesn't exist yet
const createTableQuery = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL
  );
`;

pool.query(createTableQuery)
  .then(() => {
    console.log("Users table verified/created successfully!");

    // The is_admin column must exist BEFORE the auto-flag UPDATE below
    // runs — chaining these in sequence (rather than firing them as
    // separate, unordered pool.query() calls) guarantees that order.
    return pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;`);
  })
  .then(() => {
    console.log("is_admin column verified/created successfully!");

    // --- AUTO ADMIN SETUP: flags this account as admin on every deploy ---
    return pool.query("UPDATE users SET is_admin = TRUE WHERE email = 'geraldcgarcia7@gmail.com';");
  })
  .then(() => console.log("SUCCESS: geraldcgarcia7@gmail.com is now flagged as an Admin!"))
  .catch((err) => console.error("Error during users table / admin setup:", err));

// Reviews table — stores submitted reviews so they persist across visits
const createReviewsTableQuery = `
  CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    training_type VARCHAR(50) NOT NULL,
    comment TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    created_at TIMESTAMP DEFAULT NOW()
  );
`;

pool.query(createReviewsTableQuery)
  .then(() => console.log("Reviews table verified/created successfully!"))
  .catch((err) => console.error("Error creating reviews table:", err));

// Password reset tokens — each row is a single-use token that expires in 1 hour
const createPasswordResetsQuery = `
  CREATE TABLE IF NOT EXISTS password_resets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
  );
`;

pool.query(createPasswordResetsQuery)
  .then(() => console.log("Password resets table verified/created successfully!"))
  .catch((err) => console.error("Error creating password_resets table:", err));

// Small helper so signup and login both issue the cookie the same way
function setLoginCookie(res, userId) {
  res.cookie('userId', userId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // Lasts 1 day
  });
}

// Serve your main index.html file cleanly using an absolute system resolution path
app.get('/', (req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'frontend', 'index.html'));
});

// >>> ADDED THIS ROUTE: Explicitly hands over the about page when requested <<<
app.get('/abt.html', (req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'frontend', 'abt.html'));
});

// A standard test route so we know the backend works!
app.get('/api/data', async (req, res) => {
  try {
    res.json({ message: "Hello from the live Render backend!" });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
});

// --- AUTHENTICATION ROUTES ---

// API Endpoint: SIGNUP
app.post('/api/auth/signup', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    // Check if user already exists
    const userCheck = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: "User already exists with this email." });
    }

    // Encrypt the password securely
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Save user to database
    const insertResult = await pool.query(
      "INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id",
      [username, email, hashedPassword]
    );

    // Log them in immediately — same cookie login() issues — so the
    // frontend's "redirect after signup" flows actually land on an
    // authenticated session instead of silently bouncing them back
    setLoginCookie(res, insertResult.rows[0].id);

    res.status(201).json({ message: "User registered successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error during registration." });
  }
});

// API Endpoint: LOGIN
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    // Look up user
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Invalid email or password." });
    }

    const user = result.rows[0];

    // Check if password matches encrypted password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: "Invalid email or password." });
    }

    // Issues an HTTP-only login cookie to the browser
    setLoginCookie(res, user.id);

    res.json({ message: "Logged in successfully!", user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error during login." });
  }
});

// Checks cookie status to let frontend know if user is logged in
app.get('/api/auth/status', (req, res) => {
  const cookies = req.headers.cookie;

  if (cookies && cookies.includes('userId=')) {
    return res.json({ loggedIn: true });
  }

  res.json({ loggedIn: false });
});

// Returns the logged-in user's basic info (username/email/is_admin) so the
// account page and review page can use it — replaces the old localStorage
// approach, since the login cookie is httpOnly and invisible to frontend JS
app.get('/api/auth/me', async (req, res) => {
  const userId = getUserIdFromCookies(req);

  if (!userId) {
    return res.status(401).json({ error: "Not logged in." });
  }

  try {
    const result = await pool.query(
      "SELECT id, username, email, is_admin FROM users WHERE id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Not logged in." });
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error fetching user." });
  }
});

// Logs the user out by clearing the cookie server-side.
// Frontend JS can't delete an httpOnly cookie itself, so this route is
// required for logout to actually work
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('userId');
  res.json({ message: "Logged out successfully." });
});

// Small helper to pull the raw userId value out of the cookie header.
function getUserIdFromCookies(req) {
  const cookies = req.headers.cookie;
  if (!cookies) return null;

  const match = cookies.split(';').map(c => c.trim()).find(c => c.startsWith('userId='));
  if (!match) return null;

  return match.split('=')[1];
}

// API Endpoint: ADMIN VIEW USERS
app.get('/api/admin/users', async (req, res) => {
  try {
    const result = await pool.query("SELECT id, username, email FROM users ORDER BY id ASC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error fetching users" });
  }
});

// --- REVIEWS ---

// API Endpoint: SUBMIT A REVIEW (must be logged in)
app.post('/api/reviews', async (req, res) => {
  const userId = getUserIdFromCookies(req);
  if (!userId) {
    return res.status(401).json({ error: "Please sign in to leave a review." });
  }

  const { trainingType, comment, rating } = req.body;

  if (!trainingType || !comment || !rating) {
    return res.status(400).json({ error: "Please fill out every field before submitting." });
  }

  const ratingNum = parseInt(rating, 10);
  if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: "Rating must be between 1 and 5." });
  }

  try {
    await pool.query(
      "INSERT INTO reviews (user_id, training_type, comment, rating) VALUES ($1, $2, $3, $4)",
      [userId, trainingType, comment, ratingNum]
    );
    res.status(201).json({ message: "Review submitted successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error submitting review." });
  }
});

// API Endpoint: GET RECENT REVIEWS (public — anyone can read these)
app.get('/api/reviews', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT reviews.id, reviews.training_type, reviews.comment, reviews.rating, reviews.created_at,
              users.username
       FROM reviews
       JOIN users ON reviews.user_id = users.id
       ORDER BY reviews.created_at DESC
       LIMIT 20`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error fetching reviews." });
  }
});

// Middleware: only lets the request through if the logged-in user has
// is_admin = TRUE in the database. Used to gate review deletion so this
// can't be done by just anyone who happens to be logged in.
async function requireAdmin(req, res, next) {
  const userId = getUserIdFromCookies(req);
  if (!userId) {
    return res.status(401).json({ error: "Please sign in." });
  }

  try {
    const result = await pool.query("SELECT is_admin FROM users WHERE id = $1", [userId]);
    if (result.rows.length === 0 || !result.rows[0].is_admin) {
      return res.status(403).json({ error: "Admin access required." });
    }
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error checking admin status." });
  }
}

// API Endpoint: DELETE A REVIEW (admin only)
app.delete('/api/reviews/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query("DELETE FROM reviews WHERE id = $1 RETURNING id", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Review not found." });
    }
    res.json({ message: "Review deleted." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error deleting review." });
  }
});

// API Endpoint: FORGOT PASSWORD
// Generates a secure reset token, saves it, and emails the user a link.
// Always returns a 200 even if the email isn't found — this prevents
// attackers from figuring out which emails are registered.
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Please provide your email address." });
  }

  try {
    const result = await pool.query("SELECT id, username FROM users WHERE email = $1", [email]);

    if (result.rows.length > 0) {
      const user = result.rows[0];

      // Generate a cryptographically random token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

      // Invalidate any existing unused tokens for this user before creating a new one
      await pool.query(
        "UPDATE password_resets SET used = TRUE WHERE user_id = $1 AND used = FALSE",
        [user.id]
      );

      // Store the new token
      await pool.query(
        "INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)",
        [user.id, token, expiresAt]
      );

      const resetLink = `https://kp12performance.com/reset-password.html?token=${token}`;

      // Send the email via Resend
      await resend.emails.send({
        from: 'support@kp12performance.com',
        to: email,
        subject: 'Reset your KP12 Performance password',
        html: `
          <div style="background:#0D0E10;color:#F5F4F0;font-family:'Work Sans',Arial,sans-serif;max-width:520px;margin:0 auto;padding:48px 40px;border:1px solid #232529;">
            <img src="https://kp12performance.com/logo.png" alt="KP12 Performance" style="height:40px;margin-bottom:32px;display:block;">
            <p style="font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.15em;color:#8C8F96;margin-bottom:16px;">[ PASSWORD RESET ]</p>
            <h1 style="font-size:28px;font-weight:700;text-transform:uppercase;margin:0 0 20px;">Hey ${user.username},</h1>
            <p style="color:#8C8F96;font-size:15px;line-height:1.6;margin-bottom:32px;">
              We received a request to reset your KP12 Performance password. Click the button below to choose a new one. This link expires in <strong style="color:#F5F4F0;">1 hour</strong>.
            </p>
            <a href="${resetLink}" style="display:inline-block;background:#B8FF3F;color:#0D0E10;font-family:'JetBrains Mono',monospace;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:16px 32px;margin-bottom:32px;">
              Reset Password
            </a>
            <p style="color:#8C8F96;font-size:13px;line-height:1.5;border-top:1px solid #232529;padding-top:24px;margin-top:8px;">
              If you didn't request this, you can safely ignore this email — your password won't change.<br><br>
              Or copy this link into your browser:<br>
              <a href="${resetLink}" style="color:#B8FF3F;word-break:break-all;">${resetLink}</a>
            </p>
          </div>
        `
      });
    }

    // Always respond with success to avoid revealing whether the email exists
    res.json({ message: "If that email is registered, a reset link is on its way." });

  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// API Endpoint: RESET PASSWORD
// Validates the token and updates the user's password.
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ error: "Token and new password are required." });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  try {
    // Find a valid, unused, non-expired token
    const result = await pool.query(
      `SELECT * FROM password_resets
       WHERE token = $1
         AND used = FALSE
         AND expires_at > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
    }

    const resetRow = result.rows[0];

    // Hash the new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Update the user's password
    await pool.query(
      "UPDATE users SET password = $1 WHERE id = $2",
      [hashedPassword, resetRow.user_id]
    );

    // Mark the token as used so it can't be reused
    await pool.query(
      "UPDATE password_resets SET used = TRUE WHERE id = $1",
      [resetRow.id]
    );

    // Log them in automatically after resetting
    setLoginCookie(res, resetRow.user_id);

    res.json({ message: "Password reset successfully! Redirecting you now..." });

  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// --- START THE SERVER (STAYS AT THE VERY BOTTOM) ---
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});