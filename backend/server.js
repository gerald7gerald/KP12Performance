const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const path = require('path');
const crypto = require('crypto');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(__dirname, '..', 'frontend')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- STARTUP: create/migrate all tables in sequence ---
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
    return pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;`);
  })
  .then(() => {
    console.log("is_admin column verified/created successfully!");
    return pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS phone VARCHAR(30),
        ADD COLUMN IF NOT EXISTS age INTEGER,
        ADD COLUMN IF NOT EXISTS gender VARCHAR(30);
    `);
  })
  .then(() => {
    console.log("Profile columns (phone, age, gender) verified/created successfully!");
    return pool.query("UPDATE users SET is_admin = TRUE WHERE email = 'geraldcgarcia7@gmail.com';");
  })
  .then(() => console.log("SUCCESS: geraldcgarcia7@gmail.com is now flagged as an Admin!"))
  .catch((err) => console.error("Error during users table / admin setup:", err));

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

// --- HELPERS ---

function setLoginCookie(res, userId) {
  res.cookie('userId', userId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  });
}

function getUserIdFromCookies(req) {
  const cookies = req.headers.cookie;
  if (!cookies) return null;
  const match = cookies.split(';').map(c => c.trim()).find(c => c.startsWith('userId='));
  if (!match) return null;
  return match.split('=')[1];
}

async function requireAdmin(req, res, next) {
  const userId = getUserIdFromCookies(req);
  if (!userId) return res.status(401).json({ error: "Please sign in." });
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

// --- STATIC ROUTES ---

app.get('/', (req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'frontend', 'index.html'));
});

app.get('/abt.html', (req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'frontend', 'abt.html'));
});

app.get('/api/data', async (req, res) => {
  try {
    res.json({ message: "Hello from the live Render backend!" });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
});

// --- AUTH ROUTES ---

// SIGNUP — saves phone, age, gender
app.post('/api/auth/signup', async (req, res) => {
  const { username, email, password, phone, age, gender } = req.body;
  try {
    const userCheck = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: "User already exists with this email." });
    }
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const insertResult = await pool.query(
      "INSERT INTO users (username, email, password, phone, age, gender) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
      [username, email, hashedPassword, phone || null, age ? parseInt(age) : null, gender || null]
    );
    setLoginCookie(res, insertResult.rows[0].id);
    res.status(201).json({ message: "User registered successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error during registration." });
  }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Invalid email or password." });
    }
    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: "Invalid email or password." });
    }
    setLoginCookie(res, user.id);
    res.json({ message: "Logged in successfully!", user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error during login." });
  }
});

// AUTH STATUS
app.get('/api/auth/status', (req, res) => {
  const cookies = req.headers.cookie;
  if (cookies && cookies.includes('userId=')) {
    return res.json({ loggedIn: true });
  }
  res.json({ loggedIn: false });
});

// ME — full profile including phone/age/gender/is_admin
app.get('/api/auth/me', async (req, res) => {
  const userId = getUserIdFromCookies(req);
  if (!userId) return res.status(401).json({ error: "Not logged in." });
  try {
    const result = await pool.query(
      "SELECT id, username, email, phone, age, gender, is_admin FROM users WHERE id = $1",
      [userId]
    );
    if (result.rows.length === 0) return res.status(401).json({ error: "Not logged in." });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error fetching user." });
  }
});

// UPDATE PROFILE — lets users edit phone, age, gender after signup
app.patch('/api/auth/profile', async (req, res) => {
  const userId = getUserIdFromCookies(req);
  if (!userId) return res.status(401).json({ error: "Please sign in." });
  const { phone, age, gender } = req.body;
  try {
    await pool.query(
      `UPDATE users SET phone = $1, age = $2, gender = $3 WHERE id = $4`,
      [phone || null, age ? parseInt(age) : null, gender || null, userId]
    );
    res.json({ message: "Profile updated successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error updating profile." });
  }
});

// LOGOUT
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('userId');
  res.json({ message: "Logged out successfully." });
});

// --- ADMIN ROUTES ---

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, username, email, phone, age, gender, is_admin FROM users ORDER BY id ASC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error fetching users" });
  }
});

// --- REVIEWS ---

app.post('/api/reviews', async (req, res) => {
  const userId = getUserIdFromCookies(req);
  if (!userId) return res.status(401).json({ error: "Please sign in to leave a review." });
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

app.delete('/api/reviews/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("DELETE FROM reviews WHERE id = $1 RETURNING id", [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Review not found." });
    res.json({ message: "Review deleted." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error deleting review." });
  }
});

// --- PASSWORD RESET ---

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Please provide your email address." });
  try {
    const result = await pool.query("SELECT id, username FROM users WHERE email = $1", [email]);
    if (result.rows.length > 0) {
      const user = result.rows[0];
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await pool.query(
        "UPDATE password_resets SET used = TRUE WHERE user_id = $1 AND used = FALSE",
        [user.id]
      );
      await pool.query(
        "INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)",
        [user.id, token, expiresAt]
      );
      const resetLink = `https://kp12performance.com/reset-password.html?token=${token}`;
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
    res.json({ message: "If that email is registered, a reset link is on its way." });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: "Token and new password are required." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  try {
    const result = await pool.query(
      `SELECT * FROM password_resets WHERE token = $1 AND used = FALSE AND expires_at > NOW()`,
      [token]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
    }
    const resetRow = result.rows[0];
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hashedPassword, resetRow.user_id]);
    await pool.query("UPDATE password_resets SET used = TRUE WHERE id = $1", [resetRow.id]);
    setLoginCookie(res, resetRow.user_id);
    res.json({ message: "Password reset successfully! Redirecting you now..." });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// --- START SERVER ---
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});