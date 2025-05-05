const express = require('express');
const router = express.Router();
const { verifyToken } = require('../auth');
const db = require('../db');

// Get alliance details
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT a.*, 
              COUNT(am.id) as member_count,
              json_agg(json_build_object(
                'id', u.id,
                'username', u.username,
                'role', am.role
              )) as members
       FROM alliances a
       LEFT JOIN alliance_members am ON a.id = am.alliance_id
       LEFT JOIN users u ON am.user_id = u.id
       WHERE a.id = $1
       GROUP BY a.id`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Alliance not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new alliance
router.post('/', verifyToken, async (req, res) => {
  try {
    const { name } = req.body;

    // Check if user is already in an alliance
    const existingMembership = await db.query(
      'SELECT * FROM alliance_members WHERE user_id = $1',
      [req.user.id]
    );

    if (existingMembership.rows.length > 0) {
      return res.status(400).json({ error: 'User is already in an alliance' });
    }

    // Create alliance
    const result = await db.query(
      `INSERT INTO alliances (name, leader_id) 
       VALUES ($1, $2) 
       RETURNING *`,
      [name, req.user.id]
    );

    // Add creator as leader
    await db.query(
      `INSERT INTO alliance_members (alliance_id, user_id, role) 
       VALUES ($1, $2, 'leader')`,
      [result.rows[0].id, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Join alliance
router.post('/:id/join', verifyToken, async (req, res) => {
  try {
    const allianceId = req.params.id;

    // Check if user is already in an alliance
    const existingMembership = await db.query(
      'SELECT * FROM alliance_members WHERE user_id = $1',
      [req.user.id]
    );

    if (existingMembership.rows.length > 0) {
      return res.status(400).json({ error: 'User is already in an alliance' });
    }

    // Check if alliance exists
    const alliance = await db.query(
      'SELECT * FROM alliances WHERE id = $1',
      [allianceId]
    );

    if (alliance.rows.length === 0) {
      return res.status(404).json({ error: 'Alliance not found' });
    }

    // Add member
    const result = await db.query(
      `INSERT INTO alliance_members (alliance_id, user_id, role) 
       VALUES ($1, $2, 'member') 
       RETURNING *`,
      [allianceId, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Leave alliance
router.post('/:id/leave', verifyToken, async (req, res) => {
  try {
    const allianceId = req.params.id;

    // Check if user is in the alliance
    const membership = await db.query(
      'SELECT * FROM alliance_members WHERE alliance_id = $1 AND user_id = $2',
      [allianceId, req.user.id]
    );

    if (membership.rows.length === 0) {
      return res.status(400).json({ error: 'User is not in this alliance' });
    }

    // Check if user is the leader
    if (membership.rows[0].role === 'leader') {
      // Find a new leader or delete alliance if last member
      const members = await db.query(
        'SELECT * FROM alliance_members WHERE alliance_id = $1 AND user_id != $2',
        [allianceId, req.user.id]
      );

      if (members.rows.length === 0) {
        // Delete alliance if last member
        await db.query('DELETE FROM alliances WHERE id = $1', [allianceId]);
      } else {
        // Promote another member to leader
        await db.query(
          `UPDATE alliance_members 
           SET role = 'leader' 
           WHERE alliance_id = $1 AND user_id = $2`,
          [allianceId, members.rows[0].user_id]
        );
      }
    }

    // Remove member
    await db.query(
      'DELETE FROM alliance_members WHERE alliance_id = $1 AND user_id = $2',
      [allianceId, req.user.id]
    );

    res.json({ message: 'Successfully left alliance' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send resources to alliance member
router.post('/:id/send-resources', verifyToken, async (req, res) => {
  try {
    const { target_user_id, resource_type, amount } = req.body;
    const allianceId = req.params.id;

    // Verify sender is in the alliance
    const senderMembership = await db.query(
      'SELECT * FROM alliance_members WHERE alliance_id = $1 AND user_id = $2',
      [allianceId, req.user.id]
    );

    if (senderMembership.rows.length === 0) {
      return res.status(403).json({ error: 'Not a member of this alliance' });
    }

    // Verify receiver is in the alliance
    const receiverMembership = await db.query(
      'SELECT * FROM alliance_members WHERE alliance_id = $1 AND user_id = $2',
      [allianceId, target_user_id]
    );

    if (receiverMembership.rows.length === 0) {
      return res.status(400).json({ error: 'Target user is not in this alliance' });
    }

    // Get sender's kingdom
    const senderKingdom = await db.query(
      'SELECT * FROM kingdoms WHERE user_id = $1',
      [req.user.id]
    );

    if (senderKingdom.rows.length === 0) {
      return res.status(400).json({ error: 'Sender kingdom not found' });
    }

    // Get receiver's kingdom
    const receiverKingdom = await db.query(
      'SELECT * FROM kingdoms WHERE user_id = $1',
      [target_user_id]
    );

    if (receiverKingdom.rows.length === 0) {
      return res.status(400).json({ error: 'Receiver kingdom not found' });
    }

    // Check if sender has enough resources
    const senderResources = await db.query(
      'SELECT * FROM resources WHERE kingdom_id = $1 AND resource_type = $2',
      [senderKingdom.rows[0].id, resource_type]
    );

    if (senderResources.rows.length === 0 || senderResources.rows[0].amount < amount) {
      return res.status(400).json({ error: 'Not enough resources' });
    }

    // Transfer resources
    await db.query(
      'UPDATE resources SET amount = amount - $1 WHERE kingdom_id = $2 AND resource_type = $3',
      [amount, senderKingdom.rows[0].id, resource_type]
    );

    await db.query(
      'UPDATE resources SET amount = amount + $1 WHERE kingdom_id = $2 AND resource_type = $3',
      [amount, receiverKingdom.rows[0].id, resource_type]
    );

    res.json({ message: 'Resources sent successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send units to alliance member
router.post('/:id/send-units', verifyToken, async (req, res) => {
  try {
    const { target_user_id, unit_type, quantity } = req.body;
    const allianceId = req.params.id;

    // Verify sender is in the alliance
    const senderMembership = await db.query(
      'SELECT * FROM alliance_members WHERE alliance_id = $1 AND user_id = $2',
      [allianceId, req.user.id]
    );

    if (senderMembership.rows.length === 0) {
      return res.status(403).json({ error: 'Not a member of this alliance' });
    }

    // Verify receiver is in the alliance
    const receiverMembership = await db.query(
      'SELECT * FROM alliance_members WHERE alliance_id = $1 AND user_id = $2',
      [allianceId, target_user_id]
    );

    if (receiverMembership.rows.length === 0) {
      return res.status(400).json({ error: 'Target user is not in this alliance' });
    }

    // Get sender's kingdom
    const senderKingdom = await db.query(
      'SELECT * FROM kingdoms WHERE user_id = $1',
      [req.user.id]
    );

    if (senderKingdom.rows.length === 0) {
      return res.status(400).json({ error: 'Sender kingdom not found' });
    }

    // Get receiver's kingdom
    const receiverKingdom = await db.query(
      'SELECT * FROM kingdoms WHERE user_id = $1',
      [target_user_id]
    );

    if (receiverKingdom.rows.length === 0) {
      return res.status(400).json({ error: 'Receiver kingdom not found' });
    }

    // Check if sender has enough units
    const senderUnits = await db.query(
      'SELECT * FROM units WHERE kingdom_id = $1 AND unit_type = $2',
      [senderKingdom.rows[0].id, unit_type]
    );

    if (senderUnits.rows.length === 0 || senderUnits.rows[0].quantity < quantity) {
      return res.status(400).json({ error: 'Not enough units' });
    }

    // Transfer units
    await db.query(
      'UPDATE units SET quantity = quantity - $1 WHERE kingdom_id = $2 AND unit_type = $3',
      [quantity, senderKingdom.rows[0].id, unit_type]
    );

    const receiverUnits = await db.query(
      'SELECT * FROM units WHERE kingdom_id = $1 AND unit_type = $2',
      [receiverKingdom.rows[0].id, unit_type]
    );

    if (receiverUnits.rows.length === 0) {
      await db.query(
        `INSERT INTO units (kingdom_id, unit_type, quantity, level) 
         VALUES ($1, $2, $3, $4)`,
        [receiverKingdom.rows[0].id, unit_type, quantity, senderUnits.rows[0].level]
      );
    } else {
      await db.query(
        'UPDATE units SET quantity = quantity + $1 WHERE kingdom_id = $2 AND unit_type = $3',
        [quantity, receiverKingdom.rows[0].id, unit_type]
      );
    }

    res.json({ message: 'Units sent successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router; 