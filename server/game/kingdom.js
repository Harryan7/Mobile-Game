const express = require('express');
const router = express.Router();
const { verifyToken } = require('../auth');
const db = require('../db');

// Get kingdom details
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT k.*, r.name as race_name, c.name as country_name 
       FROM kingdoms k 
       JOIN races r ON k.race_id = r.id 
       JOIN countries c ON k.country_id = c.id 
       WHERE k.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Kingdom not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new kingdom
router.post('/', verifyToken, async (req, res) => {
  try {
    const { name, race_id, country_id } = req.body;

    // Check if user already has a kingdom
    const existingKingdom = await db.query(
      'SELECT * FROM kingdoms WHERE user_id = $1',
      [req.user.id]
    );

    if (existingKingdom.rows.length > 0) {
      return res.status(400).json({ error: 'User already has a kingdom' });
    }

    // Create kingdom
    const result = await db.query(
      `INSERT INTO kingdoms (user_id, name, race_id, country_id) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [req.user.id, name, race_id, country_id]
    );

    // Initialize resources
    await db.query(
      `INSERT INTO resources (kingdom_id, resource_type, amount) 
       VALUES 
       ($1, 'gold', 1000),
       ($1, 'wood', 500),
       ($1, 'stone', 500),
       ($1, 'food', 1000)`,
      [result.rows[0].id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update resources
router.put('/:id/resources', verifyToken, async (req, res) => {
  try {
    const { resource_type, amount } = req.body;
    const kingdomId = req.params.id;

    // Verify kingdom ownership
    const kingdom = await db.query(
      'SELECT * FROM kingdoms WHERE id = $1 AND user_id = $2',
      [kingdomId, req.user.id]
    );

    if (kingdom.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Update resource
    const result = await db.query(
      `UPDATE resources 
       SET amount = amount + $1, last_updated = CURRENT_TIMESTAMP 
       WHERE kingdom_id = $2 AND resource_type = $3 
       RETURNING *`,
      [amount, kingdomId, resource_type]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get kingdom buildings
router.get('/:id/buildings', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM buildings WHERE kingdom_id = $1',
      [req.params.id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new building
router.post('/:id/buildings', verifyToken, async (req, res) => {
  try {
    const { building_type, position_x, position_y } = req.body;
    const kingdomId = req.params.id;

    // Verify kingdom ownership
    const kingdom = await db.query(
      'SELECT * FROM kingdoms WHERE id = $1 AND user_id = $2',
      [kingdomId, req.user.id]
    );

    if (kingdom.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Check building costs and resources
    const buildingCosts = {
      'town_hall': { gold: 1000, wood: 500, stone: 500 },
      'barracks': { gold: 300, wood: 200, stone: 100 },
      'hospital': { gold: 400, wood: 300, stone: 200 },
      'market': { gold: 500, wood: 400, stone: 300 },
      'school': { gold: 600, wood: 500, stone: 400 }
    };

    const cost = buildingCosts[building_type];
    if (!cost) {
      return res.status(400).json({ error: 'Invalid building type' });
    }

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

    // Create building
    const result = await db.query(
      `INSERT INTO buildings (kingdom_id, building_type, position_x, position_y) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [kingdomId, building_type, position_x, position_y]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upgrade building
router.put('/:id/buildings/:buildingId', verifyToken, async (req, res) => {
  try {
    const { buildingId } = req.params;
    const kingdomId = req.params.id;

    // Verify kingdom ownership
    const kingdom = await db.query(
      'SELECT * FROM kingdoms WHERE id = $1 AND user_id = $2',
      [kingdomId, req.user.id]
    );

    if (kingdom.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Get building
    const building = await db.query(
      'SELECT * FROM buildings WHERE id = $1 AND kingdom_id = $2',
      [buildingId, kingdomId]
    );

    if (building.rows.length === 0) {
      return res.status(404).json({ error: 'Building not found' });
    }

    // Calculate upgrade cost
    const currentLevel = building.rows[0].level;
    const upgradeCosts = {
      'town_hall': { gold: 1000 * currentLevel, wood: 500 * currentLevel, stone: 500 * currentLevel },
      'barracks': { gold: 300 * currentLevel, wood: 200 * currentLevel, stone: 100 * currentLevel },
      'hospital': { gold: 400 * currentLevel, wood: 300 * currentLevel, stone: 200 * currentLevel },
      'market': { gold: 500 * currentLevel, wood: 400 * currentLevel, stone: 300 * currentLevel },
      'school': { gold: 600 * currentLevel, wood: 500 * currentLevel, stone: 400 * currentLevel }
    };

    const cost = upgradeCosts[building.rows[0].building_type];

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

    // Upgrade building
    const result = await db.query(
      `UPDATE buildings 
       SET level = level + 1 
       WHERE id = $1 
       RETURNING *`,
      [buildingId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router; 