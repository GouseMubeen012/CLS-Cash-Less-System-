const pool = require('./config');
const bcrypt = require('bcryptjs');

async function dropTables() {
  try {
    await pool.query(`
      DROP TABLE IF EXISTS 
        settlement_logs,
        settlements,
        transactions,
        recharges,
        store_settlements,
        student_accounts,
        users,
        stores,
        students
      CASCADE;
    `);
    console.log('Tables dropped successfully');
  } catch (error) {
    console.error('Error dropping tables:', error);
    throw error;
  }
}

async function createTables() {
  try {
    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id SERIAL PRIMARY KEY,
        role VARCHAR(20) NOT NULL,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        store_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Students table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS students (
        student_id SERIAL PRIMARY KEY,
        student_name VARCHAR(100) NOT NULL,
        class VARCHAR(50) NOT NULL,
        father_name VARCHAR(100) NOT NULL,
        photo_url VARCHAR(255),
        barcode TEXT NOT NULL,
        qr_data TEXT,
        daily_limit DECIMAL(10,2) DEFAULT 100.00,
        daily_spent DECIMAL(10,2) DEFAULT 0.00,
        last_spent_reset DATE DEFAULT CURRENT_DATE,
        balance DECIMAL(10,2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Student Accounts table for balance tracking
    await pool.query(`
      CREATE TABLE IF NOT EXISTS student_accounts (
        account_id SERIAL PRIMARY KEY,
        student_id INTEGER UNIQUE REFERENCES students(student_id),
        balance DECIMAL(10,2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create trigger to automatically create student account
    await pool.query(`
      CREATE OR REPLACE FUNCTION create_student_account()
      RETURNS TRIGGER AS $$
      BEGIN
        INSERT INTO student_accounts (student_id, balance)
        VALUES (NEW.student_id, NEW.balance);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS create_student_account_trigger ON students;
      CREATE TRIGGER create_student_account_trigger
      AFTER INSERT ON students
      FOR EACH ROW
      EXECUTE FUNCTION create_student_account();
    `);

    // Stores table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS stores (
        store_id SERIAL PRIMARY KEY,
        store_name VARCHAR(100) NOT NULL,
        store_type VARCHAR(100) NOT NULL,
        owner_name VARCHAR(100) NOT NULL,
        mobile_number VARCHAR(20) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        balance DECIMAL(10,2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Update foreign key in users table after stores table is created
    await pool.query(`
      ALTER TABLE users 
      ADD CONSTRAINT fk_store 
      FOREIGN KEY (store_id) 
      REFERENCES stores(store_id);
    `);

    // Store Settlements table for tracking pending amounts
    await pool.query(`
      CREATE TABLE IF NOT EXISTS store_settlements (
        id SERIAL PRIMARY KEY,
        store_id INTEGER REFERENCES stores(store_id) UNIQUE,
        pending_amount DECIMAL(10,2) DEFAULT 0.00,
        last_settlement_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create trigger to automatically create store settlement record
    await pool.query(`
      CREATE OR REPLACE FUNCTION create_store_settlement()
      RETURNS TRIGGER AS $$
      BEGIN
        INSERT INTO store_settlements (store_id, pending_amount)
        VALUES (NEW.store_id, 0.00);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS create_store_settlement_trigger ON stores;
      CREATE TRIGGER create_store_settlement_trigger
      AFTER INSERT ON stores
      FOR EACH ROW
      EXECUTE FUNCTION create_store_settlement();
    `);

    // Recharges table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS recharges (
        recharge_id SERIAL PRIMARY KEY,
        student_id INTEGER REFERENCES students(student_id),
        amount DECIMAL(10,2) NOT NULL,
        recharge_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        recharge_type VARCHAR(20) NOT NULL,
        notes TEXT,
        created_by INTEGER REFERENCES users(user_id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Transactions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        transaction_id SERIAL PRIMARY KEY,
        student_id INTEGER REFERENCES students(student_id),
        store_id INTEGER REFERENCES stores(store_id),
        amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) NOT NULL,
        transaction_type VARCHAR(20) NOT NULL,
        daily_limit_at_time DECIMAL(10,2),
        daily_spent_before DECIMAL(10,2),
        transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Settlements table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settlements (
        settlement_id SERIAL PRIMARY KEY,
        store_id INTEGER REFERENCES stores(store_id),
        total_transaction_amount DECIMAL(10,2) NOT NULL,
        settled_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        pending_amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        reference_id VARCHAR(50),
        settlement_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER REFERENCES users(user_id),
        CONSTRAINT check_amounts CHECK (settled_amount >= 0 AND pending_amount >= 0 AND total_transaction_amount = settled_amount + pending_amount)
      );
    `);

    // Settlement Logs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settlement_logs (
        log_id SERIAL PRIMARY KEY,
        settlement_id INTEGER REFERENCES settlements(settlement_id),
        action_type VARCHAR(50) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        log_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        notes TEXT,
        created_by INTEGER REFERENCES users(user_id)
      );
    `);

    // Insert default admin user
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await pool.query(`
      INSERT INTO users (role, name, email, password_hash)
      VALUES ('admin', 'Bank Administrator', 'admin@gmail.com', $1)
      ON CONFLICT (email) DO NOTHING;
    `, [hashedPassword]);

    console.log('Database tables created successfully');
  } catch (error) {
    console.error('Error creating tables:', error);
    throw error;
  }
}

async function runMigrations() {
  try {
    await dropTables();
    await createTables();
    console.log('Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();
