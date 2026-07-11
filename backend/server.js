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
      ('swim-lessons', 5),
      ('speed-agility', 10),
      ('beach-volleyball', 20),
      ('sports-nutrition-consult', 10),
      ('intro-nutrition', 10),
      ('nutrition-check-ins', 10)
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

// Tracks which registered athletes (children) are attending a parent's booking
pool.query(`
  CREATE TABLE IF NOT EXISTS booking_athletes (
    id SERIAL PRIMARY KEY,
    booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
    athlete_name VARCHAR(100),
    athlete_age INTEGER,
    athlete_gender VARCHAR(30)
  );
`).then(() => console.log("Booking athletes table ready!"))
  .catch(err => console.error("Booking athletes:", err));

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
    const r = await pool.query("SELECT id,username,email,phone,age,gender,role,is_admin FROM users WHERE id=$1", [userId]);
    if (!r.rows.length) return res.status(401).json({ error: "Not logged in." });
    res.json({ user: r.rows[0] });
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

// GET /api/auth/my-athletes — returns logged-in user's registered athletes
app.get('/api/auth/my-athletes', async (req, res) => {
  const userId = getUserIdFromCookies(req);
  if (!userId) return res.status(401).json({ error: "Not logged in." });
  try {
    const result = await pool.query(
      "SELECT id, name, age, gender FROM athletes WHERE user_id = $1 ORDER BY id ASC",
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching athletes." });
  }
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

  const { serviceKey, serviceTitle, packageLabel, slots, selectedAthletes } = req.body;

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

    // ---- Send booking confirmation email ----
    try {
      const userResult = await pool.query("SELECT email, username FROM users WHERE id=$1", [userId]);
      if (userResult.rows.length > 0) {
        const userEmail = userResult.rows[0].email;
        const userName  = userResult.rows[0].username;

        const slotLines = slots
          .slice()
          .sort((a,b) => ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(a.day)
                       - ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(b.day))
          .map(s => `<tr>
              <td style="padding:10px 16px;font-family:'JetBrains Mono',monospace;font-size:13px;color:#F5F4F0;border-bottom:1px solid #232529;">${s.day}</td>
              <td style="padding:10px 16px;font-family:'JetBrains Mono',monospace;font-size:13px;color:#8C8F96;border-bottom:1px solid #232529;">${s.start} – ${s.end}</td>
            </tr>`)
          .join('');

        await resend.emails.send({
          from: 'support@kp12performance.com',
          to: userEmail,
          subject: `You're booked! — ${serviceTitle}`,
          html: `
            <div style="background:#0D0E10;color:#F5F4F0;font-family:'Work Sans',Arial,sans-serif;max-width:560px;margin:0 auto;padding:48px 40px;border:1px solid #232529;">
              <img src="https://kp12performance.com/logo.png" alt="KP12 Performance" style="height:40px;margin-bottom:32px;display:block;">
              <p style="font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.15em;color:#B8FF3F;margin-bottom:16px;">[ BOOKING CONFIRMED ]</p>
              <h1 style="font-size:30px;font-weight:900;text-transform:uppercase;margin:0 0 8px;line-height:1.1;">You're Booked,<br>${userName}!</h1>
              <p style="color:#8C8F96;font-size:15px;line-height:1.6;margin-bottom:32px;">
                Your session${slots.length > 1 ? 's are' : ' is'} confirmed. Here's what to expect this week — show up ready to work.
              </p>

              <div style="background:#15171A;border:1px solid #232529;border-top:3px solid #B8FF3F;padding:24px;margin-bottom:28px;">
                <p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.12em;color:#B8FF3F;margin:0 0 16px;">[ YOUR SESSIONS ]</p>
                <p style="font-size:16px;font-weight:700;text-transform:uppercase;margin:0 0 16px;">${serviceTitle}</p>
                ${packageLabel ? `<p style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#8C8F96;margin:0 0 20px;">${packageLabel}</p>` : ''}
                <table style="width:100%;border-collapse:collapse;border:1px solid #232529;">
                  <thead>
                    <tr style="background:#0D0E10;">
                      <th style="padding:10px 16px;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;color:#8C8F96;text-align:left;border-bottom:1px solid #232529;">DAY</th>
                      <th style="padding:10px 16px;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;color:#8C8F96;text-align:left;border-bottom:1px solid #232529;">TIME</th>
                    </tr>
                  </thead>
                  <tbody>${slotLines}</tbody>
                </table>
              </div>

              <p style="color:#8C8F96;font-size:14px;line-height:1.6;margin-bottom:24px;">
                You can view and manage your schedule anytime by visiting your account at
                <a href="https://kp12performance.com/my-schedule.html" style="color:#B8FF3F;">kp12performance.com/my-schedule.html</a>.
              </p>

              <p style="color:#8C8F96;font-size:13px;line-height:1.5;border-top:1px solid #232529;padding-top:24px;margin-top:8px;">
                Questions? Reach us at
                <a href="mailto:support@kp12performance.com" style="color:#B8FF3F;">support@kp12performance.com</a><br>
                © 2025 KP12 Performance. Let's get to work.
              </p>
            </div>`
        });
      }
    } catch (emailErr) {
      console.error("Booking confirmation email failed:", emailErr);
      // Don't fail the whole request just because email failed
    }

    // Save which athletes are attending (for parent/guardian bookings)
    if (Array.isArray(selectedAthletes) && selectedAthletes.length > 0) {
      for (const athlete of selectedAthletes) {
        await pool.query(
          "INSERT INTO booking_athletes (booking_id, athlete_name, athlete_age, athlete_gender) VALUES ($1,$2,$3,$4)",
          [bookingId, athlete.name || null, athlete.age ? parseInt(athlete.age) : null, athlete.gender || null]
        );
      }
    }

    // Send booking confirmation email
    try {
      const userResult = await pool.query("SELECT username, email FROM users WHERE id = $1", [userId]);
      const userInfo = userResult.rows[0];
      if (userInfo && userInfo.email) {
        const slotLines = slots
          .slice()
          .sort((a, b) => ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(a.day) - ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(b.day))
          .map(s => `<tr><td style="padding:10px 16px;border-bottom:1px solid #232529;font-family:'JetBrains Mono',monospace;font-size:13px;color:#B8FF3F;">${s.day}</td><td style="padding:10px 16px;border-bottom:1px solid #232529;font-family:'JetBrains Mono',monospace;font-size:13px;color:#F5F4F0;">${s.start} – ${s.end}</td></tr>`)
          .join('');

        await resend.emails.send({
          from: 'support@kp12performance.com',
          to: userInfo.email,
          subject: `You're booked — ${serviceTitle} | KP12 Performance`,
          html: `
            <div style="background:#0D0E10;color:#F5F4F0;font-family:'Work Sans',Arial,sans-serif;max-width:560px;margin:0 auto;padding:0;border:1px solid #232529;">
              <div style="background:#15171A;padding:32px 40px;border-bottom:1px solid #232529;">
                <img src="https://kp12performance.com/logo.png" alt="KP12 Performance" style="height:36px;display:block;">
              </div>
              <div style="padding:40px 40px 32px;">
                <p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.16em;color:#8C8F96;margin:0 0 16px;">[ BOOKING CONFIRMED ]</p>
                <h1 style="font-size:28px;font-weight:800;text-transform:uppercase;margin:0 0 8px;line-height:1.1;">You're Booked,<br>${userInfo.username}.</h1>
                <p style="color:#8C8F96;font-size:15px;line-height:1.6;margin:16px 0 32px;">Your sessions are locked in and we're ready to work. Here's a summary of what you've registered for this week.</p>

                <div style="background:#15171A;border:1px solid #232529;border-top:3px solid #B8FF3F;padding:24px;margin-bottom:28px;">
                  <p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.12em;color:#8C8F96;margin:0 0 6px;">SERVICE</p>
                  <p style="font-size:17px;font-weight:700;margin:0 0 16px;">${serviceTitle}</p>
                  ${packageLabel ? `<p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.12em;color:#8C8F96;margin:0 0 6px;">PACKAGE</p><p style="font-size:15px;margin:0;">${packageLabel}</p>` : ''}
                </div>

                <p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.12em;color:#8C8F96;margin:0 0 12px;">YOUR SESSIONS THIS WEEK</p>
                <table style="width:100%;border-collapse:collapse;background:#15171A;border:1px solid #232529;">
                  <thead>
                    <tr style="background:#1d1f23;">
                      <th style="padding:10px 16px;text-align:left;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;color:#8C8F96;">DAY</th>
                      <th style="padding:10px 16px;text-align:left;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;color:#8C8F96;">TIME</th>
                    </tr>
                  </thead>
                  <tbody>${slotLines}</tbody>
                </table>

                <p style="color:#8C8F96;font-size:14px;line-height:1.6;margin:28px 0 0;">If you need to make any changes or have questions before your session, reply to this email or reach out at <a href="mailto:support@kp12performance.com" style="color:#B8FF3F;">support@kp12performance.com</a>.</p>
              </div>
              <div style="padding:20px 40px;border-top:1px solid #232529;text-align:center;">
                <p style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#8C8F96;margin:0;">© 2025 KP12 Performance · kp12performance.com</p>
              </div>
            </div>
          `
        });
      }
    } catch (emailErr) {
      console.error('Booking confirmation email error:', emailErr);
      // Don't fail the booking if email fails — log and continue
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
              COALESCE(json_agg(DISTINCT jsonb_build_object('day',bs.day_of_week,'start',bs.start_time,'end',bs.end_time))
                FILTER (WHERE bs.id IS NOT NULL),'[]') AS slots,
              COALESCE(json_agg(DISTINCT jsonb_build_object('name',ba.athlete_name,'age',ba.athlete_age,'gender',ba.athlete_gender))
                FILTER (WHERE ba.id IS NOT NULL),'[]') AS attending_athletes
       FROM bookings b
       LEFT JOIN booking_slots bs ON bs.booking_id=b.id
       LEFT JOIN booking_athletes ba ON ba.booking_id=b.id
       WHERE b.user_id=$1 AND b.status='confirmed' GROUP BY b.id ORDER BY b.created_at DESC`,
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
              u.username, u.email, u.phone, u.age, u.role,
              COALESCE(json_agg(DISTINCT jsonb_build_object('day',bs.day_of_week,'start',bs.start_time,'end',bs.end_time))
                FILTER (WHERE bs.id IS NOT NULL),'[]') AS slots,
              COALESCE(json_agg(DISTINCT jsonb_build_object('name',ba.athlete_name,'age',ba.athlete_age,'gender',ba.athlete_gender))
                FILTER (WHERE ba.id IS NOT NULL),'[]') AS attending_athletes
       FROM bookings b
       JOIN users u ON b.user_id=u.id
       LEFT JOIN booking_slots bs ON bs.booking_id=b.id
       LEFT JOIN booking_athletes ba ON ba.booking_id=b.id
       WHERE b.week_of=$1 AND b.status='confirmed'
       GROUP BY b.id,u.username,u.email,u.phone,u.age,u.role ORDER BY b.created_at DESC`,
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

// POST /api/bookings/:id/complete — admin marks a booking as complete,
// sends a thank-you email, and frees up the capacity slot
app.post('/api/bookings/:id/complete', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    // Get booking + user details before updating
    const bookingResult = await pool.query(
      `SELECT b.id, b.service_title, b.package_label,
              u.email, u.username
       FROM bookings b
       JOIN users u ON b.user_id = u.id
       WHERE b.id = $1`,
      [id]
    );

    if (!bookingResult.rows.length) {
      return res.status(404).json({ error: "Booking not found." });
    }

    const booking = bookingResult.rows[0];

    // Mark as completed (frees up the capacity slot since count queries only look at 'confirmed')
    await pool.query(
      "UPDATE bookings SET status='completed', sessions_remaining=0 WHERE id=$1",
      [id]
    );

    // Send professional thank-you + review encouragement email
    try {
      await resend.emails.send({
        from: 'support@kp12performance.com',
        to: booking.email,
        subject: `Training Complete — Great Work, ${booking.username}!`,
        html: `
          <div style="background:#0D0E10;color:#F5F4F0;font-family:'Work Sans',Arial,sans-serif;max-width:560px;margin:0 auto;padding:48px 40px;border:1px solid #232529;">
            <img src="https://kp12performance.com/logo.png" alt="KP12 Performance" style="height:40px;margin-bottom:32px;display:block;">
            <p style="font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.15em;color:#B8FF3F;margin-bottom:16px;">[ SESSION COMPLETE ]</p>
            <h1 style="font-size:30px;font-weight:900;text-transform:uppercase;margin:0 0 8px;line-height:1.1;">You Put In<br>The Work, ${booking.username}.</h1>
            <p style="color:#8C8F96;font-size:15px;line-height:1.6;margin:20px 0 28px;">
              We want to take a moment to recognize your commitment. Completing your
              <strong style="color:#F5F4F0;">${booking.service_title}</strong> program
              ${booking.package_label ? '(' + booking.package_label + ')' : ''}
              takes consistency and dedication — and you showed up every time.
            </p>

            <div style="background:#15171A;border:1px solid #232529;border-left:3px solid #B8FF3F;padding:24px;margin-bottom:28px;">
              <p style="font-size:16px;font-weight:700;color:#F5F4F0;margin:0 0 10px;">What's next?</p>
              <p style="color:#8C8F96;font-size:14px;line-height:1.6;margin:0;">
                Progress doesn't stop here. Whether you're looking to level up your current program,
                try something new, or bring in a teammate — we're ready when you are.
                <br><br>
                <a href="https://kp12performance.com/tra.html" style="color:#B8FF3F;text-decoration:none;font-weight:600;">Browse Training Programs →</a>
                &nbsp;&nbsp;|&nbsp;&nbsp;
                <a href="https://kp12performance.com/ath.html" style="color:#B8FF3F;text-decoration:none;font-weight:600;">Explore Athletics →</a>
              </p>
            </div>

            <div style="background:#15171A;border:1px solid #232529;border-left:3px solid #FF5630;padding:24px;margin-bottom:28px;">
              <p style="font-size:15px;font-weight:700;color:#F5F4F0;margin:0 0 10px;">How did we do?</p>
              <p style="color:#8C8F96;font-size:14px;line-height:1.6;margin:0 0 16px;">
                Your feedback helps us improve and helps other athletes find the right program.
                It only takes 60 seconds and means a lot to our team.
              </p>
              <a href="https://kp12performance.com/review.html"
                 style="display:inline-block;background:#FF5630;color:#0D0E10;font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:14px 24px;font-weight:700;">
                Leave a Review →
              </a>
            </div>

            <p style="color:#8C8F96;font-size:13px;line-height:1.5;border-top:1px solid #232529;padding-top:24px;margin-top:8px;">
              Thank you for training with KP12 Performance. We'll see you on the other side of the next goal.<br><br>
              — The KP12 Team<br>
              <a href="mailto:support@kp12performance.com" style="color:#B8FF3F;">support@kp12performance.com</a>
            </p>
          </div>`
      });
    } catch (emailErr) {
      console.error("Completion email failed:", emailErr);
    }

    res.json({ message: "Booking marked complete and user notified." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error completing booking." });
  }
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

// POST /api/bookings/:id/complete — admin marks a booking complete
// Sends a thank-you email and frees the capacity slot
app.post('/api/bookings/:id/complete', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    // Mark as completed
    const bookingResult = await pool.query(
      `UPDATE bookings SET status='completed', sessions_remaining=0 WHERE id=$1
       RETURNING user_id, service_title, package_label, service_key`,
      [id]
    );
    if (!bookingResult.rows.length) {
      return res.status(404).json({ error: "Booking not found." });
    }
    const booking = bookingResult.rows[0];

    // Fetch the user's email + username for the thank-you email
    const userResult = await pool.query(
      "SELECT username, email FROM users WHERE id = $1",
      [booking.user_id]
    );
    const user = userResult.rows[0];

    // Send the professional thank-you email
    if (user && user.email) {
      try {
        await resend.emails.send({
          from: 'support@kp12performance.com',
          to: user.email,
          subject: `Thank You for Training with KP12 Performance — We'd Love Your Feedback`,
          html: `
            <div style="background:#0D0E10;color:#F5F4F0;font-family:'Work Sans',Arial,sans-serif;max-width:560px;margin:0 auto;padding:0;border:1px solid #232529;">
              <div style="background:#15171A;padding:32px 40px;border-bottom:1px solid #232529;">
                <img src="https://kp12performance.com/logo.png" alt="KP12 Performance" style="height:36px;display:block;">
              </div>
              <div style="padding:40px 40px 32px;">
                <p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.16em;color:#B8FF3F;margin:0 0 16px;">[ SESSION COMPLETE ]</p>
                <h1 style="font-size:26px;font-weight:800;text-transform:uppercase;margin:0 0 20px;line-height:1.15;">Thank You for<br>Training with Us,<br>${user.username}.</h1>

                <p style="color:#F5F4F0;font-size:15px;line-height:1.7;margin:0 0 16px;">
                  It was an honor working alongside you this week. Every rep, every session, and every moment of effort you put in is an investment in the athlete you're becoming — and that dedication doesn't go unnoticed.
                </p>
                <p style="color:#8C8F96;font-size:15px;line-height:1.7;margin:0 0 28px;">
                  We hope your experience with <strong style="color:#F5F4F0;">${booking.service_title}</strong> pushed you closer to your goals. Our coaches are committed to helping you reach the next level, and we'd love to keep that momentum going with you.
                </p>

                <div style="background:#15171A;border:1px solid #232529;border-left:3px solid #B8FF3F;padding:24px;margin-bottom:28px;">
                  <p style="font-size:16px;font-weight:600;margin:0 0 8px;">How did we do?</p>
                  <p style="color:#8C8F96;font-size:14px;line-height:1.6;margin:0 0 16px;">Your feedback means everything to us. A quick review helps us improve and lets other athletes know what to expect.</p>
                  <a href="https://kp12performance.com/review.html" style="display:inline-block;background:#B8FF3F;color:#0D0E10;font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:13px 24px;font-weight:600;">Leave a Review →</a>
                </div>

                <div style="background:#15171A;border:1px solid #232529;border-left:3px solid #232529;padding:24px;margin-bottom:28px;">
                  <p style="font-size:15px;font-weight:600;margin:0 0 8px;">Ready for Your Next Block?</p>
                  <p style="color:#8C8F96;font-size:14px;line-height:1.6;margin:0 0 16px;">Don't lose the momentum you've built. Book your next sessions now and keep making progress toward your goals.</p>
                  <a href="https://kp12performance.com/tra.html" style="display:inline-block;background:transparent;color:#F5F4F0;font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:13px 24px;border:1px solid #3a3d42;">Book Again →</a>
                </div>

                <p style="color:#8C8F96;font-size:13px;line-height:1.6;margin:0;">
                  Questions or want to talk about what's next for your training? We're always here —
                  <a href="mailto:support@kp12performance.com" style="color:#B8FF3F;">support@kp12performance.com</a>
                </p>
              </div>
              <div style="padding:20px 40px;border-top:1px solid #232529;text-align:center;">
                <p style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#8C8F96;margin:0;">© 2025 KP12 Performance · kp12performance.com</p>
              </div>
            </div>
          `
        });
      } catch (emailErr) {
        console.error('Thank-you email error:', emailErr);
        // Don't fail the complete action if email fails
      }
    }

    res.json({ message: "Booking marked complete. Thank-you email sent." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error completing booking." });
  }
});

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