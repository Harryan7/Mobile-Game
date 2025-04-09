const express = require('express');
const router = express.Router();
const { verifyToken } = require('../auth');
const db = require('../db');

// Get kingdom units
router.get('/:kingdomId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM units WHERE kingdom_id = $1',
      [req.params.kingdomId]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Train new units
router.post('/:kingdomId/train', verifyToken, async (req, res) => {
  try {
    const { unit_type, quantity } = req.body;
    const kingdomId = req.params.kingdomId;

    // Verify kingdom ownership
    const kingdom = await db.query(
      'SELECT * FROM kingdoms WHERE id = $1 AND user_id = $2',
      [kingdomId, req.user.id]
    );

    if (kingdom.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Check if barracks exists and get its level
    const barracks = await db.query(
      'SELECT * FROM buildings WHERE kingdom_id = $1 AND building_type = $2',
      [kingdomId, 'barracks']
    );

    if (barracks.rows.length === 0) {
      return res.status(400).json({ error: 'Barracks not found' });
    }

    // Unit costs and training times
    const unitSpecs = {
      'spearman': { gold: 100, food: 50, training_time: 300 }, // 5 minutes
      'archer': { gold: 150, food: 75, training_time: 450 }, // 7.5 minutes
      'cavalry': { gold: 200, food: 100, training_time: 600 }, // 10 minutes
      'shield_bearer': { gold: 250, food: 125, training_time: 750 } // 12.5 minutes
    };

    const unitSpec = unitSpecs[unit_type];
    if (!unitSpec) {
      return res.status(400).json({ error: 'Invalid unit type' });
    }

    // Calculate total cost
    const totalCost = {
      gold: unitSpec.gold * quantity,
      food: unitSpec.food * quantity
    };

    // Check if kingdom has enough resources
    const resources = await db.query(
      'SELECT * FROM resources WHERE kingdom_id = $1',
      [kingdomId]
    );

    const hasResources = resources.rows.every(resource => {
      const required = totalCost[resource.resource_type] || 0;
      return resource.amount >= required;
    });

    if (!hasResources) {
      return res.status(400).json({ error: 'Not enough resources' });
    }

    // Deduct resources
    for (const [resourceType, amount] of Object.entries(totalCost)) {
      await db.query(
        'UPDATE resources SET amount = amount - $1 WHERE kingdom_id = $2 AND resource_type = $3',
        [amount, kingdomId, resourceType]
      );
    }

    // Calculate training end time
    const trainingEndTime = new Date();
    trainingEndTime.setSeconds(trainingEndTime.getSeconds() + (unitSpec.training_time * quantity));

    // Create or update unit
    const existingUnit = await db.query(
      'SELECT * FROM units WHERE kingdom_id = $1 AND unit_type = $2',
      [kingdomId, unit_type]
    );

    let result;
    if (existingUnit.rows.length > 0) {
      result = await db.query(
        `UPDATE units 
         SET quantity = quantity + $1, 
             is_training = true,
             training_end_time = $2
         WHERE kingdom_id = $3 AND unit_type = $4 
         RETURNING *`,
        [quantity, trainingEndTime, kingdomId, unit_type]
      );
    } else {
      result = await db.query(
        `INSERT INTO units (kingdom_id, unit_type, quantity, is_training, training_end_time) 
         VALUES ($1, $2, $3, true, $4) 
         RETURNING *`,
        [kingdomId, unit_type, quantity, trainingEndTime]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Complete training
router.post('/:kingdomId/complete-training', verifyToken, async (req, res) => {
  try {
    const kingdomId = req.params.kingdomId;

    // Verify kingdom ownership
    const kingdom = await db.query(
      'SELECT * FROM kingdoms WHERE id = $1 AND user_id = $2',
      [kingdomId, req.user.id]
    );

    if (kingdom.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Get units that have finished training
    const result = await db.query(
      `UPDATE units 
       SET is_training = false, 
           training_end_time = NULL 
       WHERE kingdom_id = $1 
       AND is_training = true 
       AND training_end_time <= CURRENT_TIMESTAMP 
       RETURNING *`,
      [kingdomId]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upgrade unit
router.put('/:kingdomId/:unitType/upgrade', verifyToken, async (req, res) => {
  try {
    const { kingdomId, unitType } = req.params;

    // Verify kingdom ownership
    const kingdom = await db.query(
      'SELECT * FROM kingdoms WHERE id = $1 AND user_id = $2',
      [kingdomId, req.user.id]
    );

    if (kingdom.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Get unit
    const unit = await db.query(
      'SELECT * FROM units WHERE kingdom_id = $1 AND unit_type = $2',
      [kingdomId, unitType]
    );

    if (unit.rows.length === 0) {
      return res.status(404).json({ error: 'Unit not found' });
    }

    // Calculate upgrade cost
    const currentLevel = unit.rows[0].level;
    const upgradeCosts = {
      'spearman': { gold: 500 * currentLevel, food: 250 * currentLevel },
      'archer': { gold: 750 * currentLevel, food: 375 * currentLevel },
      'cavalry': { gold: 1000 * currentLevel, food: 500 * currentLevel },
      'shield_bearer': { gold: 1250 * currentLevel, food: 625 * currentLevel }
    };

    const cost = upgradeCosts[unitType];

    // Check if kingdom has enough resources
    const resources = await db.query(
      'SELECT * FROM resources WHERE kingdom_id = $1',
      [kingdomId]
    );

    const hasResources = resources.rows.every(resource => {
      const required = cost[resource.resource_type] || 0;
      return resource.amount >= required;
    });

    if (!hasResources) {
      return res.status(400).json({ error: 'Not enough resources' });
    }

    // Deduct resources
    for (const [resourceType, amount] of Object.entries(cost)) {
      await db.query(
        'UPDATE resources SET amount = amount - $1 WHERE kingdom_id = $2 AND resource_type = $3',
        [amount, kingdomId, resourceType]
      );
    }

    // Upgrade unit
    const result = await db.query(
      `UPDATE units 
       SET level = level + 1 
       WHERE kingdom_id = $1 AND unit_type = $2 
       RETURNING *`,
      [kingdomId, unitType]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router; 