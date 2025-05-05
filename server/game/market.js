const express = require('express');
const router = express.Router();
const { verifyToken } = require('../auth');
const db = require('../db');

// Get market offers
router.get('/offers', verifyToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT m.*, 
              k.name as seller_name,
              CASE WHEN m.seller_id IS NULL THEN 'NPC' ELSE 'Player' END as seller_type
       FROM market_offers m
       LEFT JOIN kingdoms k ON m.seller_id = k.id
       WHERE m.quantity > 0
       ORDER BY m.created_at DESC`
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create market offer
router.post('/offers', verifyToken, async (req, res) => {
  try {
    const { resource_type, quantity, price_type, price_amount } = req.body;

    // Get seller's kingdom
    const kingdom = await db.query(
      'SELECT * FROM kingdoms WHERE user_id = $1',
      [req.user.id]
    );

    if (kingdom.rows.length === 0) {
      return res.status(400).json({ error: 'Kingdom not found' });
    }

    // Check if seller has enough resources
    const resources = await db.query(
      'SELECT * FROM resources WHERE kingdom_id = $1 AND resource_type = $2',
      [kingdom.rows[0].id, resource_type]
    );

    if (resources.rows.length === 0 || resources.rows[0].amount < quantity) {
      return res.status(400).json({ error: 'Not enough resources' });
    }

    // Deduct resources from seller
    await db.query(
      'UPDATE resources SET amount = amount - $1 WHERE kingdom_id = $2 AND resource_type = $3',
      [quantity, kingdom.rows[0].id, resource_type]
    );

    // Create offer
    const result = await db.query(
      `INSERT INTO market_offers (seller_id, resource_type, quantity, price_type, price_amount) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING *`,
      [kingdom.rows[0].id, resource_type, quantity, price_type, price_amount]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Buy from market offer
router.post('/offers/:offerId/buy', verifyToken, async (req, res) => {
  try {
    const { quantity } = req.body;
    const offerId = req.params.offerId;

    // Get offer
    const offer = await db.query(
      'SELECT * FROM market_offers WHERE id = $1',
      [offerId]
    );

    if (offer.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    if (offer.rows[0].quantity < quantity) {
      return res.status(400).json({ error: 'Not enough quantity available' });
    }

    // Get buyer's kingdom
    const buyerKingdom = await db.query(
      'SELECT * FROM kingdoms WHERE user_id = $1',
      [req.user.id]
    );

    if (buyerKingdom.rows.length === 0) {
      return res.status(400).json({ error: 'Kingdom not found' });
    }

    // Calculate total price
    const totalPrice = offer.rows[0].price_amount * quantity;

    // Check if buyer has enough resources to pay
    const buyerResources = await db.query(
      'SELECT * FROM resources WHERE kingdom_id = $1 AND resource_type = $2',
      [buyerKingdom.rows[0].id, offer.rows[0].price_type]
    );

    if (buyerResources.rows.length === 0 || buyerResources.rows[0].amount < totalPrice) {
      return res.status(400).json({ error: 'Not enough resources to pay' });
    }

    // Deduct payment from buyer
    await db.query(
      'UPDATE resources SET amount = amount - $1 WHERE kingdom_id = $2 AND resource_type = $3',
      [totalPrice, buyerKingdom.rows[0].id, offer.rows[0].price_type]
    );

    // Add resources to buyer
    await db.query(
      'UPDATE resources SET amount = amount + $1 WHERE kingdom_id = $2 AND resource_type = $3',
      [quantity, buyerKingdom.rows[0].id, offer.rows[0].resource_type]
    );

    // If seller is a player, add payment to seller
    if (offer.rows[0].seller_id) {
      await db.query(
        'UPDATE resources SET amount = amount + $1 WHERE kingdom_id = $2 AND resource_type = $3',
        [totalPrice, offer.rows[0].seller_id, offer.rows[0].price_type]
      );
    }

    // Update offer quantity
    const remainingQuantity = offer.rows[0].quantity - quantity;
    if (remainingQuantity > 0) {
      await db.query(
        'UPDATE market_offers SET quantity = $1 WHERE id = $2',
        [remainingQuantity, offerId]
      );
    } else {
      await db.query('DELETE FROM market_offers WHERE id = $1', [offerId]);
    }

    res.json({
      message: 'Purchase successful',
      quantity,
      totalPrice,
      remainingQuantity
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel market offer
router.delete('/offers/:offerId', verifyToken, async (req, res) => {
  try {
    const offerId = req.params.offerId;

    // Get offer
    const offer = await db.query(
      'SELECT * FROM market_offers WHERE id = $1',
      [offerId]
    );

    if (offer.rows.length === 0) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    // Verify ownership
    const kingdom = await db.query(
      'SELECT * FROM kingdoms WHERE id = $1 AND user_id = $2',
      [offer.rows[0].seller_id, req.user.id]
    );

    if (kingdom.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Return resources to seller
    await db.query(
      'UPDATE resources SET amount = amount + $1 WHERE kingdom_id = $2 AND resource_type = $3',
      [offer.rows[0].quantity, offer.rows[0].seller_id, offer.rows[0].resource_type]
    );

    // Delete offer
    await db.query('DELETE FROM market_offers WHERE id = $1', [offerId]);

    res.json({ message: 'Offer cancelled successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get NPC market offers
router.get('/npc-offers', verifyToken, async (req, res) => {
  try {
    // Get user's kingdom level
    const kingdom = await db.query(
      'SELECT level FROM kingdoms WHERE user_id = $1',
      [req.user.id]
    );

    if (kingdom.rows.length === 0) {
      return res.status(400).json({ error: 'Kingdom not found' });
    }

    const kingdomLevel = kingdom.rows[0].level;

    // Generate NPC offers based on kingdom level
    const npcOffers = generateNPCOffers(kingdomLevel);

    res.json(npcOffers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate NPC offers based on kingdom level
function generateNPCOffers(kingdomLevel) {
  const baseResources = {
    gold: 100,
    wood: 50,
    stone: 50,
    food: 75
  };

  const offers = [];
  const resourceTypes = ['gold', 'wood', 'stone', 'food'];

  // Generate 4 random offers
  for (let i = 0; i < 4; i++) {
    const sellResource = resourceTypes[Math.floor(Math.random() * resourceTypes.length)];
    const buyResource = resourceTypes.filter(r => r !== sellResource)[
      Math.floor(Math.random() * (resourceTypes.length - 1))
    ];

    const quantity = Math.floor(baseResources[sellResource] * (1 + kingdomLevel * 0.1));
    const price = Math.floor(baseResources[buyResource] * (1 + kingdomLevel * 0.1));

    offers.push({
      resource_type: sellResource,
      quantity,
      price_type: buyResource,
      price_amount: price,
      seller_type: 'NPC'
    });
  }

  return offers;
}

module.exports = router; 