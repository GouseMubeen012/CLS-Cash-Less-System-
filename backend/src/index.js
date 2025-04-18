const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const cron = require('node-cron');
const pool = require('./db/config');
const storeRoutes = require('./routes/store');
const fs = require('fs');

// Create uploads directory if it doesn't exist
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}

const app = express();

// Serve static files from uploads directory
app.use('/uploads', express.static('uploads'));
const server = http.createServer(app);

// Function to reset stale daily limits
async function resetStaleDailyLimits() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      UPDATE students 
      SET daily_spent = 0, 
          last_spent_reset = CURRENT_DATE 
      WHERE last_spent_reset < CURRENT_DATE
    `);
    console.log('Reset stale daily limits at:', new Date().toISOString());
    return result;
  } catch (error) {
    console.error('Error resetting stale daily limits:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Function to reset daily spent amounts
async function resetDailySpent() {
  const client = await pool.connect();
  try {
    // Force update all students regardless of last_spent_reset
    const result = await client.query(`
      UPDATE students 
      SET daily_spent = 0, 
          last_spent_reset = CURRENT_DATE 
      RETURNING student_id, student_name, daily_spent, last_spent_reset
    `);
    
    const resetCount = result.rows.length;
    console.log(`Successfully reset daily limits for ${resetCount} students at:`, new Date().toISOString());
    console.log('Reset details:', result.rows);
    
    // Emit an event that daily limits have been reset
    global.dailyLimitsLastReset = new Date().toISOString();
    
    return result;
  } catch (error) {
    console.error('Error resetting daily spent amounts:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Reset stale limits on startup and log result
resetStaleDailyLimits().then(() => {
  console.log('Initial stale limit reset completed at', new Date().toISOString());
}).catch(error => {
  console.error('Failed to reset stale limits on startup:', error);
});

// Configure cron job for daily reset at 12:45 AM IST
const dailyResetJob = cron.schedule('45 0 * * *', async () => {
  console.log('Starting daily limit reset cron job at:', new Date().toISOString());
  try {
    await resetDailySpent();
    console.log('Daily limit reset completed successfully');
  } catch (error) {
    console.error('Failed to run scheduled daily reset:', error);
  }
}, {
  scheduled: true,
  timezone: "Asia/Kolkata"
});

// Verify cron job registration
if (dailyResetJob) {
  const now = new Date();
  const nextReset = new Date(now);
  
  // If it's already past 12:45 AM, schedule for next day
  if (now.getHours() > 0 || (now.getHours() === 0 && now.getMinutes() >= 45)) {
    nextReset.setDate(nextReset.getDate() + 1);
  }
  
  nextReset.setHours(0, 45, 0, 0);
  
  console.log('Daily reset cron job registered successfully');
  console.log('Current time:', now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  console.log('Next reset scheduled for:', nextReset.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  
  // Initialize global variable to track last reset time
  global.dailyLimitsLastReset = new Date().toISOString();
} else {
  console.error('Failed to register daily reset cron job');
}

// Manual reset endpoint (for testing and admin use)
app.post('/api/reset-daily-spent', async (req, res) => {
  try {
    const result = await resetDailySpent();
    res.json({ 
      message: 'Daily spent amounts reset successfully',
      resetCount: result.rows.length,
      resetTime: new Date().toISOString(),
      resetDetails: result.rows
    });
  } catch (error) {
    console.error('Error in manual reset:', error);
    res.status(500).json({ error: 'Failed to reset daily limits' });
  }
});

// Check daily limit reset status endpoint
app.get('/api/daily-limit-status', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query(`
      SELECT 
        COUNT(*) as total_students,
        COUNT(CASE WHEN last_spent_reset = CURRENT_DATE THEN 1 END) as reset_today,
        COUNT(CASE WHEN last_spent_reset < CURRENT_DATE OR last_spent_reset IS NULL THEN 1 END) as needs_reset
      FROM students
    `);
    
    const now = new Date();
    const istTime = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
    
    const nextReset = new Date(now);
    if (now.getHours() > 0 || (now.getHours() === 0 && now.getMinutes() >= 45)) {
      nextReset.setDate(nextReset.getDate() + 1);
    }
    nextReset.setHours(0, 45, 0, 0);
    
    res.json({
      current_time: istTime,
      next_scheduled_reset: nextReset.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }),
      last_global_reset: global.dailyLimitsLastReset || 'Not reset since server start',
      stats: result.rows[0]
    });
    
    client.release();
  } catch (error) {
    console.error('Error checking daily limit status:', error);
    res.status(500).json({ error: 'Failed to check daily limit status' });
  }
});

// Force reset daily limits endpoint (for testing)
app.post('/api/force-reset-daily-limits', async (req, res) => {
  try {
    await resetDailySpent();
    res.json({ 
      message: 'Daily limits forcefully reset',
      timestamp: new Date().toISOString(),
      last_reset: global.dailyLimitsLastReset
    });
  } catch (error) {
    console.error('Error forcing daily limit reset:', error);
    res.status(500).json({ error: 'Failed to force reset daily limits' });
  }
});

// Basic middleware setup
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:4000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

// Socket.IO setup with proper error handling
const io = socketIo(server, {
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:4000'],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

// Socket.IO error handling
io.engine.on("connection_error", (err) => {
  console.log('Socket.IO connection error:', err);
});

// Socket.IO authentication middleware
io.use(async (socket, next) => {
  try {
    // Try both auth methods
    const authHeader = socket.handshake.headers.authorization;
    const token = socket.handshake.auth.token || 
                 (authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null);

    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }

    // Verify token
    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, decoded) => {
      if (err) {
        console.error('Socket auth error:', err);
        return next(new Error('Authentication error: Invalid token'));
      }
      socket.user = decoded;
      next();
    });
  } catch (error) {
    console.error('Socket middleware error:', error);
    next(new Error('Internal server error'));
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Join store-specific room if available
  if (socket.user && socket.user.storeId) {
    const room = `store_${socket.user.storeId}`;
    socket.join(room);
    console.log(`Client ${socket.id} joined room ${room}`);
  }

  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });

  socket.on('disconnect', (reason) => {
    console.log('Client disconnected:', socket.id, 'Reason:', reason);
  });
});

// Make io available to routes
app.set('io', io);

// Emit events for store updates
const emitStoreUpdate = (storeId, eventType, data) => {
  io.to(`store_${storeId}`).emit(eventType, data);
};

// Bank Admin Login route
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('Login attempt:', email);
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const userQuery = await pool.query(
      'SELECT user_id, role, name, email, password_hash FROM users WHERE email = $1',
      [email]
    );

    if (userQuery.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userQuery.rows[0];
    console.log('User found:', user.role);

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { 
        userId: user.user_id, 
        role: user.role,
        name: user.name,
        email: user.email
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    console.log('Login successful for:', email);
    res.json({
      token,
      user: {
        id: user.user_id,
        role: user.role,
        name: user.name,
        email: user.email
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Mount store routes
app.use('/api/store', storeRoutes);

// Authentication middleware for protected routes
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// Token verification endpoint
app.get('/api/verify-token', authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// Protected routes
app.use('/api/students', authenticateToken);
app.use('/api/transactions', authenticateToken);
app.use('/api/analytics', authenticateToken);
app.use('/api', storeRoutes);

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Student routes
app.post('/api/students', upload.single('photo'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { student_name, class: studentClass, father_name } = req.body;
    const photo_url = req.file ? `/uploads/${req.file.filename}` : null;

    // Insert student with explicit balance initialization
    const studentResult = await client.query(
      `INSERT INTO students 
       (student_name, class, father_name, photo_url, barcode, balance, daily_limit, daily_spent) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING *`,
      [student_name, studentClass, father_name, photo_url, '', 0.00, 100.00, 0.00]
    );
    const student = studentResult.rows[0];

    // Store raw QR data in barcode field
    const qrData = JSON.stringify({
      student_id: student.student_id,
      type: 'student_card'
    });
    
    // Generate QR code image for display
    const qrCode = await QRCode.toDataURL(qrData, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 300,
      scale: 8
    });

    // Update student with both raw data and QR code
    const updatedStudent = await client.query(
      'UPDATE students SET barcode = $1, qr_data = $2 WHERE student_id = $3 RETURNING *',
      [qrCode, qrData, student.student_id]
    );

    await client.query('COMMIT');

    res.json({ 
      ...updatedStudent.rows[0],
      message: 'Student registered successfully' 
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error registering student:', error);
    
    // Check for duplicate key violations
    if (error.code === '23505') {
      // Extract the duplicate field from the error detail
      const match = error.detail.match(/\((.+?)\)=\((.+?)\)/);
      if (match) {
        const field = match[1];
        const value = match[2];
        
        if (field === 'student_name') {
          return res.status(400).json({ error: `Student with name '${value}' already exists. Please use a different name.` });
        } else if (field === 'email') {
          return res.status(400).json({ error: `Email address '${value}' is already registered. Please use a different email.` });
        } else if (field === 'mobile_number') {
          return res.status(400).json({ error: `Mobile number '${value}' is already registered. Please use a different mobile number.` });
        }
      }
    }
    
    res.status(500).json({ error: 'Failed to register student. Please try again or contact support.' });
  } finally {
    client.release();
  }
});

// Get student details by ID for QR scan
app.get('/api/students/:id/scan', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get student details including balance from student_accounts
    const result = await pool.query(
      `SELECT 
        s.student_id, 
        s.student_name, 
        s.class, 
        s.photo_url, 
        s.daily_limit, 
        s.daily_spent, 
        s.last_spent_reset,
        s.qr_data,
        COALESCE(sa.balance, 0) as balance
       FROM students s
       LEFT JOIN student_accounts sa ON s.student_id = sa.student_id
       WHERE s.student_id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const student = result.rows[0];
    
    // Check if daily spent needs to be reset
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lastReset = student.last_spent_reset ? new Date(student.last_spent_reset) : null;

    if (!lastReset || lastReset < today) {
      // Reset daily spent
      await pool.query(
        'UPDATE students SET daily_spent = 0, last_spent_reset = NOW() WHERE student_id = $1',
        [student.student_id]
      );
      student.daily_spent = 0;
    }

    res.json(student);
  } catch (error) {
    console.error('Error fetching student details:', error);
    res.status(500).json({ error: 'Failed to fetch student details' });
  }
});

// Get daily stats
app.get('/api/daily-stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await pool.query(
      `SELECT 
        COUNT(DISTINCT student_id) as total_students,
        COUNT(*) as total_transactions,
        COALESCE(SUM(amount), 0) as total_amount
       FROM transactions
       WHERE DATE(transaction_date) = CURRENT_DATE`
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching daily stats:', error);
    res.status(500).json({ error: 'Failed to fetch daily stats' });
  }
});

// Set daily limit route
app.post('/api/students/:id/daily-limit', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { daily_limit } = req.body;

    const result = await client.query(
      'UPDATE students SET daily_limit = $1, updated_at = CURRENT_TIMESTAMP WHERE student_id = $2 RETURNING daily_limit',
      [daily_limit, id]
    );

    if (result.rows.length === 0) {
      throw new Error('Student not found');
    }

    res.json({ 
      message: 'Daily limit updated successfully',
      new_limit: result.rows[0].daily_limit 
    });
  } catch (error) {
    console.error('Error updating daily limit:', error);
    res.status(500).json({ error: error.message || 'Failed to update daily limit' });
  } finally {
    client.release();
  }
});

// Recharge route
app.post('/api/recharge', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { student_id, amount, recharge_type, notes } = req.body;

    // First get current balances from both tables
    const studentCheck = await client.query(
      `SELECT 
        s.student_id, 
        s.student_name,
        s.balance as student_balance, 
        sa.balance as account_balance,
        COALESCE((
          SELECT SUM(amount) 
          FROM recharges 
          WHERE student_id = s.student_id
        ), 0) as total_recharges,
        COALESCE((
          SELECT SUM(amount) 
          FROM transactions 
          WHERE student_id = s.student_id 
          AND status = 'completed'
        ), 0) as total_spent
      FROM students s 
      JOIN student_accounts sa ON s.student_id = sa.student_id 
      WHERE s.student_id = $1`,
      [student_id]
    );

    if (studentCheck.rows.length === 0) {
      throw new Error('Student not found');
    }

    const student = studentCheck.rows[0];
    console.log('Current student state:', student);

    // Calculate actual current balance
    const actualBalance = parseFloat(student.total_recharges) - parseFloat(student.total_spent);
    const newBalance = actualBalance + parseFloat(amount);

    // Insert recharge record
    await client.query(
      'INSERT INTO recharges (student_id, amount, recharge_type, notes, created_by) VALUES ($1, $2, $3, $4, $5)',
      [student_id, amount, recharge_type, notes, req.user.userId]
    );

    // Log the recharge
    console.log('Processing recharge:', {
      student_name: student.student_name,
      current_balance: actualBalance,
      recharge_amount: amount,
      new_balance: newBalance,
      recharge_type,
      created_by: req.user.userId
    });

    // Update balance in both tables
    await client.query(
      'UPDATE students SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE student_id = $2',
      [newBalance, student_id]
    );

    const result = await client.query(
      'UPDATE student_accounts SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE student_id = $2 RETURNING balance',
      [newBalance, student_id]
    );

    await client.query('COMMIT');
    res.json({ 
      message: 'Recharge successful',
      new_balance: result.rows[0].balance
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing recharge:', error);
    res.status(500).json({ error: error.message || 'Failed to process recharge' });
  } finally {
    client.release();
  }
});

// Store registration route
app.post('/api/stores', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { store_name, store_type, owner_name, mobile_number, email } = req.body;

    const storeResult = await client.query(
      'INSERT INTO stores (store_name, store_type, owner_name, mobile_number, email) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [store_name, store_type, owner_name, mobile_number, email]
    );
    const store = storeResult.rows[0];

    // Generate store credentials
    const password = Math.random().toString(36).slice(-8);
    const hashedPassword = await bcrypt.hash(password, 10);

    await client.query(
      'INSERT INTO users (role, name, email, password_hash, store_id) VALUES ($1, $2, $3, $4, $5)',
      ['store', store_name, email, hashedPassword, store.store_id]
    );

    // Check if store_settlements record already exists
    const settlementCheck = await client.query(
      'SELECT store_id FROM store_settlements WHERE store_id = $1',
      [store.store_id]
    );
    
    // Only create if it doesn't exist
    if (settlementCheck.rows.length === 0) {
      await client.query(
        'INSERT INTO store_settlements (store_id, pending_amount) VALUES ($1, $2)',
        [store.store_id, 0]
      );
    }

    await client.query('COMMIT');

    // Generate store credentials PDF
    const doc = new PDFDocument();
    const pdfPath = `./uploads/store_${store.store_id}_credentials.pdf`;
    doc.pipe(require('fs').createWriteStream(pdfPath));
    
    doc.fontSize(24).text('Store Credentials', { align: 'center' });
    doc.moveDown();
    doc.fontSize(16);
    doc.text(`Store ID: ${store.store_id}`);
    doc.text(`Store Name: ${store_name}`);
    doc.text(`Store Type: ${store_type}`);
    doc.text(`Owner Name: ${owner_name}`);
    doc.text(`Mobile: ${mobile_number}`);
    doc.text(`Email: ${email}`);
    doc.moveDown();
    doc.fontSize(14).text('Login Credentials:', { underline: true });
    doc.text(`Email: ${email}`);
    doc.text(`Password: ${password}`);
    doc.end();

    res.json({
      store,
      credentials: {
        email,
        password,
        pdfUrl: `/uploads/store_${store.store_id}_credentials.pdf`
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error registering store:', error);
    
    // Check for duplicate key violations
    if (error.code === '23505') {
      // Extract the duplicate field from the error detail
      const match = error.detail.match(/\((.+?)\)=\((.+?)\)/);
      if (match) {
        const field = match[1];
        const value = match[2];
        
        if (field === 'store_name') {
          return res.status(400).json({ error: `Store with name '${value}' already exists. Please use a different name.` });
        } else if (field === 'email') {
          return res.status(400).json({ error: `Email address '${value}' is already registered. Please use a different email.` });
        } else if (field === 'mobile_number') {
          return res.status(400).json({ error: `Mobile number '${value}' is already registered. Please use a different mobile number.` });
        } else if (field === 'store_id' && error.constraint === 'store_settlements_store_id_key') {
          // This should not happen with our fix, but just in case
          return res.status(400).json({ error: `Store with ID '${value}' already has a settlement record. Please contact support.` });
        }
      }
    }
    
    res.status(500).json({ error: 'Failed to register store. Please try again or contact support.' });
  } finally {
    client.release();
  }
});

// Get students route
// Get student balance
app.get('/api/students/:studentId/balance', async (req, res) => {
  try {
    const { studentId } = req.params;
    const result = await pool.query(
      `SELECT 
        COALESCE((
          SELECT SUM(amount) 
          FROM recharges 
          WHERE student_id = $1
        ), 0) - COALESCE((
          SELECT SUM(amount) 
          FROM transactions 
          WHERE student_id = $1 
          AND status = 'completed'
        ), 0) as balance`,
      [studentId]
    );

    res.json({ balance: parseFloat(result.rows[0].balance) });
  } catch (error) {
    console.error('Error fetching student balance:', error);
    res.status(500).json({ error: 'Failed to fetch student balance' });
  }
});

// Get student ID card
app.get('/api/students/:studentId/id-card', authenticateToken, async (req, res) => {
  try {
    const { studentId } = req.params;
    
    // Get student details
    const result = await pool.query(
      'SELECT * FROM students WHERE student_id = $1',
      [studentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const student = result.rows[0];

    // Set response headers for PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=student_${student.student_id}_id_card.pdf`);
    // Prevent caching
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Generate and send the ID card
    await generateStudentIDCard(student, res);
  } catch (error) {
    console.error('Error generating ID card:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate ID card' });
    }
  }
});

app.get('/api/students', async (req, res) => {
  try {
    const { search } = req.query;
    let query = `
      SELECT s.*, sa.balance 
      FROM students s 
      LEFT JOIN student_accounts sa ON s.student_id = sa.student_id
    `;
    
    if (search) {
      query += ` WHERE LOWER(s.student_name) LIKE LOWER($1) OR CAST(s.student_id AS TEXT) LIKE $1`;
    }
    
    query += ` ORDER BY s.created_at DESC`;
    
    const result = await pool.query(
      query,
      search ? [`%${search}%`] : []
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// This cron job is already configured at the top of the file
// with proper timezone settings (Asia/Kolkata)

// Manual reset endpoint (for admin use)
app.post('/api/reset-daily-spent', async (req, res) => {
  try {
    await resetDailySpent();
    res.json({ message: 'Daily spent amounts reset successfully' });
  } catch (error) {
    console.error('Error in manual reset:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Verify token route
app.get('/api/verify-token', (req, res) => {
  res.json({ valid: true });
});

// Set daily limit for a student
app.post('/api/students/:id/daily-limit', async (req, res) => {
  try {
    const { id } = req.params;
    const { daily_limit } = req.body;
    
    // Get current limit
    const currentLimitResult = await pool.query(
      'SELECT daily_limit FROM students WHERE student_id = $1',
      [id]
    );

    const oldLimit = currentLimitResult.rows[0]?.daily_limit;

    // Update student's daily limit
    await pool.query(
      'UPDATE students SET daily_limit = $1, updated_at = CURRENT_TIMESTAMP WHERE student_id = $2',
      [daily_limit, id]
    );

    // Record in history
    await pool.query(
      'INSERT INTO daily_limit_history (student_id, old_limit, new_limit, changed_by, notes) VALUES ($1, $2, $3, $4, $5)',
      [id, oldLimit, daily_limit, req.user.userId, 'Daily limit updated by admin']
    );

    res.json({ message: 'Daily limit updated successfully' });
  } catch (error) {
    console.error('Error updating daily limit:', error);
    res.status(500).json({ error: 'Failed to update daily limit' });
  }
});

// Recharge student account
app.post('/api/recharge', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { student_id, amount, recharge_type, notes } = req.body;

    // Add recharge record
    await client.query(
      'INSERT INTO recharges (student_id, amount, recharge_type, notes, created_by) VALUES ($1, $2, $3, $4, $5)',
      [student_id, amount, recharge_type, notes, req.user.userId]
    );

    // Update student balance
    await client.query(
      'UPDATE students SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE student_id = $2',
      [amount, student_id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Recharge successful' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing recharge:', error);
    res.status(500).json({ error: 'Failed to process recharge' });
  } finally {
    client.release();
  }
});

// Store registration endpoint has been moved up to avoid duplication

// Get settlements
app.get('/api/settlements', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, st.store_name, st.owner_name, st.email, st.mobile_number
      FROM settlements s
      JOIN stores st ON s.store_id = st.store_id
      ORDER BY s.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching settlements:', error);
    res.status(500).json({ error: 'Failed to fetch settlements' });
  }
});

// Analytics endpoints
app.get('/api/analytics/daily-transactions', async (req, res) => {
  try {
    const result = await pool.query(`
      WITH dates AS (
        SELECT generate_series(
          date_trunc('day', NOW() - INTERVAL '29 days'),
          date_trunc('day', NOW()),
          '1 day'::interval
        )::date as date
      )
      SELECT 
        dates.date,
        COALESCE(COUNT(t.transaction_id), 0) as transaction_count,
        COALESCE(SUM(t.amount), 0) as total_amount
      FROM dates
      LEFT JOIN transactions t ON DATE(t.transaction_date) = dates.date
      GROUP BY dates.date
      ORDER BY dates.date ASC
    `);

    // Format the data for the frontend
    const formattedData = result.rows.map(row => ({
      date: row.date,
      transaction_count: parseInt(row.transaction_count),
      total_amount: parseFloat(row.total_amount)
    }));

    res.json(formattedData);
  } catch (error) {
    console.error('Error fetching daily transactions:', error);
    res.status(500).json({ error: 'Failed to fetch daily transactions' });
  }
});

app.get('/api/analytics/store-sales', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        s.store_name,
        COUNT(t.transaction_id) as transaction_count,
        SUM(t.amount) as total_sales
      FROM stores s
      LEFT JOIN transactions t ON s.store_id = t.store_id
      WHERE t.transaction_date >= NOW() - INTERVAL '30 days'
      GROUP BY s.store_id, s.store_name
      ORDER BY total_sales DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching store sales:', error);
    res.status(500).json({ error: 'Failed to fetch store sales' });
  }
});

// Process settlement payment
app.post('/api/settlements/:id/pay', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { amount } = req.body;

    // Get current settlement
    const settlementResult = await client.query(
      'SELECT * FROM settlements WHERE settlement_id = $1',
      [id]
    );

    const settlement = settlementResult.rows[0];
    if (!settlement) {
      throw new Error('Settlement not found');
    }

    if (settlement.status.toLowerCase() === 'completed') {
      throw new Error('Settlement is already completed');
    }

    const remainingAmount = settlement.total_transaction_amount - settlement.settled_amount;
    if (amount > remainingAmount) {
      throw new Error('Payment amount cannot exceed remaining amount');
    }

    // Update settlement
    const newSettledAmount = settlement.settled_amount + amount;
    const newStatus = newSettledAmount >= settlement.total_transaction_amount ? 'completed' : 'pending';

    await client.query(
      `UPDATE settlements 
       SET settled_amount = $1, 
           pending_amount = total_transaction_amount - $1,
           status = $2,
           updated_at = CURRENT_TIMESTAMP 
       WHERE settlement_id = $3`,
      [newSettledAmount, newStatus, id]
    );

    // Get updated settlement
    const updatedSettlement = await client.query(
      'SELECT * FROM settlements WHERE settlement_id = $1',
      [id]
    );

    // Create settlement log
    await client.query(
      `INSERT INTO settlement_logs 
       (settlement_id, action_type, amount, notes, created_by) 
       VALUES ($1, $2, $3, $4, $5)`,
      [id, 'payment', amount, 'Payment processed', req.user.userId]
    );

    await client.query('COMMIT');
    res.json({ 
      message: 'Payment processed successfully',
      ...updatedSettlement.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing payment:', error);
    res.status(500).json({ error: error.message || 'Failed to process payment' });
  } finally {
    client.release();
  }
});

// Create new settlement
app.post('/api/settlements', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { store_id, total_transaction_amount } = req.body;

    // Create settlement
    const settlementResult = await client.query(
      `INSERT INTO settlements 
       (store_id, total_transaction_amount, settled_amount, pending_amount, status, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING settlement_id`,
      [store_id, total_transaction_amount, 0, total_transaction_amount, 'pending', req.user.userId]
    );

    const settlement_id = settlementResult.rows[0].settlement_id;

    // Create initial settlement log
    await client.query(
      `INSERT INTO settlement_logs 
       (settlement_id, action_type, amount, notes, created_by) 
       VALUES ($1, $2, $3, $4, $5)`,
      [settlement_id, 'create', total_transaction_amount, 'Settlement created', req.user.userId]
    );

    await client.query('COMMIT');
    res.json({ 
      message: 'Settlement created successfully',
      settlement_id
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating settlement:', error);
    res.status(500).json({ error: 'Failed to create settlement' });
  } finally {
    client.release();
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Handle server errors
server.on('error', (error) => {
  console.error('Server error:', error);
});

// Generate Student ID Card PDF
async function generateStudentIDCard(student, res) {
  try {
    // Create PDF with exact dimensions
    const doc = new PDFDocument({
      size: [1292, 800],
      margin: 0
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=student_${student.student_id}_id_card.pdf`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    // Pipe to response
    doc.pipe(res);

    // Add white background
    doc.rect(0, 0, 1292, 800).fill('#ffffff');

    // Add thick blue border line
    doc.lineWidth(6)
       .strokeColor('#000080')
       .rect(25, 25, 1232, 734)
       .stroke();

    // Add school name at top
    doc.font('Helvetica-Bold')
       .fontSize(75)
       .fillColor('#000080')
       .text('Jamiatul Uloom CLS', 0, 50, {
         align: 'center',
         width: 1292
       });

    // Set dimensions for photos
    const photoSize = 300;
    const photoY = 160;
    const leftMargin = 150;
    const rightMargin = 150;
    const leftPhotoX = leftMargin;
    const rightPhotoX = 1292 - rightMargin - photoSize; // Right align QR code

    // Add student photo if available
    if (student.photo_url) {
      try {
        const photoPath = path.join(process.cwd(), student.photo_url.replace(/^\//, ''));
        if (fs.existsSync(photoPath)) {
          doc.image(photoPath, leftPhotoX, photoY, {
            width: photoSize,
            height: photoSize
          });
        }
      } catch (error) {
        console.error('Error adding photo:', error);
      }
    }

    // Generate and add QR code
    const qrData = JSON.stringify({
      id: student.student_id,
      name: student.student_name,
      class: student.class
    });

    const qrPath = path.join(process.cwd(), 'uploads', `student_${student.student_id}_qr.png`);
    await QRCode.toFile(qrPath, qrData, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: photoSize
    });

    // Add QR code
    doc.image(qrPath, rightPhotoX, photoY, {
      width: photoSize,
      height: photoSize
    });

    // Clean up QR file
    fs.unlink(qrPath, (err) => {
      if (err) console.error('Error deleting temporary QR file:', err);
    });

    // Add student details below photos
    const detailsY = photoY + photoSize + 60;
    const detailsX = leftMargin;
    const lineSpacing = 65;

    // Style for details
    doc.font('Helvetica')
       .fontSize(35)
       .fillColor('#000080');

    // Add details with proper label formatting
    doc.text(`Name: ${student.student_name}`, detailsX, detailsY);
    doc.text(`Father Name: ${student.father_name}`, detailsX, detailsY + lineSpacing);
    doc.text(`Class: ${student.class}`, detailsX, detailsY + lineSpacing * 2);
    
    // Explicitly convert student_id to string to ensure it displays correctly
    const studentIdString = String(student.student_id);
    doc.text(`Student ID: ${studentIdString}`, detailsX, detailsY + lineSpacing * 3);

    // Finalize PDF
    doc.end();
  } catch (error) {
    console.error('Error generating ID card:', error);
    throw error;
  }
}
