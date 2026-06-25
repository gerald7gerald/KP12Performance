const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS so your frontend can talk to your backend safely
app.use(cors());
app.use(express.json());

// Set up PostgreSQL database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});