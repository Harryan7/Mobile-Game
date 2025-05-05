const express = require('express');
const router = express.Router();
const { verifyToken } = require('../auth');
const db = require('../db');

// Attack another kingdom
router.post('/attack', verifyToken, async (req, res) => {
  try {
    const { target_kingdom_id, units } = req.body;

    // Get attacker's kingdom
    const attackerKingdom = await db.query(
      'SELECT * FROM kingdoms WHERE user_id = $1',
      [req.user.id]
    );

    if (attackerKingdom.rows.length === 0) {
      return res.status(400).json({ error: 'Attacker kingdom not found' });
    }

    // Get defender's kingdom
    const defenderKingdom = await db.query(
      'SELECT * FROM kingdoms WHERE id = $1',
      [target_kingdom_id]
    );

    if (defenderKingdom.rows.length === 0) {
      return res.status(400).json({ error: 'Defender kingdom not found' });
    }

    // Verify units belong to attacker
    const attackerUnits = await db.query(
      'SELECT * FROM units WHERE kingdom_id = $1',
      [attackerKingdom.rows[0].id]
    );

    const hasUnits = units.every(unit => {
      const existingUnit = attackerUnits.rows.find(u => u.unit_type === unit.type);
      return existingUnit && existingUnit.quantity >= unit.quantity;
    });

    if (!hasUnits) {
      return res.status(400).json({ error: 'Invalid units' });
    }

    // Get defender's units
    const defenderUnits = await db.query(
      'SELECT * FROM units WHERE kingdom_id = $1',
      [target_kingdom_id]
    );

    // Calculate battle results
    const battleResults = calculateBattle(units, defenderUnits.rows);

    // Update attacker's units
    for (const unit of units) {
      const lostUnits = battleResults.attackerLosses[unit.type] || 0;
      await db.query(
        'UPDATE units SET quantity = quantity - $1 WHERE kingdom_id = $2 AND unit_type = $3',
        [lostUnits, attackerKingdom.rows[0].id, unit.type]
      );
    }

    // Update defender's units
    for (const unit of defenderUnits.rows) {
      const lostUnits = battleResults.defenderLosses[unit.unit_type] || 0;
      await db.query(
        'UPDATE units SET quantity = quantity - $1 WHERE kingdom_id = $2 AND unit_type = $3',
        [lostUnits, target_kingdom_id, unit.unit_type]
      );
    }

    // If attack was successful, steal resources
    if (battleResults.success) {
      const stolenResources = await stealResources(
        attackerKingdom.rows[0].id,
        target_kingdom_id,
        battleResults.success
      );

      // Record attack
      await db.query(
        `INSERT INTO attacks (attacker_id, defender_id, status, resources_stolen, units_lost) 
         VALUES ($1, $2, 'completed', $3, $4)`,
        [
          attackerKingdom.rows[0].id,
          target_kingdom_id,
          JSON.stringify(stolenResources),
          JSON.stringify({
            attacker: battleResults.attackerLosses,
            defender: battleResults.defenderLosses
          })
        ]
      );

      res.json({
        success: true,
        stolenResources,
        losses: {
          attacker: battleResults.attackerLosses,
          defender: battleResults.defenderLosses
        }
      });
    } else {
      // Record failed attack
      await db.query(
        `INSERT INTO attacks (attacker_id, defender_id, status, units_lost) 
         VALUES ($1, $2, 'failed', $3)`,
        [
          attackerKingdom.rows[0].id,
          target_kingdom_id,
          JSON.stringify({
            attacker: battleResults.attackerLosses,
            defender: battleResults.defenderLosses
          })
        ]
      );

      res.json({
        success: false,
        losses: {
          attacker: battleResults.attackerLosses,
          defender: battleResults.defenderLosses
        }
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Calculate battle results
function calculateBattle(attackerUnits, defenderUnits) {
  const unitStats = {
    'spearman': { attack: 10, defense: 5, speed: 1 },
    'archer': { attack: 15, defense: 3, speed: 1.2 },
    'cavalry': { attack: 20, defense: 8, speed: 1.5 },
    'shield_bearer': { attack: 5, defense: 15, speed: 0.8 }
  };

  let attackerPower = 0;
  let defenderPower = 0;
  const attackerLosses = {};
  const defenderLosses = {};

  // Calculate total power
  for (const unit of attackerUnits) {
    const stats = unitStats[unit.type];
    attackerPower += stats.attack * unit.quantity;
  }

  for (const unit of defenderUnits) {
    const stats = unitStats[unit.unit_type];
    defenderPower += stats.defense * unit.quantity;
  }

  // Calculate losses
  const totalPower = attackerPower + defenderPower;
  const attackerLossRatio = defenderPower / totalPower;
  const defenderLossRatio = attackerPower / totalPower;

  for (const unit of attackerUnits) {
    attackerLosses[unit.type] = Math.floor(unit.quantity * attackerLossRatio);
  }

  for (const unit of defenderUnits) {
    defenderLosses[unit.unit_type] = Math.floor(unit.quantity * defenderLossRatio);
  }

  // Determine success
  const success = attackerPower > defenderPower;

  return {
    success,
    attackerLosses,
    defenderLosses
  };
}

// Steal resources from defeated kingdom
async function stealResources(attackerId, defenderId, success) {
  if (!success) return {};

  const stolenResources = {};
  const maxStealPercentage = 0.2; // 20% of resources can be stolen

  // Get defender's resources
  const defenderResources = await db.query(
    'SELECT * FROM resources WHERE kingdom_id = $1',
    [defenderId]
  );

  // Calculate and transfer stolen resources
  for (const resource of defenderResources.rows) {
    const stealAmount = Math.floor(resource.amount * maxStealPercentage);
    
    if (stealAmount > 0) {
      // Deduct from defender
      await db.query(
        'UPDATE resources SET amount = amount - $1 WHERE kingdom_id = $2 AND resource_type = $3',
        [stealAmount, defenderId, resource.resource_type]
      );

      // Add to attacker
      await db.query(
        'UPDATE resources SET amount = amount + $1 WHERE kingdom_id = $2 AND resource_type = $3',
        [stealAmount, attackerId, resource.resource_type]
      );

      stolenResources[resource.resource_type] = stealAmount;
    }
  }

  return stolenResources;
}

// Get attack history
router.get('/history/:kingdomId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT a.*, 
              k1.name as attacker_name,
              k2.name as defender_name
       FROM attacks a
       JOIN kingdoms k1 ON a.attacker_id = k1.id
       JOIN kingdoms k2 ON a.defender_id = k2.id
       WHERE a.attacker_id = $1 OR a.defender_id = $1
       ORDER BY a.attack_time DESC
       LIMIT 50`,
      [req.params.kingdomId]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router; 