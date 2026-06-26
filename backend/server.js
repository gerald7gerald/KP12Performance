const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt'); // Added for encrypting passwords
const path = require('path');     // Added to locate your frontend folder files

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
  .then(() => console.log("Users table verified/created successfully!"))
  .catch((err) => console.error("Error creating users table:", err));

// Serve your main index.html file cleanly using an absolute system resolution path
app.get('/', (req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'frontend', 'index.html'));
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
    await pool.query(
      "INSERT INTO users (username, email, password) VALUES ($1, $2, $3)",
      [username, email, hashedPassword]
    );

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

    res.json({ message: "Logged in successfully!", user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error during login." });
  }
});

// API Endpoint: ADMIN VIEW USERS
app.get('/api/admin/users', async (req, res) => {
  try {
    // Grabs only the safety details, ignoring the scrambled password column entirely
    const result = await pool.query("SELECT id, username, email FROM users ORDER BY id ASC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error fetching users" });
  }
});

// --- START THE SERVER (STAYS AT THE VERY BOTTOM) ---
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});