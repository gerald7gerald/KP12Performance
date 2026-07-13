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
  .then(() => pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image TEXT;`))
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
    image_data TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  );
`).then(() => pool.query(`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS image_data TEXT;`))
  .catch(err => console.error("Reviews:", err));

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
    max_spots INTEGER DEFAULT NULL,
    week_of DATE,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
  );
`).then(() => pool.query(`ALTER TABLE schedule ADD COLUMN IF NOT EXISTS week_of DATE;`))
  .then(() => pool.query(`ALTER TABLE schedule ADD COLUMN IF NOT EXISTS max_spots INTEGER DEFAULT NULL;`))
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
      ('swim-team-clinic', 20),
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

    // --- Welcome email to new user ---
    try {
      await resend.emails.send({
        from: 'support@kp12performance.com',
        to: email,
        subject: `Welcome to KP12 Performance, ${username}!`,
        html: `
          <div style="background:#0D0E10;color:#F5F4F0;font-family:'Work Sans',Arial,sans-serif;max-width:560px;margin:0 auto;padding:0;border:1px solid #232529;">
            <div style="background:#15171A;padding:32px 40px;border-bottom:3px solid #3D9EFF;">
              <img src="https://kp12performance.com/logo.png" alt="KP12 Performance" style="height:36px;display:block;">
            </div>
            <div style="padding:40px 40px 32px;">
              <p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.16em;color:#3D9EFF;margin:0 0 16px;">[ WELCOME TO KP12 ]</p>
              <h1 style="font-size:26px;font-weight:800;text-transform:uppercase;margin:0 0 20px;line-height:1.15;">You're in, ${username}.</h1>
              <p style="color:#F5F4F0;font-size:15px;line-height:1.7;margin:0 0 24px;">Your account is all set. We're glad to have you — now let's get to work.</p>

              <div style="background:#15171A;border:1px solid #232529;border-left:3px solid #FF5630;padding:22px 24px;margin-bottom:24px;">
                <p style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.14em;color:#FF5630;margin:0 0 8px;">[ TRAINING EXCLUSIVE ]</p>
                <p style="font-size:16px;font-weight:700;margin:0 0 8px;">Free Initial Assessment</p>
                <p style="color:#8C8F96;font-size:14px;line-height:1.6;margin:0 0 16px;">
                  As a new member, you're eligible for a <strong style="color:#F5F4F0;">free initial assessment</strong> with our training team.
                  We'll evaluate your current fitness level and map out exactly what your program should look like.
                  This is a <strong style="color:#F5F4F0;">Training-exclusive</strong> benefit — don't miss it.
                </p>
                <p style="color:#8C8F96;font-size:13px;line-height:1.6;margin:0 0 12px;">To claim your free assessment, simply send us an email and we'll get you scheduled right away.</p>
                <a href="mailto:performancekp12@gmail.com?subject=Free%20Initial%20Assessment%20Request&body=Hi%20KP12%20team%2C%20I%20just%20signed%20up%20and%20would%20like%20to%20claim%20my%20free%20initial%20assessment." style="display:inline-block;background:#FF5630;color:#0D0E10;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:12px 22px;font-weight:600;">Email Us to Claim →</a>
              </div>

              <p style="color:#8C8F96;font-size:14px;line-height:1.65;margin:0 0 24px;">Browse all our programs — Athletics, Training, and Nutrition — and book your first session whenever you're ready.</p>
              <div style="display:flex;gap:12px;flex-wrap:wrap;">
                <a href="https://kp12performance.com/ath.html" style="display:inline-block;background:transparent;color:#3D9EFF;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:10px 18px;border:1px solid rgba(61,158,255,0.4);">Athletics</a>
                <a href="https://kp12performance.com/nut.html" style="display:inline-block;background:transparent;color:#2ECC71;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:10px 18px;border:1px solid rgba(46,204,113,0.4);">Nutrition</a>
              </div>
              <p style="color:#8C8F96;font-size:13px;line-height:1.6;margin:28px 0 16px;">Questions? Reach us at <a href="mailto:support@kp12performance.com" style="color:#3D9EFF;">support@kp12performance.com</a></p>
              <div style="background:#15171A;border:1px solid #2A2D31;border-left:3px solid #FFC247;padding:16px 20px;margin-top:16px;">
                <p style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;color:#FFC247;margin:0 0 6px;">[ CANCELLATION POLICY ]</p>
                <p style="font-size:13px;color:#F5F4F0;line-height:1.6;margin:0;">
                  Need to cancel? Please let us know at least <strong>6 hours before your session</strong>. Cancellations made less than 6 hours prior will be subject to a <strong>cancellation fee</strong>. To cancel, reply to this email or reach us at <a href="mailto:support@kp12performance.com" style="color:#FFC247;">support@kp12performance.com</a>.
                </p>
              </div>
            </div>
            <div style="padding:20px 40px;border-top:1px solid #232529;text-align:center;">
              <p style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#8C8F96;margin:0;">© 2025 KP12 Performance · kp12performance.com</p>
            </div>
          </div>
        `
      });
    } catch (e) { console.error('Welcome email error:', e); }

    // --- Notify admin team of new signup ---
    try {
      await resend.emails.send({
        from: 'support@kp12performance.com',
        to: ['performancekp12@gmail.com', 'geraldcgarcia7@gmail.com'],
        subject: `[NEW SIGNUP] ${username} just created an account`,
        html: `
          <div style="background:#0D0E10;color:#F5F4F0;font-family:'Work Sans',Arial,sans-serif;max-width:520px;margin:0 auto;padding:0;border:1px solid #232529;">
            <div style="background:#15171A;padding:24px 32px;border-bottom:3px solid #3D9EFF;">
              <img src="https://kp12performance.com/logo.png" alt="KP12 Performance" style="height:28px;display:block;margin-bottom:12px;">
              <p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.16em;color:#3D9EFF;margin:0;">[ NEW MEMBER ]</p>
            </div>
            <div style="padding:28px 32px;">
              <h2 style="font-size:20px;font-weight:700;text-transform:uppercase;margin:0 0 20px;">${username} just signed up.</h2>
              <div style="background:#15171A;border:1px solid #232529;border-left:3px solid #3D9EFF;padding:18px 20px;margin-bottom:20px;">
                <table style="width:100%;border-collapse:collapse;">
                  <tr><td style="padding:5px 0;font-family:'JetBrains Mono',monospace;font-size:10px;color:#8C8F96;width:80px;">EMAIL</td>
                      <td style="padding:5px 0;font-size:13px;"><a href="mailto:${email}" style="color:#3D9EFF;">${email}</a></td></tr>
                  ${phone ? `<tr><td style="padding:5px 0;font-family:'JetBrains Mono',monospace;font-size:10px;color:#8C8F96;">PHONE</td>
                      <td style="padding:5px 0;font-size:13px;">${phone}</td></tr>` : ''}
                  ${age ? `<tr><td style="padding:5px 0;font-family:'JetBrains Mono',monospace;font-size:10px;color:#8C8F96;">AGE</td>
                      <td style="padding:5px 0;font-size:13px;">${age}</td></tr>` : ''}
                  <tr><td style="padding:5px 0;font-family:'JetBrains Mono',monospace;font-size:10px;color:#8C8F96;">ROLE</td>
                      <td style="padding:5px 0;font-size:13px;">${role === 'parent_guardian' ? 'Parent / Guardian' : 'Athlete'}</td></tr>
                  ${referralSource ? `<tr><td style="padding:5px 0;font-family:'JetBrains Mono',monospace;font-size:10px;color:#8C8F96;">HEARD VIA</td>
                      <td style="padding:5px 0;font-size:13px;">${referralSource}${referralDetail ? ' — ' + referralDetail : ''}</td></tr>` : ''}
                </table>
              </div>
              <div style="text-align:center;">
                <a href="https://kp12performance.com/employee.html" style="display:inline-block;background:#3D9EFF;color:#0D0E10;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:12px 24px;font-weight:600;">View Member Directory →</a>
              </div>
            </div>
            <div style="padding:16px 32px;border-top:1px solid #232529;text-align:center;">
              <p style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#8C8F96;margin:0;">KP12 Performance · Internal Notification</p>
            </div>
          </div>
        `
      });
    } catch (e) { console.error('Signup notification error:', e); }

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
    const r = await pool.query("SELECT id,username,email,phone,age,gender,role,is_admin,profile_image FROM users WHERE id=$1", [userId]);
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

// PATCH /api/auth/profile-image — save or remove profile picture
app.patch('/api/auth/profile-image', async (req, res) => {
  const userId = getUserIdFromCookies(req);
  if (!userId) return res.status(401).json({ error: "Please sign in." });
  const { imageData } = req.body;
  const clean = (imageData && imageData.startsWith('data:image/')) ? imageData : null;
  try {
    await pool.query("UPDATE users SET profile_image=$1 WHERE id=$2", [clean, userId]);
    res.json({ message: "Profile picture updated.", profile_image: clean });
  } catch (err) { console.error(err); res.status(500).json({ error: "Error saving image." }); }
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
    // Get slots with max_spots
    const r = await pool.query(
      `SELECT s.id,s.day_of_week,s.category,s.subcategory,s.start_time,s.end_time,s.max_spots,s.week_of,
              u.username AS created_by
       FROM schedule s LEFT JOIN users u ON s.created_by=u.id
       WHERE s.week_of=$1 OR s.week_of IS NULL`, [weekOf]
    );

    // For each slot, count how many confirmed bookings include that day+time this week
    const slots = r.rows;
    const enriched = await Promise.all(slots.map(async (slot) => {
      if (!slot.max_spots) return { ...slot, spots_taken: null, spots_available: null };
      const countRes = await pool.query(
        `SELECT COALESCE(SUM(
           CASE
             WHEN u.role = 'parent_guardian' AND COALESCE(ba.cnt, 0) > 0 THEN ba.cnt
             ELSE 1
           END
         ), 0) AS taken
         FROM booking_slots bs
         JOIN bookings b ON b.id = bs.booking_id
         JOIN users u ON u.id = b.user_id
         LEFT JOIN (
           SELECT booking_id, COUNT(*) AS cnt
           FROM booking_athletes
           GROUP BY booking_id
         ) ba ON ba.booking_id = b.id
         WHERE b.week_of = $1
           AND b.status = 'confirmed'
           AND bs.day_of_week = $2
           AND bs.start_time = $3`,
        [weekOf, slot.day_of_week, slot.start_time]
      );
      const taken = parseInt(countRes.rows[0].taken) || 0;
      return { ...slot, spots_taken: taken, spots_available: slot.max_spots - taken };
    }));

    res.json(sortSlots(enriched));
  } catch (err) { console.error(err); res.status(500).json({ error: "Error fetching schedule." }); }
});

app.post('/api/schedule', requireAdmin, async (req, res) => {
  const userId = getUserIdFromCookies(req);
  const { day, category, subcategory, startTime, endTime, maxSpots } = req.body;
  if (!day || !category || !startTime || !endTime)
    return res.status(400).json({ error: "All fields required." });
  if (!DAYS_ORDER.includes(day)) return res.status(400).json({ error: "Invalid day." });
  const spotLimit = (maxSpots && parseInt(maxSpots) > 0) ? parseInt(maxSpots) : null;
  try {
    const weekOf = currentWeekMonday();
    const r = await pool.query(
      `INSERT INTO schedule (day_of_week,category,subcategory,start_time,end_time,max_spots,week_of,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [day, category, subcategory||null, startTime, endTime, spotLimit, weekOf, userId]
    );
    res.status(201).json({ message: "Slot saved!", slot: r.rows[0] });
  } catch (err) { res.status(500).json({ error: "Error saving slot." }); }
});

app.patch('/api/schedule/:id', requireAdmin, async (req, res) => {
  const { startTime, endTime, maxSpots } = req.body;
  if (!startTime || !endTime) return res.status(400).json({ error: "Times required." });
  const spotLimit = (maxSpots !== undefined) ? (parseInt(maxSpots) > 0 ? parseInt(maxSpots) : null) : undefined;
  try {
    const r = await pool.query(
      spotLimit !== undefined
        ? "UPDATE schedule SET start_time=$1,end_time=$2,max_spots=$3 WHERE id=$4 RETURNING *"
        : "UPDATE schedule SET start_time=$1,end_time=$2 WHERE id=$3 RETURNING *",
      spotLimit !== undefined
        ? [startTime, endTime, spotLimit, req.params.id]
        : [startTime, endTime, req.params.id]
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

    // Count confirmed spots per service this week — counting athletes for parent bookings
    const bookingsResult = await pool.query(
      `SELECT b.service_key,
              COALESCE(SUM(
                CASE
                  WHEN u.role = 'parent_guardian' AND COALESCE(ba.cnt, 0) > 0 THEN ba.cnt
                  ELSE 1
                END
              ), 0) AS taken
       FROM bookings b
       JOIN users u ON u.id = b.user_id
       LEFT JOIN (
         SELECT booking_id, COUNT(*) AS cnt FROM booking_athletes GROUP BY booking_id
       ) ba ON ba.booking_id = b.id
       WHERE b.week_of = $1 AND b.status = 'confirmed'
       GROUP BY b.service_key`,
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

    // Check overall service capacity
    const capResult = await pool.query("SELECT max_spots FROM service_capacity WHERE service_key=$1", [serviceKey]);
    if (capResult.rows.length > 0) {
      const max = capResult.rows[0].max_spots;
      const takenResult = await pool.query(
        `SELECT COALESCE(SUM(
           CASE
             WHEN u.role = 'parent_guardian' AND COALESCE(ba.cnt, 0) > 0 THEN ba.cnt
             ELSE 1
           END
         ), 0) AS taken
         FROM bookings b
         JOIN users u ON u.id = b.user_id
         LEFT JOIN (
           SELECT booking_id, COUNT(*) AS cnt FROM booking_athletes GROUP BY booking_id
         ) ba ON ba.booking_id = b.id
         WHERE b.service_key=$1 AND b.week_of=$2 AND b.status='confirmed'`,
        [serviceKey, weekOf]
      );
      const taken = parseInt(takenResult.rows[0].taken) || 0;
      if (taken >= max) {
        return res.status(409).json({ error: "This service is fully booked for the week. Please check back next week." });
      }
    }

    // Check per-slot capacity — each slot the user picked must have room
    if (Array.isArray(slots) && slots.length > 0) {
      for (const slot of slots) {
        // Get the max_spots for this specific schedule slot
        const slotCapRes = await pool.query(
          `SELECT max_spots FROM schedule
           WHERE day_of_week=$1 AND start_time=$2 AND category IS NOT NULL
             AND (week_of=$3 OR week_of IS NULL) LIMIT 1`,
          [slot.day, slot.start, weekOf]
        );
        if (slotCapRes.rows.length > 0 && slotCapRes.rows[0].max_spots) {
          const slotMax = slotCapRes.rows[0].max_spots;
          const slotTakenRes = await pool.query(
            `SELECT COALESCE(SUM(
               CASE
                 WHEN u.role = 'parent_guardian' AND COALESCE(ba.cnt, 0) > 0 THEN ba.cnt
                 ELSE 1
               END
             ), 0) AS taken
             FROM booking_slots bs
             JOIN bookings b ON b.id = bs.booking_id
             JOIN users u ON u.id = b.user_id
             LEFT JOIN (
               SELECT booking_id, COUNT(*) AS cnt
               FROM booking_athletes
               GROUP BY booking_id
             ) ba ON ba.booking_id = b.id
             WHERE b.week_of=$1 AND b.status='confirmed'
               AND bs.day_of_week=$2 AND bs.start_time=$3`,
            [weekOf, slot.day, slot.start]
          );
          const slotTaken = parseInt(slotTakenRes.rows[0].taken) || 0;

          // Also count the athletes in THIS booking being created
          const thisBookingCount = (Array.isArray(selectedAthletes) && selectedAthletes.length > 0)
            ? selectedAthletes.length : 1;
          if (slotTaken + thisBookingCount > slotMax) {
            const spotsLeft = Math.max(0, slotMax - slotTaken);
            return res.status(409).json({
              error: `The ${slot.day} ${slot.start} slot only has ${spotsLeft} spot${spotsLeft !== 1 ? 's' : ''} left. You're registering ${thisBookingCount} athlete${thisBookingCount !== 1 ? 's' : ''}.`
            });
          }
        }
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
              <p style="font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.15em;color:#3D9EFF;margin-bottom:16px;">[ BOOKING CONFIRMED ]</p>
              <h1 style="font-size:30px;font-weight:900;text-transform:uppercase;margin:0 0 8px;line-height:1.1;">You're Booked,<br>${userName}!</h1>
              <p style="color:#8C8F96;font-size:15px;line-height:1.6;margin-bottom:32px;">
                Your session${slots.length > 1 ? 's are' : ' is'} confirmed. Here's what to expect this week — show up ready to work.
              </p>

              <div style="background:#15171A;border:1px solid #232529;border-top:3px solid #3D9EFF;padding:24px;margin-bottom:28px;">
                <p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.12em;color:#3D9EFF;margin:0 0 16px;">[ YOUR SESSIONS ]</p>
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
                <a href="https://kp12performance.com/my-schedule.html" style="color:#3D9EFF;">kp12performance.com/my-schedule.html</a>.
              </p>

              <p style="color:#8C8F96;font-size:13px;line-height:1.5;border-top:1px solid #232529;padding-top:24px;margin-top:8px;">
                Questions? Reach us at
                <a href="mailto:support@kp12performance.com" style="color:#3D9EFF;">support@kp12performance.com</a><br>
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

    // Send booking confirmation email — lists each athlete individually for parent accounts
    try {
      const userResult = await pool.query("SELECT username, email, role FROM users WHERE id = $1", [userId]);
      const userInfo = userResult.rows[0];
      if (userInfo && userInfo.email) {
        const DAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const sortedSlots = (slots||[]).slice().sort((a,b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
        const isParent = userInfo.role === 'parent_guardian' && Array.isArray(selectedAthletes) && selectedAthletes.length > 0;

        const slotTableRows = sortedSlots.map(s => `
          <tr>
            <td style="padding:9px 14px;border-bottom:1px solid #232529;font-family:'JetBrains Mono',monospace;font-size:12px;color:#3D9EFF;">${s.day}</td>
            <td style="padding:9px 14px;border-bottom:1px solid #232529;font-family:'JetBrains Mono',monospace;font-size:12px;color:#F5F4F0;">${s.start} – ${s.end}</td>
          </tr>`).join('');

        const slotTable = `<table style="width:100%;border-collapse:collapse;background:#1d1f23;border:1px solid #232529;">
          <thead><tr>
            <th style="padding:8px 14px;text-align:left;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.1em;color:#8C8F96;">DAY</th>
            <th style="padding:8px 14px;text-align:left;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.1em;color:#8C8F96;">TIME</th>
          </tr></thead>
          <tbody>${slotTableRows}</tbody>
        </table>`;

        let bodyHtml = '';

        if (isParent) {
          const athleteCards = selectedAthletes.map((a, i) => `
            <div style="background:#15171A;border:1px solid #2A2D31;border-left:3px solid #3D9EFF;padding:20px 22px;margin-bottom:14px;border-radius:1px;">
              <p style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.14em;color:#3D9EFF;margin:0 0 5px;">
                ATHLETE ${i + 1} of ${selectedAthletes.length}
              </p>
              <p style="font-size:18px;font-weight:700;margin:0 0 3px;">
                ${a.name || 'Your Athlete'}${a.age ? ` <span style="font-size:13px;color:#8C8F96;font-weight:400;">age ${a.age}</span>` : ''}
              </p>
              <p style="font-size:13px;color:#8C8F96;margin:0 0 14px;">${serviceTitle}${packageLabel ? ' · ' + packageLabel : ''}</p>
              ${slotTable}
            </div>
          `).join('');

          bodyHtml = `
            <p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.16em;color:#3D9EFF;margin:0 0 14px;">[ BOOKING CONFIRMED ]</p>
            <h1 style="font-size:24px;font-weight:800;text-transform:uppercase;margin:0 0 6px;line-height:1.15;">You're all set, ${userInfo.username}! 🎉</h1>
            <p style="color:#8C8F96;font-size:15px;line-height:1.7;margin:14px 0 26px;">
              Great news — all ${selectedAthletes.length} of your athletes are officially registered and ready to train at KP12 Performance. Here's the breakdown:
            </p>
            ${athleteCards}
            <p style="color:#8C8F96;font-size:14px;line-height:1.65;margin:18px 0 16px;">
              Got questions before the session? We're always happy to help —
              <a href="mailto:support@kp12performance.com" style="color:#3D9EFF;">support@kp12performance.com</a>. 
              We can't wait to train with your athletes!
            </p>
              <div style="background:#15171A;border:1px solid #2A2D31;border-left:3px solid #FFC247;padding:16px 20px;margin-top:20px;">
                <p style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;color:#FFC247;margin:0 0 6px;">[ CANCELLATION POLICY ]</p>
                <p style="font-size:13px;color:#F5F4F0;line-height:1.6;margin:0;">
                  Need to cancel? Please let us know at least <strong>6 hours before your session</strong>. 
                  Cancellations made less than 6 hours prior will be subject to a <strong>cancellation fee</strong>. 
                  To cancel, reply to this email or contact us at 
                  <a href="mailto:support@kp12performance.com" style="color:#FFC247;">support@kp12performance.com</a>.
                </p>
              </div>`; 
        } else {
          bodyHtml = `
            <p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.16em;color:#3D9EFF;margin:0 0 14px;">[ BOOKING CONFIRMED ]</p>
            <h1 style="font-size:26px;font-weight:800;text-transform:uppercase;margin:0 0 6px;line-height:1.1;">You're Booked, ${userInfo.username}! 💪</h1>
            <p style="color:#8C8F96;font-size:15px;line-height:1.7;margin:14px 0 26px;">Your sessions are locked in and we're ready to work. Here's what you're signed up for this week:</p>
            <div style="background:#15171A;border:1px solid #2A2D31;border-top:3px solid #3D9EFF;padding:20px 22px;margin-bottom:18px;">
              <p style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;color:#8C8F96;margin:0 0 5px;">SERVICE</p>
              <p style="font-size:17px;font-weight:700;margin:0 0 ${packageLabel ? '14' : '0'}px;">${serviceTitle}</p>
              ${packageLabel ? `<p style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;color:#8C8F96;margin:0 0 5px;">PACKAGE</p><p style="font-size:15px;margin:0;">${packageLabel}</p>` : ''}
            </div>
            ${slotTable}
            <p style="color:#8C8F96;font-size:14px;line-height:1.6;margin:20px 0 14px;">
              Questions? Reach us at <a href="mailto:support@kp12performance.com" style="color:#3D9EFF;">support@kp12performance.com</a>
            </p>

              <div style="background:#1a1209;border:1px solid rgba(255,194,71,0.3);border-left:3px solid #FFC247;padding:16px 20px;margin-top:20px;">
                <p style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;color:#FFC247;margin:0 0 6px;">[ CANCELLATION POLICY ]</p>
                <p style="font-size:13px;color:#F5F4F0;line-height:1.6;margin:0;">
                  If you need to cancel or reschedule, please do so <strong>at least 6 hours before your session</strong>.
                  Cancellations made less than 6 hours prior will be subject to a <strong>cancellation fee</strong>.
                  To cancel, reply to this email or contact us at
                  <a href="mailto:support@kp12performance.com" style="color:#FFC247;">support@kp12performance.com</a>.
                </p>
              </div>
            `;
        }

        await resend.emails.send({
          from: 'support@kp12performance.com',
          to: userInfo.email,
          subject: isParent
            ? `${selectedAthletes.length} athletes booked — ${serviceTitle} | KP12 Performance`
            : `You're booked — ${serviceTitle} | KP12 Performance`,
          html: `<div style="background:#0D0E10;color:#F5F4F0;font-family:'Work Sans',Arial,sans-serif;max-width:580px;margin:0 auto;border:1px solid #232529;">
            <div style="background:#15171A;padding:26px 32px;border-bottom:1px solid #232529;">
              <img src="https://kp12performance.com/logo.png" alt="KP12 Performance" style="height:32px;display:block;">
            </div>
            <div style="padding:32px 32px 26px;">${bodyHtml}</div>
            <div style="padding:16px 32px;border-top:1px solid #232529;text-align:center;">
              <p style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#8C8F96;margin:0;">© 2025 KP12 Performance · kp12performance.com</p>
            </div>
          </div>`
        });
      }
    } catch (emailErr) {
      console.error('Booking confirmation email error:', emailErr);
    }

    // ---- Employee notification email ----
    // Sends to both admin emails whenever anyone books a session
    try {
      const notifUserResult = await pool.query(
        "SELECT username, email, phone, age, role FROM users WHERE id = $1", [userId]
      );
      const notifUser = notifUserResult.rows[0];

      if (notifUser) {
        const notifSlotLines = slots
          .slice()
          .sort((a, b) => ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(a.day) - ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(b.day))
          .map(s => `<tr>
            <td style="padding:9px 14px;border-bottom:1px solid #232529;font-family:'JetBrains Mono',monospace;font-size:12px;color:#3D9EFF;">${s.day}</td>
            <td style="padding:9px 14px;border-bottom:1px solid #232529;font-family:'JetBrains Mono',monospace;font-size:12px;color:#F5F4F0;">${s.start} – ${s.end}</td>
          </tr>`)
          .join('');

        // Fetch athletes if parent booking
        let athleteSection = '';
        if (Array.isArray(selectedAthletes) && selectedAthletes.length > 0) {
          const athleteRows = selectedAthletes
            .map(a => `<tr>
              <td style="padding:8px 14px;border-bottom:1px solid #232529;color:#F5F4F0;font-size:13px;">${a.name || '—'}</td>
              <td style="padding:8px 14px;border-bottom:1px solid #232529;color:#8C8F96;font-size:13px;">${a.age || '—'}</td>
              <td style="padding:8px 14px;border-bottom:1px solid #232529;color:#8C8F96;font-size:13px;">${a.gender || '—'}</td>
            </tr>`)
            .join('');
          athleteSection = `
            <p style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;color:#8C8F96;margin:20px 0 8px;">ATTENDING ATHLETES</p>
            <table style="width:100%;border-collapse:collapse;background:#15171A;border:1px solid #232529;">
              <thead>
                <tr style="background:#1d1f23;">
                  <th style="padding:8px 14px;text-align:left;font-family:'JetBrains Mono',monospace;font-size:10px;color:#8C8F96;">NAME</th>
                  <th style="padding:8px 14px;text-align:left;font-family:'JetBrains Mono',monospace;font-size:10px;color:#8C8F96;">AGE</th>
                  <th style="padding:8px 14px;text-align:left;font-family:'JetBrains Mono',monospace;font-size:10px;color:#8C8F96;">GENDER</th>
                </tr>
              </thead>
              <tbody>${athleteRows}</tbody>
            </table>`;
        }

        await resend.emails.send({
          from: 'support@kp12performance.com',
          to: ['performancekp12@gmail.com', 'geraldcgarcia7@gmail.com'],
          subject: `[NEW BOOKING] ${notifUser.username} — ${serviceTitle}`,
          html: `
            <div style="background:#0D0E10;color:#F5F4F0;font-family:'Work Sans',Arial,sans-serif;max-width:560px;margin:0 auto;padding:0;border:1px solid #232529;">
              <div style="background:#15171A;padding:24px 32px;border-bottom:3px solid #FF5630;">
                <img src="https://kp12performance.com/logo.png" alt="KP12 Performance" style="height:28px;display:block;margin-bottom:12px;">
                <p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.16em;color:#FF5630;margin:0;">[ NEW BOOKING ALERT ]</p>
              </div>
              <div style="padding:28px 32px;">
                <h2 style="font-size:20px;font-weight:700;text-transform:uppercase;margin:0 0 20px;line-height:1.2;">
                  ${notifUser.username} just booked a session.
                </h2>

                <div style="background:#15171A;border:1px solid #232529;border-left:3px solid #FF5630;padding:18px 20px;margin-bottom:20px;">
                  <table style="width:100%;border-collapse:collapse;">
                    <tr>
                      <td style="padding:6px 0;font-family:'JetBrains Mono',monospace;font-size:10px;color:#8C8F96;letter-spacing:0.1em;width:110px;">SERVICE</td>
                      <td style="padding:6px 0;font-size:14px;font-weight:600;color:#F5F4F0;">${serviceTitle}</td>
                    </tr>
                    ${packageLabel ? `<tr>
                      <td style="padding:6px 0;font-family:'JetBrains Mono',monospace;font-size:10px;color:#8C8F96;letter-spacing:0.1em;">PACKAGE</td>
                      <td style="padding:6px 0;font-size:14px;color:#F5F4F0;">${packageLabel}</td>
                    </tr>` : ''}
                    <tr>
                      <td style="padding:6px 0;font-family:'JetBrains Mono',monospace;font-size:10px;color:#8C8F96;letter-spacing:0.1em;">ROLE</td>
                      <td style="padding:6px 0;font-size:14px;color:#F5F4F0;">${notifUser.role === 'parent_guardian' ? 'Parent / Guardian' : 'Athlete'}</td>
                    </tr>
                  </table>
                </div>

                <p style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;color:#8C8F96;margin:0 0 8px;">CONTACT INFO</p>
                <div style="background:#15171A;border:1px solid #232529;padding:16px 20px;margin-bottom:20px;">
                  <table style="width:100%;border-collapse:collapse;">
                    <tr>
                      <td style="padding:5px 0;font-family:'JetBrains Mono',monospace;font-size:10px;color:#8C8F96;width:70px;">EMAIL</td>
                      <td style="padding:5px 0;font-size:13px;"><a href="mailto:${notifUser.email}" style="color:#3D9EFF;">${notifUser.email}</a></td>
                    </tr>
                    ${notifUser.phone ? `<tr>
                      <td style="padding:5px 0;font-family:'JetBrains Mono',monospace;font-size:10px;color:#8C8F96;">PHONE</td>
                      <td style="padding:5px 0;font-size:13px;"><a href="tel:${notifUser.phone}" style="color:#3D9EFF;">${notifUser.phone}</a></td>
                    </tr>` : ''}
                    ${notifUser.age ? `<tr>
                      <td style="padding:5px 0;font-family:'JetBrains Mono',monospace;font-size:10px;color:#8C8F96;">AGE</td>
                      <td style="padding:5px 0;font-size:13px;color:#F5F4F0;">${notifUser.age}</td>
                    </tr>` : ''}
                  </table>
                </div>

                <p style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;color:#8C8F96;margin:0 0 8px;">SELECTED TIMES</p>
                <table style="width:100%;border-collapse:collapse;background:#15171A;border:1px solid #232529;margin-bottom:4px;">
                  <thead>
                    <tr style="background:#1d1f23;">
                      <th style="padding:8px 14px;text-align:left;font-family:'JetBrains Mono',monospace;font-size:10px;color:#8C8F96;">DAY</th>
                      <th style="padding:8px 14px;text-align:left;font-family:'JetBrains Mono',monospace;font-size:10px;color:#8C8F96;">TIME</th>
                    </tr>
                  </thead>
                  <tbody>${notifSlotLines}</tbody>
                </table>

                ${athleteSection}

                <div style="margin-top:24px;padding-top:20px;border-top:1px solid #232529;text-align:center;">
                  <a href="https://kp12performance.com/employee.html" style="display:inline-block;background:#FF5630;color:#0D0E10;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:12px 24px;font-weight:600;">View in Employee Dashboard →</a>
                </div>
              </div>
              <div style="padding:16px 32px;border-top:1px solid #232529;text-align:center;">
                <p style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#8C8F96;margin:0;">KP12 Performance · Internal Notification</p>
              </div>
            </div>
          `
        });
        console.log(`Employee notification sent for booking by ${notifUser.username}`);
      }
    } catch (notifErr) {
      console.error('Employee notification email error:', notifErr);
      // Don't fail the booking if notification fails
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
  const { trainingType, comment, rating, imageData } = req.body;
  if (!trainingType || !comment || !rating) return res.status(400).json({ error: "Fill all fields." });
  const rNum = parseInt(rating);
  if (isNaN(rNum) || rNum < 1 || rNum > 5) return res.status(400).json({ error: "Rating must be 1–5." });
  const cleanImage = (imageData && typeof imageData === 'string' && imageData.startsWith('data:image/')) ? imageData : null;
  try {
    await pool.query("INSERT INTO reviews (user_id,training_type,comment,rating,image_data) VALUES ($1,$2,$3,$4,$5)",
      [userId, trainingType, comment, rNum, cleanImage]);
    // Notify employees of the new review
    try {
      const userResult = await pool.query("SELECT username, email FROM users WHERE id=$1", [userId]);
      const reviewer = userResult.rows[0];
      const stars = '★'.repeat(rNum) + '☆'.repeat(5 - rNum);
      await resend.emails.send({
        from: 'support@kp12performance.com',
        to: ['performancekp12@gmail.com', 'geraldcgarcia7@gmail.com'],
        subject: `[NEW REVIEW] ${reviewer?.username || 'A client'} left a ${rNum}-star review`,
        html: `<div style="background:#0D0E10;color:#F5F4F0;font-family:'Work Sans',Arial,sans-serif;max-width:520px;margin:0 auto;padding:0;border:1px solid #232529;"><div style="background:#15171A;padding:24px 32px;border-bottom:3px solid #2ECC71;"><img src="https://kp12performance.com/logo.png" alt="KP12 Performance" style="height:28px;display:block;margin-bottom:12px;"><p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.16em;color:#2ECC71;margin:0;">[ NEW REVIEW ]</p></div><div style="padding:28px 32px;"><h2 style="font-size:20px;font-weight:700;text-transform:uppercase;margin:0 0 20px;">${reviewer?.username || 'A client'} left a review.</h2><div style="background:#15171A;border:1px solid #232529;border-left:3px solid #2ECC71;padding:20px 24px;margin-bottom:20px;"><p style="font-size:22px;letter-spacing:4px;color:#2ECC71;margin:0 0 12px;">${stars}</p><p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.1em;color:#8C8F96;margin:0 0 8px;">SERVICE</p><p style="font-size:14px;color:#F5F4F0;margin:0 0 16px;">${trainingType}</p><p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.1em;color:#8C8F96;margin:0 0 8px;">REVIEW</p><p style="font-size:15px;color:#F5F4F0;line-height:1.6;margin:0;">"${comment}"</p></div>${reviewer?.email ? `<p style="font-size:13px;color:#8C8F96;">From: <a href="mailto:${reviewer.email}" style="color:#3D9EFF;">${reviewer.email}</a></p>` : ''}<div style="margin-top:24px;text-align:center;"><a href="https://kp12performance.com/review.html" style="display:inline-block;background:#2ECC71;color:#0D0E10;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:12px 24px;font-weight:600;">View All Reviews →</a></div></div><div style="padding:16px 32px;border-top:1px solid #232529;text-align:center;"><p style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#8C8F96;margin:0;">KP12 Performance · Internal Notification</p></div></div>`
      });
    } catch (emailErr) { console.error('Review notification error:', emailErr); }

    res.status(201).json({ message: "Review submitted!" });
  } catch (err) { res.status(500).json({ error: "Error." }); }
});

app.get('/api/reviews', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT reviews.id,reviews.training_type,reviews.comment,reviews.rating,reviews.created_at,users.username,users.profile_image
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
        html: `<div style="background:#0D0E10;color:#F5F4F0;font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:48px 40px;border:1px solid #232529;"><h1 style="font-size:24px;margin-bottom:20px;">Hey ${user.username},</h1><p style="color:#8C8F96;margin-bottom:32px;">Reset your password — link expires in 1 hour.</p><a href="${link}" style="background:#3D9EFF;color:#000;padding:14px 28px;text-decoration:none;font-weight:bold;display:inline-block;">Reset Password</a><p style="color:#8C8F96;font-size:12px;margin-top:32px;word-break:break-all;">${link}</p></div>`
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
            <p style="font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.15em;color:#3D9EFF;margin-bottom:16px;">[ SESSION COMPLETE ]</p>
            <h1 style="font-size:30px;font-weight:900;text-transform:uppercase;margin:0 0 8px;line-height:1.1;">You Put In<br>The Work, ${booking.username}.</h1>
            <p style="color:#8C8F96;font-size:15px;line-height:1.6;margin:20px 0 28px;">
              We want to take a moment to recognize your commitment. Completing your
              <strong style="color:#F5F4F0;">${booking.service_title}</strong> program
              ${booking.package_label ? '(' + booking.package_label + ')' : ''}
              takes consistency and dedication — and you showed up every time.
            </p>

            <div style="background:#15171A;border:1px solid #232529;border-left:3px solid #3D9EFF;padding:24px;margin-bottom:28px;">
              <p style="font-size:16px;font-weight:700;color:#F5F4F0;margin:0 0 10px;">What's next?</p>
              <p style="color:#8C8F96;font-size:14px;line-height:1.6;margin:0;">
                Progress doesn't stop here. Whether you're looking to level up your current program,
                try something new, or bring in a teammate — we're ready when you are.
                <br><br>
                <a href="https://kp12performance.com/tra.html" style="color:#3D9EFF;text-decoration:none;font-weight:600;">Browse Training Programs →</a>
                &nbsp;&nbsp;|&nbsp;&nbsp;
                <a href="https://kp12performance.com/ath.html" style="color:#3D9EFF;text-decoration:none;font-weight:600;">Explore Athletics →</a>
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
              <a href="mailto:support@kp12performance.com" style="color:#3D9EFF;">support@kp12performance.com</a>
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

// Elite players table — admin-managed showcase athletes on the homepage
pool.query(`
  CREATE TABLE IF NOT EXISTS elite_players (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    sport VARCHAR(100),
    description TEXT,
    achievement VARCHAR(200),
    image_data TEXT,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
  );
`).then(() => console.log("Elite players table ready!"))
  .catch(err => console.error("Elite players table error:", err));

// POST /api/admin/send-email — mass or single email from the employee dashboard
app.post('/api/admin/send-email', requireAdmin, async (req, res) => {
  const { subject, message, recipientType, singleEmail } = req.body;
  if (!subject || !message) return res.status(400).json({ error: "Subject and message are required." });

  try {
    let recipients = [];

    if (recipientType === 'single') {
      if (!singleEmail || !singleEmail.includes('@'))
        return res.status(400).json({ error: "Please provide a valid email address." });
      recipients = [singleEmail.trim()];
    } else {
      // All members
      const result = await pool.query("SELECT email FROM users WHERE email IS NOT NULL");
      recipients = result.rows.map(r => r.email).filter(Boolean);
    }

    if (!recipients.length) return res.status(400).json({ error: "No recipients found." });

    // Resend supports up to 50 recipients per call — chunk if needed
    const CHUNK = 50;
    let sent = 0;
    for (let i = 0; i < recipients.length; i += CHUNK) {
      const chunk = recipients.slice(i, i + CHUNK);
      await resend.emails.send({
        from: 'support@kp12performance.com',
        to: chunk,
        subject,
        html: `
          <div style="background:#0D0E10;color:#F5F4F0;font-family:'Work Sans',Arial,sans-serif;max-width:560px;margin:0 auto;padding:0;border:1px solid #232529;">
            <div style="background:#15171A;padding:28px 36px;border-bottom:3px solid #FF5630;">
              <img src="https://kp12performance.com/logo.png" alt="KP12 Performance" style="height:32px;display:block;">
            </div>
            <div style="padding:36px 36px 28px;">
              <div style="font-size:15px;line-height:1.75;color:#F5F4F0;white-space:pre-wrap;">${message.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
            </div>
            <div style="padding:20px 36px;border-top:1px solid #232529;text-align:center;">
              <p style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#8C8F96;margin:0;">KP12 Performance · kp12performance.com</p>
            </div>
          </div>
        `
      });
      sent += chunk.length;
    }

    res.json({ message: `Email sent to ${sent} recipient${sent !== 1 ? 's' : ''}.` });
  } catch (err) {
    console.error('Mass email error:', err);
    res.status(500).json({ error: "Failed to send email. Check server logs." });
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

    // Fetch user, their role, and their booking athletes for a personalized thank-you
    const userResult = await pool.query(
      "SELECT username, email, role FROM users WHERE id = $1",
      [booking.user_id]
    );
    const user = userResult.rows[0];

    const athleteResult = await pool.query(
      "SELECT athlete_name, athlete_age FROM booking_athletes WHERE booking_id = $1",
      [id]
    );
    const athletes = athleteResult.rows;
    const isParent = user && user.role === 'parent_guardian' && athletes.length > 0;

    if (user && user.email) {
      try {
        let thankYouBody = '';

        if (isParent) {
          const kidShoutouts = athletes.map((a, i) => `
            <div style="padding:12px 0;border-bottom:1px solid #232529;display:flex;align-items:center;gap:14px;">
              <div style="width:34px;height:34px;border-radius:50%;background:rgba(46,204,113,0.15);border:1.5px solid #2ECC71;display:flex;align-items:center;justify-content:center;font-family:Anton,sans-serif;font-size:13px;color:#2ECC71;flex-shrink:0;">${i+1}</div>
              <div>
                <p style="font-weight:700;font-size:15px;margin:0;">${a.athlete_name || 'Your Athlete'}${a.athlete_age ? ` <span style="font-size:13px;color:#8C8F96;font-weight:400;">age ${a.athlete_age}</span>` : ''}</p>
                <p style="color:#8C8F96;font-size:13px;margin:0;">Completed ${booking.service_title}</p>
              </div>
            </div>
          `).join('');

          thankYouBody = `
            <p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.16em;color:#2ECC71;margin:0 0 14px;">[ SESSION COMPLETE ]</p>
            <h1 style="font-size:24px;font-weight:800;text-transform:uppercase;margin:0 0 6px;line-height:1.15;">Your athletes crushed it, ${user.username}! 🏆</h1>
            <p style="color:#F5F4F0;font-size:15px;line-height:1.7;margin:14px 0 16px;">
              You showed up for your athletes every single session — and that commitment makes all the difference. Here's who put in the work this week:
            </p>
            <div style="background:#15171A;border:1px solid #2A2D31;padding:4px 18px 4px;margin-bottom:22px;">
              ${kidShoutouts}
            </div>
            <p style="color:#8C8F96;font-size:14px;line-height:1.65;margin:0 0 22px;">
              We're proud of each one of them. We hope this experience with <strong style="color:#F5F4F0;">${booking.service_title}</strong> pushed them closer to their goals — and we'd love to hear how they felt about it.
            </p>`;
        } else {
          thankYouBody = `
            <p style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.16em;color:#2ECC71;margin:0 0 14px;">[ SESSION COMPLETE ]</p>
            <h1 style="font-size:24px;font-weight:800;text-transform:uppercase;margin:0 0 6px;line-height:1.15;">You Put in the Work,<br>${user.username}! 🔥</h1>
            <p style="color:#F5F4F0;font-size:15px;line-height:1.7;margin:14px 0 16px;">
              It was an honor training with you this week. Every rep and every session you completed is an investment in the athlete you're becoming — and that dedication doesn't go unnoticed.
            </p>
            <p style="color:#8C8F96;font-size:15px;line-height:1.7;margin:0 0 22px;">
              We hope your experience with <strong style="color:#F5F4F0;">${booking.service_title}</strong> pushed you closer to your goals. Our coaches are already looking forward to your next block.
            </p>`;
        }

        await resend.emails.send({
          from: 'support@kp12performance.com',
          to: user.email,
          subject: isParent
            ? `Your athletes crushed it this week — Thank You | KP12 Performance`
            : `Thank You for Training with KP12 Performance — We'd Love Your Feedback`,
          html: `<div style="background:#0D0E10;color:#F5F4F0;font-family:'Work Sans',Arial,sans-serif;max-width:580px;margin:0 auto;border:1px solid #232529;">
            <div style="background:#15171A;padding:26px 32px;border-bottom:1px solid #232529;">
              <img src="https://kp12performance.com/logo.png" alt="KP12 Performance" style="height:32px;display:block;">
            </div>
            <div style="padding:32px 32px 26px;">
              ${thankYouBody}
              <div style="background:#15171A;border:1px solid #232529;border-left:3px solid #2ECC71;padding:20px 22px;margin-bottom:16px;">
                <p style="font-size:15px;font-weight:600;margin:0 0 8px;">How did we do?</p>
                <p style="color:#8C8F96;font-size:14px;line-height:1.6;margin:0 0 14px;">A quick review helps us improve and lets other athletes know what to expect.</p>
                <a href="https://kp12performance.com/review.html" style="display:inline-block;background:#2ECC71;color:#0D0E10;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:12px 22px;font-weight:600;">Leave a Review →</a>
              </div>
              <div style="border:1px solid #232529;padding:20px 22px;">
                <p style="font-size:15px;font-weight:600;margin:0 0 8px;">Ready for the Next Block?</p>
                <p style="color:#8C8F96;font-size:14px;line-height:1.6;margin:0 0 14px;">Keep the momentum going. Book your next sessions now.</p>
                <a href="https://kp12performance.com/tra.html" style="display:inline-block;background:transparent;color:#F5F4F0;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:12px 22px;border:1px solid #3a3d42;">Book Again →</a>
              </div>
              <p style="color:#8C8F96;font-size:13px;margin:18px 0 0;">Questions? <a href="mailto:support@kp12performance.com" style="color:#2ECC71;">support@kp12performance.com</a></p>
            </div>
            <div style="padding:16px 32px;border-top:1px solid #232529;text-align:center;">
              <p style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#8C8F96;margin:0;">© 2025 KP12 Performance · kp12performance.com</p>
            </div>
          </div>`
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

// --- ELITE PLAYERS ROUTES ---

// GET — public, returns all elite players ordered by display_order
app.get('/api/elite-players', async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT id, name, sport, description, achievement, image_data, display_order FROM elite_players ORDER BY display_order ASC, created_at ASC"
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Error fetching elite players." }); }
});

// POST — admin only, add a player
app.post('/api/elite-players', requireAdmin, async (req, res) => {
  const { name, sport, description, achievement, imageData, displayOrder } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required." });
  const cleanImage = (imageData && imageData.startsWith('data:image/')) ? imageData : null;
  try {
    const r = await pool.query(
      "INSERT INTO elite_players (name, sport, description, achievement, image_data, display_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [name, sport||null, description||null, achievement||null, cleanImage, displayOrder||0]
    );
    res.status(201).json({ message: "Player added!", id: r.rows[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: "Error adding player." }); }
});

// PATCH — admin only, edit a player
app.patch('/api/elite-players/:id', requireAdmin, async (req, res) => {
  const { name, sport, description, achievement, imageData, displayOrder } = req.body;
  const cleanImage = imageData
    ? (imageData.startsWith('data:image/') ? imageData : undefined)
    : null;
  try {
    const r = await pool.query(
      `UPDATE elite_players SET
        name=$1, sport=$2, description=$3, achievement=$4,
        display_order=$5
        ${cleanImage !== undefined ? ', image_data=$6' : ''}
       WHERE id=$${cleanImage !== undefined ? 7 : 6} RETURNING id`,
      cleanImage !== undefined
        ? [name, sport||null, description||null, achievement||null, displayOrder||0, cleanImage, req.params.id]
        : [name, sport||null, description||null, achievement||null, displayOrder||0, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Player not found." });
    res.json({ message: "Player updated!" });
  } catch (err) { console.error(err); res.status(500).json({ error: "Error updating player." }); }
});

// DELETE — admin only
app.delete('/api/elite-players/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM elite_players WHERE id=$1", [req.params.id]);
    res.json({ message: "Player removed." });
  } catch (err) { console.error(err); res.status(500).json({ error: "Error removing player." }); }
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