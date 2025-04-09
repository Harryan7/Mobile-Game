const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { router: authRouter } = require('./auth');
const kingdomRouter = require('./game/kingdom');
const unitsRouter = require('./game/units');
const allianceRouter = require('./game/alliance');
const battleRouter = require('./game/battle');
const tasksRouter = require('./game/tasks');
const marketRouter = require('./game/market');

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Routes
app.use('/auth', authRouter);
app.use('/kingdom', kingdomRouter);
app.use('/units', unitsRouter);
app.use('/alliance', allianceRouter);
app.use('/battle', battleRouter);
app.use('/tasks', tasksRouter);
app.use('/market', marketRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 