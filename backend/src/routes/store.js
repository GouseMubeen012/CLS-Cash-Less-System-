const express = require('express');
const router = express.Router();
const pool = require('../db/config');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { authenticateToken } = require('../middleware/auth');

// Store Login (public route)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // First check if the user exists and is a store user
    const userResult = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND role = $2',
      [email, 'store']
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userResult.rows[0];

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get store details
    const storeResult = await pool.query(
      'SELECT * FROM stores WHERE store_id = $1',
      [user.store_id]
    );

    if (storeResult.rows.length === 0) {
      return res.status(401).json({ error: 'Store account not found' });
    }

    const store = storeResult.rows[0];

    const token = jwt.sign(
      {
        userId: user.user_id,
        role: user.role,
        storeId: store.store_id,
        storeName: store.store_name
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    const response = {
      token,
      user: {
        id: user.user_id,
        role: user.role,
        storeId: parseInt(store.store_id, 10),
        storeName: store.store_name
      }
    };

    console.log('Login response:', response);
    res.json(response);
  } catch (error) {
    console.error('Store login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Verify Token (public route)
router.get('/verify-token', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided', valid: false });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', async (err, decoded) => {
      if (err) {
        return res.status(403).json({ error: 'Invalid token', valid: false });
      }

      try {
        // Check if user still exists
        const userResult = await pool.query(
          'SELECT * FROM users WHERE user_id = $1 AND role = $2',
          [decoded.userId, 'store']
        );

        if (userResult.rows.length === 0) {
          return res.status(403).json({ error: 'User not found', valid: false });
        }

        // Check if store still exists
        const storeResult = await pool.query(
          'SELECT * FROM stores WHERE store_id = $1',
          [decoded.storeId]
        );

        if (storeResult.rows.length === 0) {
          return res.status(403).json({ error: 'Store not found', valid: false });
        }

        res.json({
          valid: true,
          user: {
            id: decoded.userId,
            role: decoded.role,
            storeId: parseInt(decoded.storeId, 10),
            storeName: decoded.storeName
          }
        });
      } catch (error) {
        console.error('Error verifying user/store:', error);
        res.status(500).json({ error: 'Error verifying token', valid: false });
      }
    });
  } catch (error) {
    console.error('Error verifying token:', error);
    res.status(500).json({ error: 'Error verifying token', valid: false });
  }
});


// Process Transaction
router.post('/transaction', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    console.log('Processing transaction:', req.body);
    await client.query('BEGIN');
    const { studentId, amount } = req.body;

    if (!studentId || !amount) {
      throw new Error('Missing required fields');
    }

    // Verify store ID matches the authenticated user's store
    const requestStoreId = parseInt(req.body.storeId, 10);
    const userStoreId = parseInt(req.user.storeId, 10);
    
    if (requestStoreId !== userStoreId) {
      throw new Error('Unauthorized: Store ID mismatch');
    }

    // Get student details with last spent reset date and today's total spending
    const studentResult = await client.query(
      `SELECT 
        s.student_id, 
        s.student_name,
        s.balance, 
        s.daily_limit,
        s.last_spent_reset,
        COALESCE((
          SELECT SUM(t.amount)
          FROM transactions t
          WHERE t.student_id = s.student_id
            AND t.status = 'completed'
            AND DATE(t.transaction_date) = CURRENT_DATE
        ), 0) as today_spent
      FROM students s
      WHERE s.student_id = $1`,
      [studentId]
    );

    if (studentResult.rows.length === 0) {
      throw new Error('Student not found');
    }

    const student = studentResult.rows[0];
    
    // Debug logging
    console.log('Transaction Details:', {
      student_name: student.student_name,
      balance: student.balance,
      daily_limit: student.daily_limit,
      today_spent: student.today_spent,
      attempted_amount: amount
    });

    // Check if student has sufficient balance
    if (student.balance < amount) {
      throw new Error('Insufficient balance');
    }

    // Calculate today's total spending including this transaction
    const todaySpent = parseFloat(student.today_spent) || 0;
    const newTotalSpent = todaySpent + parseFloat(amount);

    // Debug logging for limit calculation
    console.log('Limit Calculation:', {
      daily_limit: student.daily_limit,
      today_spent: todaySpent,
      attempted_amount: parseFloat(amount),
      new_total_would_be: newTotalSpent
    });

    // Check daily limit if it exists
    if (student.daily_limit && student.daily_limit > 0) {
      const remainingLimit = student.daily_limit - todaySpent;
      console.log('Remaining limit:', remainingLimit);
      
      if (parseFloat(amount) > remainingLimit) {
        throw new Error(
          `Daily spending limit exceeded. ` +
          `Available limit for today: ₹${remainingLimit.toFixed(2)}, ` +
          `Attempted amount: ₹${parseFloat(amount).toFixed(2)}`
        );
      }
    }

    // Update student balance and record transaction details
    await client.query(
      `UPDATE students 
       SET balance = balance - $1,
           daily_spent = $2,
           last_spent_reset = CURRENT_DATE
       WHERE student_id = $3`,
      [amount, newTotalSpent, studentId]
    );

    // Create transaction record
    const transactionResult = await client.query(
      'INSERT INTO transactions (student_id, store_id, amount, transaction_type, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [studentId, req.body.storeId, amount, 'purchase', 'completed']
    );

    // Update store balance and pending settlement amount
    await client.query(
      'UPDATE stores SET balance = balance + $1 WHERE store_id = $2',
      [amount, req.body.storeId]
    );

    // Update store_settlements pending amount
    await client.query(
      'UPDATE store_settlements SET pending_amount = pending_amount + $1 WHERE store_id = $2',
      [amount, req.body.storeId]
    );

    await client.query('COMMIT');

    // Get updated student balance
    const updatedStudent = await client.query(
      'SELECT balance, daily_spent FROM students WHERE student_id = $1',
      [studentId]
    );

    console.log('Transaction completed successfully');
    res.json({
      message: 'Transaction successful',
      transaction: transactionResult.rows[0],
      currentBalance: updatedStudent.rows[0].balance,
      dailySpent: updatedStudent.rows[0].daily_spent
    });

    // Emit WebSocket event
    const io = req.app.get('io');
    io.to(`store_${req.user.storeId}`).emit('transactionUpdate', {
      type: 'transaction',
      data: transactionResult.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Transaction error:', error);
    res.status(400).json({ error: error.message || 'Transaction failed' });
  } finally {
    client.release();
  }
});

// Get Student Details
router.get('/student/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT student_id, student_name, photo_url, balance, daily_limit, daily_spent FROM students WHERE student_id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching student:', error);
    res.status(500).json({ error: 'Failed to fetch student details' });
  }
});

// Get Daily Stats
router.get('/daily-stats/:storeId', authenticateToken, async (req, res) => {
  try {
    const { storeId } = req.params;
    
    // Verify store ID matches the authenticated user's store
    if (storeId !== req.user.storeId) {
      return res.status(403).json({ error: 'Unauthorized: Store ID mismatch' });
    }

    const today = new Date().toISOString().split('T')[0];

    const statsResult = await pool.query(
      `SELECT 
        COUNT(*) as total_transactions,
        COALESCE(SUM(amount), 0)::float as total_amount
      FROM transactions 
      WHERE store_id = $1 
      AND DATE(created_at) = $2 
      AND status = 'completed'`,
      [storeId, today]
    );

    const pendingResult = await pool.query(
      'SELECT pending_amount FROM store_settlements WHERE store_id = $1',
      [storeId]
    );

    res.json({
      totalTransactions: parseInt(statsResult.rows[0].total_transactions),
      totalSales: parseFloat(statsResult.rows[0].total_amount),
      pendingSettlement: parseFloat(pendingResult.rows[0].pending_amount)
    });
  } catch (error) {
    console.error('Error fetching daily stats:', error);
    res.status(500).json({ error: 'Failed to fetch daily stats' });
  }
});

// Get Transactions
router.get('/stores/:storeId/transactions', authenticateToken, async (req, res) => {
  try {
    const storeId = parseInt(req.params.storeId, 10);
    const { startDate, endDate } = req.query;

    // Verify store ID matches the authenticated user's store
    const userStoreId = parseInt(req.user.storeId, 10);
    if (storeId !== userStoreId) {
      return res.status(403).json({ error: 'Unauthorized: Store ID mismatch' });
    }

    const result = await pool.query(
      `SELECT 
        t.transaction_id,
        t.student_id,
        t.store_id,
        t.amount,
        t.transaction_type,
        t.status,
        t.created_at,
        s.student_name,
        s.class
       FROM transactions t
       JOIN students s ON t.student_id = s.student_id
       WHERE t.store_id = $1 
       AND DATE(t.created_at) BETWEEN $2 AND $3
       ORDER BY t.created_at DESC`,
      [storeId, startDate, endDate]
    );

    const totalAmount = result.rows.reduce((sum, t) => sum + parseFloat(t.amount), 0);

    res.json({
      transactions: result.rows,
      totalAmount
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Get Settlements
router.get('/settlements/:storeId', authenticateToken, async (req, res) => {
  try {
    const { storeId } = req.params;
    
    // Verify store ID matches the authenticated user's store
    if (storeId !== req.user.storeId) {
      return res.status(403).json({ error: 'Unauthorized: Store ID mismatch' });
    }

    // Get store details
    const storeResult = await pool.query(
      `SELECT store_name, owner_name, email, mobile_number
       FROM stores WHERE store_id = $1`,
      [storeId]
    );

    // Get settlements with logs
    const result = await pool.query(
      `SELECT 
        s.settlement_id,
        s.store_id,
        s.total_transaction_amount,
        s.settled_amount,
        s.pending_amount,
        s.status,
        s.reference_id,
        s.created_at,
        s.updated_at,
        COALESCE(json_agg(sl ORDER BY sl.created_at DESC) FILTER (WHERE sl.log_id IS NOT NULL), '[]') as logs
       FROM settlements s
       LEFT JOIN settlement_logs sl ON s.settlement_id = sl.settlement_id
       WHERE s.store_id = $1
       GROUP BY s.settlement_id
       ORDER BY s.created_at DESC`,
      [storeId]
    );

    // Add store details to each settlement
    const settlements = result.rows.map(row => ({
      ...row,
      store_name: storeResult.rows[0]?.store_name,
      owner_name: storeResult.rows[0]?.owner_name,
      email: storeResult.rows[0]?.email,
      mobile_number: storeResult.rows[0]?.mobile_number
    }));

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching settlements:', error);
    res.status(500).json({ error: 'Failed to fetch settlements' });
  }
});

// Get Pending Settlement Amount
router.get('/pending-settlement/:storeId', authenticateToken, async (req, res) => {
  try {
    const { storeId } = req.params;
    
    // Verify store ID matches the authenticated user's store
    const requestedStoreId = parseInt(storeId, 10);
    const userStoreId = parseInt(req.user.storeId, 10);
    
    if (isNaN(requestedStoreId) || isNaN(userStoreId)) {
      return res.status(400).json({ error: 'Invalid store ID format' });
    }

    if (requestedStoreId !== userStoreId) {
      return res.status(403).json({ error: 'Unauthorized: Store ID mismatch' });
    }

    // Calculate total transactions and settlements including requested amounts
    const result = await pool.query(
      `WITH 
       total_txn AS (
         SELECT COALESCE(SUM(amount), 0) as total_amount
         FROM transactions 
         WHERE store_id = $1 AND status = 'completed'
       ),
       completed_settlements AS (
         SELECT COALESCE(SUM(total_transaction_amount), 0) as completed_amount
         FROM settlements
         WHERE store_id = $1 AND status = 'completed'
       ),
       active_settlements AS (
         SELECT 
           COALESCE(SUM(CASE WHEN status = 'approved' THEN settled_amount ELSE 0 END), 0) as total_settled,
           COALESCE(SUM(CASE WHEN status = 'requested' THEN pending_amount ELSE 0 END), 0) as total_requested
         FROM settlements
         WHERE store_id = $1 AND status IN ('requested', 'pending', 'approved')
       )
       SELECT
         t.total_amount,
         c.completed_amount,
         s.total_settled,
         s.total_requested,
         GREATEST(
           t.total_amount - (c.completed_amount + s.total_settled + s.total_requested), 
           0
         ) as pending_amount
       FROM total_txn t, completed_settlements c, active_settlements s`,
      [storeId]
    );

    const {
      total_amount,
      completed_amount,
      total_settled,
      total_requested,
      pending_amount
    } = result.rows[0];

    res.json({
      amount: parseFloat(pending_amount),
      totalAmount: parseFloat(total_amount),
      settledAmount: parseFloat(total_settled),
      requestedAmount: parseFloat(total_requested),
      completedAmount: parseFloat(completed_amount)
    });
  } catch (error) {
    console.error('Error fetching pending settlement:', error);
    res.status(500).json({ error: 'Failed to fetch pending settlement' });
  }
});

// Request Settlement
router.post('/request-settlement', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { storeId, amount } = req.body;

    // Verify store ID matches the authenticated user's store
    if (storeId !== req.user.storeId) {
      throw new Error('Unauthorized: Store ID mismatch');
    }

    // Calculate available amount for settlement
    const result = await client.query(
      `WITH 
       total_txn AS (
         SELECT COALESCE(SUM(amount), 0) as total_amount
         FROM transactions 
         WHERE store_id = $1 AND status = 'completed'
       ),
       completed_settlements AS (
         SELECT COALESCE(SUM(total_transaction_amount), 0) as completed_amount
         FROM settlements
         WHERE store_id = $1 AND status = 'completed'
       ),
       active_settlements AS (
         SELECT 
           COALESCE(SUM(CASE WHEN status = 'approved' THEN settled_amount ELSE 0 END), 0) as total_settled,
           COALESCE(SUM(CASE WHEN status = 'requested' THEN pending_amount ELSE 0 END), 0) as total_requested
         FROM settlements
         WHERE store_id = $1 AND status IN ('requested', 'pending', 'approved')
       )
       SELECT
         t.total_amount,
         c.completed_amount,
         s.total_settled,
         s.total_requested,
         GREATEST(
           t.total_amount - (c.completed_amount + s.total_settled + s.total_requested), 
           0
         ) as pending_amount
       FROM total_txn t, completed_settlements c, active_settlements s`,
      [storeId]
    );

    const {
      pending_amount
    } = result.rows[0];

    if (amount > pending_amount) {
      throw new Error('Settlement amount exceeds pending amount');
    }

    // Create settlement request with formatted reference ID
    const settlementResult = await client.query(
      `INSERT INTO settlements 
       (store_id, total_transaction_amount, settled_amount, pending_amount, status, reference_id, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        storeId,
        amount,
        0,                    // Initial settled amount
        amount,               // Initial pending amount
        'requested',          // Initial status
        'SET' + String(Date.now()).padStart(10, '0'),
        req.user.userId
      ]
    );

    // Create settlement log
    await client.query(
      `INSERT INTO settlement_logs 
       (settlement_id, action_type, amount, notes, created_by) 
       VALUES ($1, $2, $3, $4, $5)`,
      [settlementResult.rows[0].settlement_id, 'request', amount, 'Settlement requested', req.user.userId]
    );

    await client.query('COMMIT');

    // Emit socket event for real-time updates
    req.app.get('io').emit('settlementUpdate', {
      storeId,
      settlement: settlementResult.rows[0]
    });

    res.json(settlementResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error requesting settlement:', error);
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Get store daily stats
// Get store daily stats
router.get('/stores/:storeId/daily-stats', authenticateToken, async (req, res) => {
  try {
    const storeId = parseInt(req.params.storeId, 10);
    const userStoreId = parseInt(req.user.storeId, 10);

    // Verify store ID matches authenticated user's store
    if (storeId !== userStoreId) {
      return res.status(403).json({ error: 'Unauthorized access to store data' });
    }

    // Get daily stats (total sales and transactions)
    const dailyStatsQuery = `
      SELECT 
        COUNT(*) as total_transactions,
        COALESCE(SUM(amount), 0)::float as total_amount
      FROM transactions
      WHERE store_id = $1
      AND DATE(transaction_date) = CURRENT_DATE
      AND status = 'completed'`;

    const dailyStatsResult = await pool.query(dailyStatsQuery, [storeId]);

    // Get pending settlement amount from store_settlements table
    const pendingSettlementQuery = `
      SELECT COALESCE(pending_amount, 0)::float as pending_amount
      FROM store_settlements
      WHERE store_id = $1`;    

    const pendingResult = await pool.query(pendingSettlementQuery, [storeId]);

    res.json({
      totalTransactions: parseInt(dailyStatsResult.rows[0].total_transactions),
      totalSales: parseFloat(dailyStatsResult.rows[0].total_amount),
      pendingSettlement: parseFloat(pendingResult.rows[0].pending_amount)
    });
  } catch (error) {
    console.error('Error fetching daily stats:', error);
    res.status(500).json({ error: 'Failed to fetch daily stats' });
  }
});


// Get store transactions
router.get('/stores/:storeId/transactions', authenticateToken, async (req, res) => {
  try {
    const { storeId } = req.params;
    const { startDate, endDate } = req.query;

    const result = await pool.query(
      `SELECT t.*, s.student_name, s.roll_number 
       FROM transactions t 
       LEFT JOIN students s ON t.student_id = s.student_id 
       WHERE t.store_id = $1 
       AND DATE(t.transaction_date) BETWEEN $2 AND $3 
       ORDER BY t.transaction_date DESC`,
      [storeId, startDate, endDate]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});


// Get store settlements
router.get('/settlements/store/:storeId', authenticateToken, async (req, res) => {
  try {
    const storeId = parseInt(req.params.storeId, 10);
    const userStoreId = parseInt(req.user.storeId, 10);

    if (storeId !== userStoreId) {
      return res.status(403).json({ error: 'Unauthorized: Store ID mismatch' });
    }

    // Get store details
    const storeResult = await pool.query(
      `SELECT store_name, owner_name, email, mobile_number
       FROM stores WHERE store_id = $1`,
      [storeId]
    );

    if (storeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Store not found' });
    }

    // Get settlements with logs
    const result = await pool.query(
      `SELECT 
        s.*,
        COALESCE(json_agg(
          json_build_object(
            'log_id', sl.log_id,
            'action_type', sl.action_type,
            'amount', sl.amount,
            'notes', sl.notes,
            'log_date', sl.log_date
          ) ORDER BY sl.log_date DESC
        ) FILTER (WHERE sl.log_id IS NOT NULL), '[]') as logs
       FROM settlements s
       LEFT JOIN settlement_logs sl ON s.settlement_id = sl.settlement_id
       WHERE s.store_id = $1
       GROUP BY s.settlement_id
       ORDER BY s.created_at DESC`,
      [storeId]
    );

    // Add store details to each settlement
    const settlements = result.rows.map(row => ({
      ...row,
      store_name: storeResult.rows[0].store_name,
      owner_name: storeResult.rows[0].owner_name,
      email: storeResult.rows[0].email,
      mobile_number: storeResult.rows[0].mobile_number
    }));

    res.json(settlements);
  } catch (error) {
    console.error('Error fetching settlements:', error);
    res.status(500).json({ error: 'Failed to fetch settlements' });
  }
});

// Get pending settlement amount
router.get('/settlements/store/:storeId/pending', authenticateToken, async (req, res) => {
  try {
    const storeId = parseInt(req.params.storeId, 10);
    const userStoreId = parseInt(req.user.storeId, 10);

    if (storeId !== userStoreId) {
      return res.status(403).json({ error: 'Unauthorized: Store ID mismatch' });
    }

    const query = `
      WITH 
       total_txn AS (
         SELECT COALESCE(SUM(amount), 0) as total_amount
         FROM transactions 
         WHERE store_id = $1 AND status = 'completed'
       ),
       completed_settlements AS (
         SELECT COALESCE(SUM(total_transaction_amount), 0) as completed_amount
         FROM settlements
         WHERE store_id = $1 AND status = 'completed'
       ),
       active_settlements AS (
         SELECT 
           COALESCE(SUM(CASE WHEN status = 'approved' THEN settled_amount ELSE 0 END), 0) as total_settled,
           COALESCE(SUM(CASE WHEN status = 'requested' THEN pending_amount ELSE 0 END), 0) as total_requested
         FROM settlements
         WHERE store_id = $1 AND status IN ('requested', 'pending', 'approved')
       )
       SELECT
         t.total_amount,
         c.completed_amount,
         s.total_settled,
         s.total_requested,
         GREATEST(
           t.total_amount - (c.completed_amount + s.total_settled + s.total_requested), 
           0
         ) as pending_amount
       FROM total_txn t, completed_settlements c, active_settlements s`;

    const result = await pool.query(query, [storeId]);
    const row = result.rows[0] || { total_amount: '0', total_settled: '0', total_requested: '0', pending_amount: '0' };
    
    res.json({
      totalAmount: parseFloat(row.total_amount),
      pendingAmount: parseFloat(row.pending_amount)
    });
  } catch (error) {
    console.error('Error fetching pending amount:', error);
    res.status(500).json({ error: 'Failed to fetch pending amount' });
  }
});

// Get all settlements
router.get('/settlements', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, st.store_name, st.owner_name, st.mobile_number, st.email
       FROM settlements s
       JOIN stores st ON s.store_id = st.store_id
       ORDER BY s.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching settlements:', error);
    res.status(500).json({ error: 'Failed to fetch settlements' });
  }
});

// Process Settlement Payment
router.post('/settlements/:settlementId/pay', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { settlementId } = req.params;
    const { amount } = req.body;

    console.log('Processing payment:', { settlementId, amount });

    // Get current settlement with store details
    const settlementResult = await client.query(
      `SELECT s.*, st.store_name 
       FROM settlements s 
       JOIN stores st ON s.store_id = st.store_id 
       WHERE s.settlement_id = $1`,
      [settlementId]
    );

    if (settlementResult.rows.length === 0) {
      throw new Error('Settlement not found');
    }

    const settlement = settlementResult.rows[0];
    console.log('Current settlement:', settlement);
    
    if (settlement.status === 'completed') {
      throw new Error('Settlement is already completed');
    }

    if (amount > settlement.pending_amount) {
      throw new Error('Payment amount exceeds pending amount');
    }

    // Parse all amounts to ensure they are numbers
    const currentSettledAmount = parseFloat(settlement.settled_amount);
    const currentPendingAmount = parseFloat(settlement.pending_amount);
    const totalAmount = parseFloat(settlement.total_transaction_amount);
    const paymentAmount = parseFloat(amount);

    // Calculate new amounts with proper precision
    const newSettledAmount = parseFloat((currentSettledAmount + paymentAmount).toFixed(2));
    const newPendingAmount = parseFloat((totalAmount - newSettledAmount).toFixed(2));
    const newStatus = Math.abs(newPendingAmount) <= 0.01 ? 'completed' : 'pending';

    console.log('Calculated amounts:', {
      currentSettledAmount,
      currentPendingAmount,
      totalAmount,
      paymentAmount,
      newSettledAmount,
      newPendingAmount,
      newStatus
    });

    // Update settlement
    const updatedSettlement = await client.query(
      `UPDATE settlements 
       SET settled_amount = $1, 
           pending_amount = $2,
           status = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE settlement_id = $4
       RETURNING *`,
      [newSettledAmount, newPendingAmount, newStatus, settlementId]
    );

    console.log('Updated settlement:', updatedSettlement.rows[0]);

    // If this was the final payment, update store_settlements
    if (newStatus === 'completed') {
      await client.query(
        `UPDATE store_settlements 
         SET pending_amount = GREATEST(pending_amount - $1, 0),
             last_settlement_date = CURRENT_TIMESTAMP
         WHERE store_id = $2`,
        [settlement.total_transaction_amount, settlement.store_id]
      );
      console.log('Updated store_settlements for completed payment');
    }

    // Create settlement log
    await client.query(
      `INSERT INTO settlement_logs 
       (settlement_id, action_type, amount, notes, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [settlementId, 'payment', amount, 'Payment processed', req.user.userId]
    );

    await client.query('COMMIT');

    // Get updated amounts for the store
    const updatedAmounts = await client.query(
      `WITH 
       total_txn AS (
         SELECT COALESCE(SUM(amount), 0) as total_amount
         FROM transactions 
         WHERE store_id = $1 AND status = 'completed'
       ),
       completed_settlements AS (
         SELECT COALESCE(SUM(total_transaction_amount), 0) as completed_amount
         FROM settlements
         WHERE store_id = $1 AND status = 'completed'
       ),
       active_settlements AS (
         SELECT 
           COALESCE(SUM(CASE WHEN status = 'approved' THEN settled_amount ELSE 0 END), 0) as total_settled,
           COALESCE(SUM(CASE WHEN status = 'requested' THEN pending_amount ELSE 0 END), 0) as total_requested
         FROM settlements
         WHERE store_id = $1 AND status IN ('requested', 'pending', 'approved')
       )
       SELECT
         t.total_amount,
         c.completed_amount,
         s.total_settled,
         s.total_requested,
         GREATEST(
           t.total_amount - (c.completed_amount + s.total_settled + s.total_requested), 
           0
         ) as pending_amount
       FROM total_txn t, completed_settlements c, active_settlements s`,
      [settlement.store_id]
    );

    // Get the final settlement state with store details
    const finalSettlement = await client.query(
      `SELECT s.*, st.store_name, st.owner_name, st.mobile_number, st.email
       FROM settlements s
       JOIN stores st ON s.store_id = st.store_id
       WHERE s.settlement_id = $1`,
      [settlementId]
    );

    // Emit socket event for real-time updates with correct amounts
    const io = req.app.get('io');
    if (io) {
      const room = `store_${settlement.store_id}`;
      io.to(room).emit('settlementUpdate', {
        type: 'settlement_paid',
        data: {
          settlement: finalSettlement.rows[0],
          amount: parseFloat(updatedAmounts.rows[0].pending_amount),
          totalAmount: parseFloat(updatedAmounts.rows[0].total_amount),
          settledAmount: parseFloat(updatedAmounts.rows[0].total_settled),
          requestedAmount: parseFloat(updatedAmounts.rows[0].total_requested),
          completedAmount: parseFloat(updatedAmounts.rows[0].completed_amount)
        }
      });
    }

    console.log('Sending final response');
    res.json({
      success: true,
      settlement: finalSettlement.rows[0],
      amounts: {
        pending: parseFloat(updatedAmounts.rows[0].pending_amount),
        total: parseFloat(updatedAmounts.rows[0].total_amount),
        settled: parseFloat(updatedAmounts.rows[0].total_settled),
        requested: parseFloat(updatedAmounts.rows[0].total_requested),
        completed: parseFloat(updatedAmounts.rows[0].completed_amount)
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing settlement payment:', error);
    res.status(400).json({ error: error.message });
  } finally {
    await client.release();
  }
});

// Get student details by ID
// Get student details
router.get('/students/:studentId', authenticateToken, async (req, res) => {
  try {
    const studentId = parseInt(req.params.studentId, 10);
    if (isNaN(studentId)) {
      return res.status(400).json({ error: 'Invalid student ID format' });
    }
    
    const studentQuery = `
      SELECT 
        s.student_id,
        s.student_name,
        s.class,
        s.father_name,
        s.photo_url,
        s.barcode,
        COALESCE(s.balance, 0)::float as balance,
        COALESCE(s.daily_limit, 0)::float as daily_limit,
        COALESCE(s.daily_spent, 0)::float as daily_spent,
        COALESCE((
          SELECT SUM(amount) 
          FROM transactions 
          WHERE student_id = s.student_id 
          AND DATE(transaction_date) = CURRENT_DATE
        ), 0)::float as today_spent
      FROM students s
      WHERE s.student_id = $1`;

    const studentResult = await pool.query(studentQuery, [studentId]);

    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json(studentResult.rows[0]);
  } catch (error) {
    console.error('Error fetching student:', error);
    res.status(500).json({ error: 'Failed to fetch student details' });
  }
});

// Get student balance and limits
router.get('/students/:studentId/balance', authenticateToken, async (req, res) => {
  try {
    const { studentId } = req.params;
    const query = `
      SELECT
        balance,
        daily_limit,
        daily_spent
      FROM students 
      WHERE student_id = $1
    `;

    const result = await pool.query(query, [studentId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching student:', error);
    res.status(500).json({ error: 'Failed to fetch student details' });
  }
});

// Process transaction
router.post('/transaction', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { studentId, amount } = req.body;
    const storeId = parseInt(req.user.storeId, 10);

    await client.query('BEGIN');

    // Check and reset daily limit if needed
    // Get the current date in IST
    const currentDate = new Date();
    const istOptions = { timeZone: 'Asia/Kolkata' };
    const istDateStr = currentDate.toLocaleDateString('en-US', istOptions);
    
    // Check if global reset has happened since last transaction
    const globalLastResetTime = global.dailyLimitsLastReset ? new Date(global.dailyLimitsLastReset) : null;
    
    await client.query(`
      UPDATE students 
      SET daily_spent = 0, 
          last_spent_reset = CURRENT_DATE 
      WHERE student_id = $1 
      AND (last_spent_reset IS NULL OR last_spent_reset < CURRENT_DATE)
    `, [studentId]);
    
    // Log daily limit reset check
    console.log(`Daily limit check for student ${studentId} at ${currentDate.toISOString()}`);
    console.log(`Last global reset: ${globalLastResetTime ? globalLastResetTime.toISOString() : 'None'}`);

    // Get student details
    const studentResult = await client.query(
      'SELECT balance, daily_limit, daily_spent FROM students WHERE student_id = $1 FOR UPDATE',
      [studentId]
    );

    if (studentResult.rows.length === 0) {
      throw new Error('Student not found');
    }

    const student = studentResult.rows[0];
    const transactionAmount = parseFloat(amount);

    // Validate transaction
    if (transactionAmount <= 0) {
      throw new Error('Invalid transaction amount');
    }

    if (student.balance < transactionAmount) {
      throw new Error('Insufficient balance');
    }

    // Check if global reset has happened since last transaction
    const studentLastResetTime = global.dailyLimitsLastReset ? new Date(global.dailyLimitsLastReset) : null;
    const lastSpentReset = student.last_spent_reset ? new Date(student.last_spent_reset) : null;
    
    // Log daily limit check details for debugging
    console.log(`Transaction check for student ${studentId}:`);
    console.log(`- Current daily spent: ${student.daily_spent}`);
    console.log(`- Daily limit: ${student.daily_limit}`);
    console.log(`- Last spent reset: ${lastSpentReset ? lastSpentReset.toISOString() : 'None'}`);
    console.log(`- Last global reset: ${studentLastResetTime ? studentLastResetTime.toISOString() : 'None'}`);
    
    // Calculate new daily spent
    const newDailySpent = parseFloat(student.daily_spent) + transactionAmount;
    console.log(`- New daily spent would be: ${newDailySpent}`);
    
    if (newDailySpent > student.daily_limit) {
      throw new Error(`Daily limit exceeded. Limit: ${student.daily_limit}, Current: ${student.daily_spent}, Attempted: ${transactionAmount}`);
    }

    // Update student balance and daily spent
    await client.query(
      'UPDATE students SET balance = balance - $1, daily_spent = daily_spent + $1 WHERE student_id = $2',
      [transactionAmount, studentId]
    );

    // Create transaction record
    const transactionResult = await client.query(
      `INSERT INTO transactions 
        (student_id, store_id, amount, transaction_type, status, settlement_status) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [studentId, storeId, transactionAmount, 'purchase', 'completed', 'pending']
    );

    // Update store balance
    await client.query(
      'UPDATE stores SET balance = balance + $1 WHERE store_id = $2',
      [transactionAmount, storeId]
    );

    await client.query('COMMIT');

    // Get updated student balance
    const updatedStudent = await client.query(
      'SELECT balance, daily_spent FROM students WHERE student_id = $1',
      [studentId]
    );

    // Emit WebSocket event
    const io = req.app.get('io');
    io.to(`store_${storeId}`).emit('transactionUpdate', {
      type: 'transaction',
      data: transactionResult.rows[0]
    });

    res.json({
      message: 'Transaction successful',
      transaction: transactionResult.rows[0],
      currentBalance: updatedStudent.rows[0].balance,
      dailySpent: updatedStudent.rows[0].daily_spent
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Transaction error:', error);
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Request settlement
router.post('/settlements/request', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { amount } = req.body;
    const storeId = parseInt(req.user.storeId, 10);
    
    await client.query('BEGIN');

    // Get total transactions and current settlements
    const amountResult = await client.query(
      `WITH 
       total_txn AS (
         SELECT COALESCE(SUM(amount), 0) as total_amount
         FROM transactions 
         WHERE store_id = $1 AND status = 'completed'
       ),
       completed_settlements AS (
         SELECT COALESCE(SUM(total_transaction_amount), 0) as completed_amount
         FROM settlements
         WHERE store_id = $1 AND status = 'completed'
       ),
       active_settlements AS (
         SELECT 
           COALESCE(SUM(CASE WHEN status = 'approved' THEN settled_amount ELSE 0 END), 0) as total_settled,
           COALESCE(SUM(CASE WHEN status = 'requested' THEN pending_amount ELSE 0 END), 0) as total_requested
         FROM settlements
         WHERE store_id = $1 AND status IN ('requested', 'pending', 'approved')
       )
       SELECT
         t.total_amount,
         c.completed_amount,
         s.total_settled,
         s.total_requested,
         GREATEST(
           t.total_amount - (c.completed_amount + s.total_settled + s.total_requested), 
           0
         ) as pending_amount
       FROM total_txn t, completed_settlements c, active_settlements s`,
      [storeId]
    );

    if (amountResult.rows.length === 0) {
      throw new Error('No transactions found');
    }

    const totalAmount = parseFloat(amountResult.rows[0].total_amount);
    const pendingAmount = parseFloat(amountResult.rows[0].pending_amount);
    const currentRequestedAmount = parseFloat(amountResult.rows[0].total_requested);
    const currentSettledAmount = parseFloat(amountResult.rows[0].total_settled);
    const completedAmount = parseFloat(amountResult.rows[0].completed_amount);
    const settlementAmount = parseFloat(amount);

    if (settlementAmount <= 0) {
      throw new Error('Invalid settlement amount');
    }

    if (settlementAmount > pendingAmount) {
      throw new Error(`Settlement amount (${settlementAmount}) cannot exceed pending amount (${pendingAmount})`);
    }

    // Create settlement record
    const settlementResult = await client.query(
      `INSERT INTO settlements (
        store_id,
        total_transaction_amount,
        settled_amount,
        pending_amount,
        status,
        reference_id,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        storeId,
        settlementAmount,
        0,                    // Initial settled amount
        settlementAmount,     // Initial pending amount
        'requested',          // Initial status
        'SET' + String(Date.now()).padStart(10, '0'),
        req.user.user_id
      ]
    );

    // Get store details
    const storeResult = await client.query(
      `SELECT store_name, owner_name, mobile_number, email
       FROM stores
       WHERE store_id = $1`,
      [storeId]
    );

    // Combine settlement with store details
    const settlementWithDetails = {
      ...settlementResult.rows[0],
      ...storeResult.rows[0]
    };

    // Calculate new amounts
    const newPendingAmount = Math.max(0, totalAmount - (completedAmount + currentSettledAmount + (currentRequestedAmount + settlementAmount)));
    const newRequestedAmount = currentRequestedAmount + settlementAmount;

    await client.query('COMMIT');

    const responseData = {
      settlement: settlementWithDetails,
      amounts: {
        pending: newPendingAmount,
        total: totalAmount,
        settled: currentSettledAmount,
        requested: newRequestedAmount,
        completed: completedAmount
      }
    };

    // Emit socket event to update frontend with correct amounts
    const io = req.app.get('io');
    if (io) {
      const room = `store_${storeId}`;
      io.to(room).emit('settlementUpdate', {
        type: 'settlement_request',
        data: {
          ...responseData,
          amount: responseData.amounts.pending,
          totalAmount: responseData.amounts.total,
          settledAmount: responseData.amounts.settled,
          requestedAmount: responseData.amounts.requested,
          completedAmount: responseData.amounts.completed
        }
      });
    }

    res.json({
      success: true,
      ...responseData
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Settlement request error:', error);
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
