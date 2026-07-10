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

// ---- Helpers ----
function timeToMinutes(t) {
  if (!t) return 0;
  const parts = t.trim().split(' ');
  const [h, m] = parts[0].split(':').map(Number);
  const period = parts[1];
  let hours = h;
  if (period === 'PM' && h !== 12) hours = h + 12;
  if (period === 'AM' && h === 12) hours = 0;
  return hours * 60 + (m || 0);
}

const DAYS_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// Parses session count from package label e.g. "4 Sessions" -> 4, "Drop In" -> null
function parseSessionCount(label) {
  if (!label) return null;
  const match = label.match(/^(\d+)\s+session/i);
  return match ? parseInt(match[1]) : null;
}

function sortSlots(rows) {
  return [...rows].sort((a, b) => {
    const di = DAYS_ORDER.indexOf(a.day_of_week) - DAYS_ORDER.indexOf(b.day_of_week);
    if (di !== 0) return di;
    return timeToMinutes(a.start_time) - timeToMinutes(b.start_time);
  });
}

function currentWeekMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  return mon.toISOString().split('T')[0];
}

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
    if (result.rows.length === 0 || !result.rows[0].is_admin)
      return res.status(403).json({ error: "Admin access required." });
    next();
  } catch (err) {
    res.status(500).json({ error: "Database error." });
  }
}

// ---- Startup ----
pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL
  );
`).then(() => pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;`))
  .then(() => pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(30), ADD COLUMN IF NOT EXISTS age INTEGER, ADD COLUMN IF NOT EXISTS gender VARCHAR(30);`))
  .then(() => pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(30), ADD COLUMN IF NOT EXISTS referral_source VARCHAR(60), ADD COLUMN IF NOT EXISTS referral_detail TEXT;`))
  .then(() => pool.query("UPDATE users SET is_admin = TRUE WHERE email = 'geraldcgarcia7@gmail.com';"))
  .then(() => console.log("Users table ready!"))
  .catch(err => console.error("User setup error:", err));

pool.query(`
  CREATE TABLE IF NOT EXISTS athletes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100), age INTEGER, gender VARCHAR(30),
    created_at TIMESTAMP DEFAULT NOW()
  );
`).catch(err => console.error("Athletes:", err));

pool.query(`
  CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    training_type VARCHAR(50) NOT NULL,
    comment TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    created_at TIMESTAMP DEFAULT NOW()
  );
`).catch(err => console.error("Reviews:", err));

pool.query(`
  CREATE TABLE IF NOT EXISTS password_resets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
  );
`).catch(err => console.error("Password resets:", err));

pool.query(`
  CREATE TABLE IF NOT EXISTS schedule (
    id SERIAL PRIMARY KEY,
    day_of_week VARCHAR(10) NOT NULL,
    category VARCHAR(20) NOT NULL,
    subcategory VARCHAR(60),
    start_time VARCHAR(10) NOT NULL,
    end_time VARCHAR(10) NOT NULL,
    week_of DATE,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
  );
`).then(() => pool.query(`ALTER TABLE schedule ADD COLUMN IF NOT EXISTS week_of DATE;`))
  .then(() => console.log("Schedule table ready!"))
  .catch(err => console.error("Schedule:", err));

// Service capacity table — defines max spots per service
pool.query(`
  CREATE TABLE IF NOT EXISTS service_capacity (
    service_key VARCHAR(60) PRIMARY KEY,
    max_spots INTEGER NOT NULL
  );
`).then(() => {
  // Seed capacities — ON CONFLICT DO NOTHING so manual edits aren't overwritten
  return pool.query(`
    INSERT INTO service_capacity (service_key, max_spots) VALUES
      ('sports-performance-training', 10),
      ('personal-training', 3),
      ('youth-performance-training', 8),
      ('adult-training', 10),
      ('remote-training', 10),
      ('swim-lessons', 5)
    ON CONFLICT (service_key) DO NOTHING;
  `);
}).then(() => console.log("Service capacity table ready!"))
  .catch(err => console.error("Service capacity:", err));

// Bookings table — one row per user per service per week
pool.query(`
  CREATE TABLE IF NOT EXISTS bookings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    service_key VARCHAR(60) NOT NULL,
    service_title VARCHAR(100),
    package_label VARCHAR(60),
    sessions_remaining INTEGER,
    week_of DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'confirmed',
    created_at TIMESTAMP DEFAULT NOW()
  );
`).then(() => pool.query(`
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS sessions_remaining INTEGER;
`)).then(() => console.log("Bookings table ready!"))
  .catch(err => console.error("Bookings:", err));

// Tracks which days sessions have already been auto-decremented (prevents double-decrement)
pool.query(`
  CREATE TABLE IF NOT EXISTS booking_decrements (
    id SERIAL PRIMARY KEY,
    booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
    decremented_date DATE NOT NULL,
    UNIQUE(booking_id, decremented_date)
  );
`).catch(err => console.error("Booking decrements:", err));

// Booking slots — the specific days/times a user picked within their booking
pool.query(`
  CREATE TABLE IF NOT EXISTS booking_slots (
    id SERIAL PRIMARY KEY,
    booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
    day_of_week VARCHAR(10),
    start_time VARCHAR(10),
    end_time VARCHAR(10)
  );
`).then(() => console.log("Booking slots table ready!"))
  .catch(err => console.error("Booking slots:", err));

// ---- Static ----
app.get('/', (req, res) => res.sendFile(path.resolve(__dirname, '..', 'frontend', 'index.html')));
app.get('/abt.html', (req, res) => res.sendFile(path.resolve(__dirname, '..', 'frontend', 'abt.html')));
app.get('/api/data', (req, res) => res.json({ message: "Hello from the backend!" }));

// ---- Auth ----
app.post('/api/auth/signup', async (req, res) => {
  const { username, email, password, phone, age, gender, role, referralSource, referralDetail, athletes } = req.body;
  try {
    const check = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (check.rows.length > 0) return res.status(400).json({ error: "User already exists." });
    const hash = await bcrypt.hash(password, 10);
    const ins = await pool.query(
      `INSERT INTO users (username, email, password, phone, age, gender, role, referral_source, referral_detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [username, email, hash, phone||null, age?parseInt(age):null, gender||null, role||null, referralSource||null, referralDetail||null]
    );
    const userId = ins.rows[0].id;
    if (role === 'parent_guardian' && Array.isArray(athletes)) {
      for (const a of athletes) {
        if (a.name || a.age || a.gender)
          await pool.query("INSERT INTO athletes (user_id,name,age,gender) VALUES ($1,$2,$3,$4)",
            [userId, a.name||null, a.age?parseInt(a.age):null, a.gender||null]);
      }
    }
    setLoginCookie(res, userId);
    res.status(201).json({ message: "Registered!" });
  } catch (err) { console.error(err); res.status(500).json({ error: "Registration error." }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (!result.rows.length) return res.status(400).json({ error: "Invalid email or password." });
    const user = result.rows[0];
    if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ error: "Invalid email or password." });
    setLoginCookie(res, user.id);
    res.json({ message: "Logged in!" });
  } catch (err) { res.status(500).json({ error: "Login error." }); }
});

app.get('/api/auth/status', (req, res) => {
  const cookies = req.headers.cookie;
  res.json({ loggedIn: !!(cookies && cookies.includes('userId=')) });
});

app.get('/api/auth/me', async (req, res) => {
  const userId = getUserIdFromCookies(req);
  if (!userId) return res.status(401).json({ error: "Not logged in." });
  try {
    const r = await pool.query("SELECT id,username,email,phone,age,gender,is_admin FROM users WHERE id=$1", [userId]);
    if (!r.rows.length) return res.status(401).json({ error: "Not logged in." });
    res.json({ user: r.rows[0] });
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

app.patch('/api/auth/profile', async (req, res) => {
  const userId = getUserIdFromCookies(req);
  if (!userId) return res.status(401).json({ error: "Sign in first." });
  const { phone, age, gender } = req.body;
  try {
    await pool.query("UPDATE users SET phone=$1,age=$2,gender=$3 WHERE id=$4",
      [phone||null, age?parseInt(age):null, gender||null, userId]);
    res.json({ message: "Profile updated." });
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

app.post('/api/auth/logout', (req, res) => { res.clearCookie('userId'); res.json({ message: "Logged out." }); });

// ---- Admin ----
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT u.id,u.username,u.email,u.phone,u.age,u.gender,u.role,
              u.referral_source,u.referral_detail,u.is_admin,
              COALESCE(json_agg(json_build_object('name',a.name,'age',a.age,'gender',a.gender))
                FILTER (WHERE a.id IS NOT NULL),'[]') AS athletes
       FROM users u LEFT JOIN athletes a ON a.user_id=u.id
       GROUP BY u.id ORDER BY u.id ASC`
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

// ---- Schedule ----
app.get('/api/schedule', async (req, res) => {
  try {
    const weekOf = currentWeekMonday();
    const r = await pool.query(
      `SELECT s.id,s.day_of_week,s.category,s.subcategory,s.start_time,s.end_time,s.week_of,
              u.username AS created_by
       FROM schedule s LEFT JOIN users u ON s.created_by=u.id
       WHERE s.week_of=$1 OR s.week_of IS NULL`, [weekOf]
    );
    res.json(sortSlots(r.rows));
  } catch (err) { res.status(500).json({ error: "Error fetching schedule." }); }
});

app.post('/api/schedule', requireAdmin, async (req, res) => {
  const userId = getUserIdFromCookies(req);
  const { day, category, subcategory, startTime, endTime } = req.body;
  if (!day || !category || !startTime || !endTime)
    return res.status(400).json({ error: "All fields required." });
  if (!DAYS_ORDER.includes(day)) return res.status(400).json({ error: "Invalid day." });
  try {
    const weekOf = currentWeekMonday();
    const r = await pool.query(
      `INSERT INTO schedule (day_of_week,category,subcategory,start_time,end_time,week_of,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [day, category, subcategory||null, startTime, endTime, weekOf, userId]
    );
    res.status(201).json({ message: "Slot saved!", slot: r.rows[0] });
  } catch (err) { res.status(500).json({ error: "Error saving slot." }); }
});

app.patch('/api/schedule/:id', requireAdmin, async (req, res) => {
  const { startTime, endTime } = req.body;
  if (!startTime || !endTime) return res.status(400).json({ error: "Times required." });
  try {
    const r = await pool.query(
      "UPDATE schedule SET start_time=$1,end_time=$2 WHERE id=$3 RETURNING *",
      [startTime, endTime, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Not found." });
    res.json({ message: "Updated!", slot: r.rows[0] });
  } catch (err) { res.status(500).json({ error: "Error updating slot." }); }
});

app.delete('/api/schedule/:id', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query("DELETE FROM schedule WHERE id=$1 RETURNING id", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: "Not found." });
    res.json({ message: "Deleted." });
  } catch (err) { res.status(500).json({ error: "Error deleting slot." }); }
});

app.delete('/api/schedule', requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM schedule WHERE week_of=$1 OR week_of IS NULL", [currentWeekMonday()]);
    res.json({ message: "Schedule cleared." });
  } catch (err) { res.status(500).json({ error: "Error clearing schedule." }); }
});

// ---- Capacity ----

// GET /api/capacity — public, returns spots taken + max for each service this week
app.get('/api/capacity', async (req, res) => {
  try {
    const weekOf = currentWeekMonday();

    // Get all capacities
    const capResult = await pool.query("SELECT service_key, max_spots FROM service_capacity");

    // Count confirmed bookings per service this week
    const bookingsResult = await pool.query(
      `SELECT service_key, COUNT(*) AS taken
       FROM bookings
       WHERE week_of = $1 AND status = 'confirmed'
       GROUP BY service_key`,
      [weekOf]
    );

    const takenMap = {};
    bookingsResult.rows.forEach(r => { takenMap[r.service_key] = parseInt(r.taken); });

    const capacity = {};
    capResult.rows.forEach(r => {
      capacity[r.service_key] = {
        max: r.max_spots,
        taken: takenMap[r.service_key] || 0,
        available: r.max_spots - (takenMap[r.service_key] || 0)
      };
    });

    res.json(capacity);
  } catch (err) { console.error(err); res.status(500).json({ error: "Error fetching capacity." }); }
});

// ---- Bookings ----

// POST /api/bookings — create a booking (must be logged in, checks capacity)
app.post('/api/bookings', async (req, res) => {
  const userId = getUserIdFromCookies(req);
  if (!userId) return res.status(401).json({ error: "Please sign in to book a session." });

  const { serviceKey, serviceTitle, packageLabel, slots } = req.body;

  if (!serviceKey || !serviceTitle || !slots || !slots.length)
    return res.status(400).json({ error: "Missing booking details." });

  try {
    const weekOf = currentWeekMonday();

    // Check if user already has a confirmed booking for this service this week
    const existingCheck = await pool.query(
      "SELECT id FROM bookings WHERE user_id=$1 AND service_key=$2 AND week_of=$3 AND status='confirmed'",
      [userId, serviceKey, weekOf]
    );
    if (existingCheck.rows.length > 0) {
      return res.status(409).json({ error: "You already have a booking for this service this week." });
    }

    // Check capacity
    const capResult = await pool.query("SELECT max_spots FROM service_capacity WHERE service_key=$1", [serviceKey]);
    if (capResult.rows.length > 0) {
      const max = capResult.rows[0].max_spots;
      const takenResult = await pool.query(
        "SELECT COUNT(*) AS taken FROM bookings WHERE service_key=$1 AND week_of=$2 AND status='confirmed'",
        [serviceKey, weekOf]
      );
      const taken = parseInt(takenResult.rows[0].taken);
      if (taken >= max) {
        return res.status(409).json({ error: "This service is fully booked for the week. Please check back next week." });
      }
    }

    // Create the booking
    const sessionsRemaining = parseSessionCount(packageLabel);

    const bookingResult = await pool.query(
      `INSERT INTO bookings (user_id, service_key, service_title, package_label, sessions_remaining, week_of, status)
       VALUES ($1,$2,$3,$4,$5,$6,'confirmed') RETURNING id`,
      [userId, serviceKey, serviceTitle, packageLabel||null, sessionsRemaining, weekOf]
    );
    const bookingId = bookingResult.rows[0].id;

    // Save each selected slot
    for (const slot of slots) {
      await pool.query(
        "INSERT INTO booking_slots (booking_id, day_of_week, start_time, end_time) VALUES ($1,$2,$3,$4)",
        [bookingId, slot.day, slot.start, slot.end]
      );
    }

    res.status(201).json({ message: "Booking confirmed!", bookingId });
  } catch (err) { console.error(err); res.status(500).json({ error: "Error creating booking." }); }
});

// GET /api/bookings/mine — logged-in user's bookings
app.get('/api/bookings/mine', async (req, res) => {
  const userId = getUserIdFromCookies(req);
  if (!userId) return res.status(401).json({ error: "Sign in first." });
  try {
    const r = await pool.query(
      `SELECT b.id,b.service_title,b.package_label,b.sessions_remaining,b.week_of,b.status,b.created_at,
              COALESCE(json_agg(json_build_object('day',bs.day_of_week,'start',bs.start_time,'end',bs.end_time))
                FILTER (WHERE bs.id IS NOT NULL),'[]') AS slots
       FROM bookings b LEFT JOIN booking_slots bs ON bs.booking_id=b.id
       WHERE b.user_id=$1 GROUP BY b.id ORDER BY b.created_at DESC`,
      [userId]
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

// GET /api/bookings — admin: all bookings
app.get('/api/bookings', requireAdmin, async (req, res) => {
  try {
    const weekOf = currentWeekMonday();
    const r = await pool.query(
      `SELECT b.id,b.service_key,b.service_title,b.package_label,b.sessions_remaining,b.status,b.created_at,
              u.username, u.email, u.phone, u.age,
              COALESCE(json_agg(json_build_object('day',bs.day_of_week,'start',bs.start_time,'end',bs.end_time))
                FILTER (WHERE bs.id IS NOT NULL),'[]') AS slots
       FROM bookings b
       JOIN users u ON b.user_id=u.id
       LEFT JOIN booking_slots bs ON bs.booking_id=b.id
       WHERE b.week_of=$1
       GROUP BY b.id,u.username,u.email,u.phone,u.age ORDER BY b.created_at DESC`,
      [weekOf]
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

// DELETE /api/bookings/:id — admin can cancel a booking
app.delete('/api/bookings/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query("UPDATE bookings SET status='cancelled' WHERE id=$1", [req.params.id]);
    res.json({ message: "Booking cancelled." });
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

// ---- Reviews ----
app.post('/api/reviews', async (req, res) => {
  const userId = getUserIdFromCookies(req);
  if (!userId) return res.status(401).json({ error: "Sign in first." });
  const { trainingType, comment, rating } = req.body;
  if (!trainingType || !comment || !rating) return res.status(400).json({ error: "Fill all fields." });
  const rNum = parseInt(rating);
  if (isNaN(rNum) || rNum < 1 || rNum > 5) return res.status(400).json({ error: "Rating must be 1–5." });
  try {
    await pool.query("INSERT INTO reviews (user_id,training_type,comment,rating) VALUES ($1,$2,$3,$4)",
      [userId, trainingType, comment, rNum]);
    res.status(201).json({ message: "Review submitted!" });
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

app.get('/api/reviews', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT reviews.id,reviews.training_type,reviews.comment,reviews.rating,reviews.created_at,users.username
       FROM reviews JOIN users ON reviews.user_id=users.id ORDER BY reviews.created_at DESC LIMIT 20`
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

app.delete('/api/reviews/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM reviews WHERE id=$1", [req.params.id]);
    res.json({ message: "Deleted." });
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

// ---- Password Reset ----
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Provide your email." });
  try {
    const r = await pool.query("SELECT id,username FROM users WHERE email=$1", [email]);
    if (r.rows.length > 0) {
      const user = r.rows[0];
      const token = crypto.randomBytes(32).toString('hex');
      const exp = new Date(Date.now() + 3600000);
      await pool.query("UPDATE password_resets SET used=TRUE WHERE user_id=$1 AND used=FALSE", [user.id]);
      await pool.query("INSERT INTO password_resets (user_id,token,expires_at) VALUES ($1,$2,$3)", [user.id, token, exp]);
      const link = `https://kp12performance.com/reset-password.html?token=${token}`;
      await resend.emails.send({
        from: 'support@kp12performance.com', to: email,
        subject: 'Reset your KP12 Performance password',
        html: `<div style="background:#0D0E10;color:#F5F4F0;font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:48px 40px;border:1px solid #232529;"><h1 style="font-size:24px;margin-bottom:20px;">Hey ${user.username},</h1><p style="color:#8C8F96;margin-bottom:32px;">Reset your password — link expires in 1 hour.</p><a href="${link}" style="background:#B8FF3F;color:#000;padding:14px 28px;text-decoration:none;font-weight:bold;display:inline-block;">Reset Password</a><p style="color:#8C8F96;font-size:12px;margin-top:32px;word-break:break-all;">${link}</p></div>`
      });
    }
    res.json({ message: "If that email is registered, a reset link is on its way." });
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: "Token and password required." });
  if (password.length < 8) return res.status(400).json({ error: "Min 8 characters." });
  try {
    const r = await pool.query(
      "SELECT * FROM password_resets WHERE token=$1 AND used=FALSE AND expires_at>NOW()", [token]);
    if (!r.rows.length) return res.status(400).json({ error: "Invalid or expired link." });
    const row = r.rows[0];
    await pool.query("UPDATE users SET password=$1 WHERE id=$2", [await bcrypt.hash(password,10), row.user_id]);
    await pool.query("UPDATE password_resets SET used=TRUE WHERE id=$1", [row.id]);
    setLoginCookie(res, row.user_id);
    res.json({ message: "Password reset!" });
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

// ---- Auto-decrement sessions for today's day ----
// Runs once at server startup. Since Render keeps the server running,
// this fires once per deployment/restart. For fully automatic daily runs,
// add node-cron later.
async function autoDecrementSessions() {
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const todayName = dayNames[new Date().getDay()];
  if (todayName === 'Sunday') return;

  const weekOf = currentWeekMonday();
  const todayStr = new Date().toISOString().split('T')[0];

  try {
    const result = await pool.query(
      `SELECT DISTINCT b.id
       FROM bookings b
       JOIN booking_slots bs ON bs.booking_id = b.id
       WHERE b.week_of = $1
         AND bs.day_of_week = $2
         AND b.status = 'confirmed'
         AND (b.sessions_remaining IS NULL OR b.sessions_remaining > 0)
         AND NOT EXISTS (
           SELECT 1 FROM booking_decrements bd
           WHERE bd.booking_id = b.id AND bd.decremented_date = $3
         )`,
      [weekOf, todayName, todayStr]
    );

    for (const row of result.rows) {
      await pool.query(
        `UPDATE bookings
         SET sessions_remaining = GREATEST(0, COALESCE(sessions_remaining, 1) - 1)
         WHERE id = $1`,
        [row.id]
      );
      await pool.query(
        `INSERT INTO booking_decrements (booking_id, decremented_date)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [row.id, todayStr]
      );
    }

    if (result.rows.length > 0) {
      console.log(`Auto-decremented ${result.rows.length} booking(s) for ${todayName}`);
    }
  } catch (err) {
    console.error('Auto-decrement error:', err);
  }
}

// PATCH /api/bookings/:id/sessions — admin adjusts sessions_remaining for a user
app.patch('/api/bookings/:id/sessions', requireAdmin, async (req, res) => {
  const { sessions } = req.body;
  if (sessions === undefined || sessions === null || isNaN(parseInt(sessions))) {
    return res.status(400).json({ error: "Valid session count required." });
  }
  const count = Math.max(0, parseInt(sessions));
  try {
    const r = await pool.query(
      "UPDATE bookings SET sessions_remaining = $1 WHERE id = $2 RETURNING id, sessions_remaining",
      [count, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Booking not found." });
    res.json({ message: "Sessions updated.", sessions_remaining: r.rows[0].sessions_remaining });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error updating sessions." });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // Run auto-decrement after a short delay so tables are ready
  setTimeout(autoDecrementSessions, 3000);
});