const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const passport = require('passport');
const FacebookStrategy = require('passport-facebook').Strategy;
const router = express.Router();

// Database connection
const db = require('./db');

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Facebook OAuth configuration
passport.use(new FacebookStrategy({
    clientID: process.env.FACEBOOK_APP_ID,
    clientSecret: process.env.FACEBOOK_APP_SECRET,
    callbackURL: "/auth/facebook/callback"
  },
  async function(accessToken, refreshToken, profile, done) {
    try {
      // Check if user exists
      const result = await db.query(
        'SELECT * FROM users WHERE auth_provider = $1 AND auth_provider_id = $2',
        ['facebook', profile.id]
      );

      if (result.rows.length > 0) {
        return done(null, result.rows[0]);
      }

      // Create new user
      const newUser = await db.query(
        'INSERT INTO users (username, email, auth_provider, auth_provider_id) VALUES ($1, $2, $3, $4) RETURNING *',
        [profile.displayName, profile.emails[0].value, 'facebook', profile.id]
      );

      return done(null, newUser.rows[0]);
    } catch (err) {
      return done(err);
    }
  }
));

// Email registration
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // Check if user exists
    const userExists = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const result = await db.query(
      'INSERT INTO users (username, email, password_hash, auth_provider) VALUES ($1, $2, $3, $4) RETURNING *',
      [username, email, hashedPassword, 'email']
    );

    // Generate JWT
    const token = jwt.sign(
      { id: result.rows[0].id },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Email login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Get user
    const result = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Check password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await db.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    // Generate JWT
    const token = jwt.sign(
      { id: user.id },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Google login
router.post('/google', async (req, res) => {
  try {
    const { token } = req.body;
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    
    // Check if user exists
    const result = await db.query(
      'SELECT * FROM users WHERE auth_provider = $1 AND auth_provider_id = $2',
      ['google', payload.sub]
    );

    let user;
    if (result.rows.length > 0) {
      user = result.rows[0];
    } else {
      // Create new user
      const newUser = await db.query(
        'INSERT INTO users (username, email, auth_provider, auth_provider_id) VALUES ($1, $2, $3, $4) RETURNING *',
        [payload.name, payload.email, 'google', payload.sub]
      );
      user = newUser.rows[0];
    }

    // Generate JWT
    const jwtToken = jwt.sign(
      { id: user.id },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token: jwtToken, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Facebook routes
router.get('/facebook', passport.authenticate('facebook'));

router.get('/facebook/callback',
  passport.authenticate('facebook', { session: false }),
  (req, res) => {
    const token = jwt.sign(
      { id: req.user.id },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.redirect(`/auth-success?token=${token}`);
  }
);

// Middleware to verify JWT
const verifyToken = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Access denied' });
  }

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = { router, verifyToken }; 