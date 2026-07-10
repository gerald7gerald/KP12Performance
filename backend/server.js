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

// --- STARTUP: create/migrate all tables ---
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
    console.log("Users table ready!");
    return pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;`);
  })
  .then(() => {
    return pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS phone VARCHAR(30),
        ADD COLUMN IF NOT EXISTS age INTEGER,
        ADD COLUMN IF NOT EXISTS gender VARCHAR(30);
    `);
  })
  .then(() => {
    return pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS role VARCHAR(30),
        ADD COLUMN IF NOT EXISTS referral_source VARCHAR(60),
        ADD COLUMN IF NOT EXISTS referral_detail TEXT;
    `);
  })
  .then(() => {
    console.log("All user columns verified!");
    return pool.query("UPDATE users SET is_admin = TRUE WHERE email = 'geraldcgarcia7@gmail.com';");
  })
  .then(() => console.log("SUCCESS: geraldcgarcia7@gmail.com is flagged as Admin!"))
  .catch((err) => console.error("Error during users table setup:", err));

// Athletes table
const createAthletesTableQuery = `
  CREATE TABLE IF NOT EXISTS athletes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100),
    age INTEGER,
    gender VARCHAR(30),
    created_at TIMESTAMP DEFAULT NOW()
  );
`;
pool.query(createAthletesTableQuery)
  .then(() => console.log("Athletes table ready!"))
  .catch((err) => console.error("Error creating athletes table:", err));

// Reviews table
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
  .then(() => console.log("Reviews table ready!"))
  .catch((err) => console.error("Error creating reviews table:", err));

// Password resets table
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
  .then(() => console.log("Password resets table ready!"))
  .catch((err) => console.error("Error creating password_resets table:", err));

// Schedule table — stores weekly recurring slots set by admins
const createScheduleTableQuery = `
  CREATE TABLE IF NOT EXISTS schedule (
    id SERIAL PRIMARY KEY,
    day_of_week VARCHAR(10) NOT NULL,
    category VARCHAR(20) NOT NULL,
    subcategory VARCHAR(60),
    start_time VARCHAR(10) NOT NULL,
    end_time VARCHAR(10) NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
  );
`;
pool.query(createScheduleTableQuery)
  .then(() => console.log("Schedule table ready!"))
  .catch((err) => console.error("Error creating schedule table:", err));

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

app.post('/api/auth/signup', async (req, res) => {
  const { username, email, password, phone, age, gender, role, referralSource, referralDetail, athletes } = req.body;
  try {
    const userCheck = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: "User already exists with this email." });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const insertResult = await pool.query(
      `INSERT INTO users (username, email, password, phone, age, gender, role, referral_source, referral_detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [username, email, hashedPassword, phone || null, age ? parseInt(age) : null, gender || null, role || null, referralSource || null, referralDetail || null]
    );
    const userId = insertResult.rows[0].id;
    if (role === 'parent_guardian' && Array.isArray(athletes) && athletes.length > 0) {
      for (const athlete of athletes) {
        if (athlete.name || athlete.age || athlete.gender) {
          await pool.query(
            "INSERT INTO athletes (user_id, name, age, gender) VALUES ($1, $2, $3, $4)",
            [userId, athlete.name || null, athlete.age ? parseInt(athlete.age) : null, athlete.gender || null]
          );
        }
      }
    }
    setLoginCookie(res, userId);
    res.status(201).json({ message: "User registered successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error during registration." });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) return res.status(400).json({ error: "Invalid email or password." });
    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: "Invalid email or password." });
    setLoginCookie(res, user.id);
    res.json({ message: "Logged in successfully!", user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error during login." });
  }
});

app.get('/api/auth/status', (req, res) => {
  const cookies = req.headers.cookie;
  if (cookies && cookies.includes('userId=')) return res.json({ loggedIn: true });
  res.json({ loggedIn: false });
});

app.get('/api/auth/me', async (req, res) => {
  const userId = getUserIdFromCookies(req);
  if (!userId) return res.status(401).json({ error: "Not logged in." });
  try {
    const result = await pool.query(
      "SELECT id, username, email, phone, age, gender, is_admin FROM users WHERE id = $1", [userId]
    );
    if (result.rows.length === 0) return res.status(401).json({ error: "Not logged in." });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error fetching user." });
  }
});

app.patch('/api/auth/profile', async (req, res) => {
  const userId = getUserIdFromCookies(req);
  if (!userId) return res.status(401).json({ error: "Please sign in." });
  const { phone, age, gender } = req.body;
  try {
    await pool.query(`UPDATE users SET phone = $1, age = $2, gender = $3 WHERE id = $4`,
      [phone || null, age ? parseInt(age) : null, gender || null, userId]);
    res.json({ message: "Profile updated successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error updating profile." });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('userId');
  res.json({ message: "Logged out successfully." });
});

// --- ADMIN ROUTES ---

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, u.phone, u.age, u.gender,
              u.role, u.referral_source, u.referral_detail, u.is_admin,
              COALESCE(json_agg(json_build_object('name',a.name,'age',a.age,'gender',a.gender))
                FILTER (WHERE a.id IS NOT NULL), '[]') AS athletes
       FROM users u
       LEFT JOIN athletes a ON a.user_id = u.id
       GROUP BY u.id ORDER BY u.id ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error fetching users" });
  }
});

// --- SCHEDULE ROUTES ---

// GET /api/schedule — PUBLIC: anyone can read the schedule (used on all pages)
app.get('/api/schedule', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id, s.day_of_week, s.category, s.subcategory, s.start_time, s.end_time,
              u.username AS created_by
       FROM schedule s
       LEFT JOIN users u ON s.created_by = u.id
       ORDER BY
         CASE s.day_of_week
           WHEN 'Monday'    THEN 1
           WHEN 'Tuesday'   THEN 2
           WHEN 'Wednesday' THEN 3
           WHEN 'Thursday'  THEN 4
           WHEN 'Friday'    THEN 5
           WHEN 'Saturday'  THEN 6
         END,
         s.start_time ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error fetching schedule." });
  }
});

// POST /api/schedule — ADMIN ONLY: add a slot
app.post('/api/schedule', requireAdmin, async (req, res) => {
  const userId = getUserIdFromCookies(req);
  const { day, category, subcategory, startTime, endTime } = req.body;

  if (!day || !category || !startTime || !endTime) {
    return res.status(400).json({ error: "Day, category, start time, and end time are all required." });
  }

  const validDays = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  if (!validDays.includes(day)) {
    return res.status(400).json({ error: "Invalid day." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO schedule (day_of_week, category, subcategory, start_time, end_time, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [day, category, subcategory || null, startTime, endTime, userId]
    );
    res.status(201).json({ message: "Schedule slot saved!", slot: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error saving schedule slot." });
  }
});

// DELETE /api/schedule/:id — ADMIN ONLY: remove a slot
app.delete('/api/schedule/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("DELETE FROM schedule WHERE id = $1 RETURNING id", [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Slot not found." });
    res.json({ message: "Schedule slot removed." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error removing slot." });
  }
});

// --- REVIEWS ---

app.post('/api/reviews', async (req, res) => {
  const userId = getUserIdFromCookies(req);
  if (!userId) return res.status(401).json({ error: "Please sign in to leave a review." });
  const { trainingType, comment, rating } = req.body;
  if (!trainingType || !comment || !rating) return res.status(400).json({ error: "Please fill out every field." });
  const ratingNum = parseInt(rating, 10);
  if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) return res.status(400).json({ error: "Rating must be 1–5." });
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
       FROM reviews JOIN users ON reviews.user_id = users.id
       ORDER BY reviews.created_at DESC LIMIT 20`
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
      await pool.query("UPDATE password_resets SET used = TRUE WHERE user_id = $1 AND used = FALSE", [user.id]);
      await pool.query("INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)", [user.id, token, expiresAt]);
      const resetLink = `https://kp12performance.com/reset-password.html?token=${token}`;
      await resend.emails.send({
        from: 'support@kp12performance.com',
        to: email,
        subject: 'Reset your KP12 Performance password',
        html: `<div style="background:#0D0E10;color:#F5F4F0;font-family:'Work Sans',Arial,sans-serif;max-width:520px;margin:0 auto;padding:48px 40px;border:1px solid #232529;"><img src="https://kp12performance.com/logo.png" alt="KP12 Performance" style="height:40px;margin-bottom:32px;display:block;"><p style="font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.15em;color:#8C8F96;margin-bottom:16px;">[ PASSWORD RESET ]</p><h1 style="font-size:28px;font-weight:700;text-transform:uppercase;margin:0 0 20px;">Hey ${user.username},</h1><p style="color:#8C8F96;font-size:15px;line-height:1.6;margin-bottom:32px;">We received a request to reset your KP12 Performance password. This link expires in <strong style="color:#F5F4F0;">1 hour</strong>.</p><a href="${resetLink}" style="display:inline-block;background:#B8FF3F;color:#0D0E10;font-family:'JetBrains Mono',monospace;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:16px 32px;margin-bottom:32px;">Reset Password</a><p style="color:#8C8F96;font-size:13px;line-height:1.5;border-top:1px solid #232529;padding-top:24px;margin-top:8px;">If you didn't request this, ignore this email.<br><br><a href="${resetLink}" style="color:#B8FF3F;word-break:break-all;">${resetLink}</a></p></div>`
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
  if (!token || !password) return res.status(400).json({ error: "Token and new password are required." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  try {
    const result = await pool.query(
      `SELECT * FROM password_resets WHERE token = $1 AND used = FALSE AND expires_at > NOW()`, [token]
    );
    if (result.rows.length === 0) return res.status(400).json({ error: "This reset link is invalid or has expired." });
    const resetRow = result.rows[0];
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hashedPassword, resetRow.user_id]);
    await pool.query("UPDATE password_resets SET used = TRUE WHERE id = $1", [resetRow.id]);
    setLoginCookie(res, resetRow.user_id);
    res.json({ message: "Password reset successfully! Redirecting you now..." });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});