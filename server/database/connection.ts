import { Pool } from 'pg';
import { config } from 'dotenv';

config();

// Database connection configuration
const dbConfig = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DATABASE || 'liquidassassin',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || '',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
};

// Create connection pool
export const pool = new Pool(dbConfig);

// Test database connection
export async function testConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    console.log('✅ Database connection successful:', result.rows[0]);
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    return false;
  }
}

// Initialize database schema
export async function initializeDatabase(): Promise<boolean> {
  try {
    const client = await pool.connect();
    
    // Read and execute schema
    const fs = require('fs');
    const path = require('path');
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    await client.query(schema);
    client.release();
    
    console.log('✅ Database schema initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    return false;
  }
}

// Graceful shutdown
export async function closeDatabase(): Promise<void> {
  try {
    await pool.end();
    console.log('✅ Database connection pool closed');
  } catch (error) {
    console.error('❌ Error closing database pool:', error);
  }
}

// Health check
export async function healthCheck(): Promise<{ status: string; timestamp: string; connections: number }> {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as timestamp, (SELECT count(*) FROM pg_stat_activity WHERE state = \'active\') as active_connections');
    client.release();
    
    return {
      status: 'healthy',
      timestamp: result.rows[0].timestamp,
      connections: parseInt(result.rows[0].active_connections)
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      connections: 0
    };
  }
}
