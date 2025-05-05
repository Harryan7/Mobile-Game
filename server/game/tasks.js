const express = require('express');
const router = express.Router();
const { verifyToken } = require('../auth');
const db = require('../db');

// Get daily tasks
router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT dt.*, 
              CASE WHEN udt.completed THEN true ELSE false END as completed,
              udt.completed_at
       FROM daily_tasks dt
       LEFT JOIN user_daily_tasks udt ON dt.id = udt.task_id AND udt.user_id = $1
       ORDER BY dt.difficulty, dt.id`,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Complete a task
router.post('/:taskId/complete', verifyToken, async (req, res) => {
  try {
    const taskId = req.params.taskId;

    // Check if task exists
    const task = await db.query(
      'SELECT * FROM daily_tasks WHERE id = $1',
      [taskId]
    );

    if (task.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Check if task is already completed
    const completedTask = await db.query(
      'SELECT * FROM user_daily_tasks WHERE user_id = $1 AND task_id = $2',
      [req.user.id, taskId]
    );

    if (completedTask.rows.length > 0) {
      return res.status(400).json({ error: 'Task already completed' });
    }

    // Get user's kingdom
    const kingdom = await db.query(
      'SELECT * FROM kingdoms WHERE user_id = $1',
      [req.user.id]
    );

    if (kingdom.rows.length === 0) {
      return res.status(400).json({ error: 'Kingdom not found' });
    }

    // Mark task as completed
    await db.query(
      `INSERT INTO user_daily_tasks (user_id, task_id, completed, completed_at) 
       VALUES ($1, $2, true, CURRENT_TIMESTAMP)`,
      [req.user.id, taskId]
    );

    // Award resources
    const reward = task.rows[0];
    await db.query(
      'UPDATE resources SET amount = amount + $1 WHERE kingdom_id = $2 AND resource_type = $3',
      [reward.reward_amount, kingdom.rows[0].id, reward.reward_type]
    );

    res.json({
      message: 'Task completed successfully',
      reward: {
        type: reward.reward_type,
        amount: reward.reward_amount
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset daily tasks (should be called by a scheduled job)
router.post('/reset', verifyToken, async (req, res) => {
  try {
    // Delete all completed tasks
    await db.query(
      'DELETE FROM user_daily_tasks WHERE completed_at < CURRENT_DATE'
    );

    res.json({ message: 'Daily tasks reset successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new daily task (admin only)
router.post('/', verifyToken, async (req, res) => {
  try {
    const { task_type, description, reward_type, reward_amount, difficulty } = req.body;

    // Verify user is admin
    const user = await db.query(
      'SELECT * FROM users WHERE id = $1 AND role = $2',
      [req.user.id, 'admin']
    );

    if (user.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const result = await db.query(
      `INSERT INTO daily_tasks (task_type, description, reward_type, reward_amount, difficulty) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING *`,
      [task_type, description, reward_type, reward_amount, difficulty]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get task completion statistics
router.get('/stats', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT 
        COUNT(*) as total_tasks,
        COUNT(CASE WHEN udt.completed THEN 1 END) as completed_tasks,
        SUM(CASE WHEN udt.completed THEN dt.reward_amount ELSE 0 END) as total_rewards
       FROM daily_tasks dt
       LEFT JOIN user_daily_tasks udt ON dt.id = udt.task_id AND udt.user_id = $1
       WHERE udt.completed_at >= CURRENT_DATE`,
      [req.user.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router; 