#!/usr/bin/env node

/**
 * Database setup script for Chronologicon Engine
 * This script creates the database and runs the schema migration
 */

require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs').promises;
const path = require('path');

const logger = require('../src/config/logger');

async function setupDatabase() {
  const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  };

  const dbName = process.env.DB_NAME || 'chronologicon_db';
  
  // Connect to PostgreSQL (without specifying database)
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    logger.info('Connected to PostgreSQL server');

    // Check if database exists
    const dbCheckResult = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    );

    if (dbCheckResult.rows.length === 0) {
      // Create database
      await client.query(`CREATE DATABASE ${dbName}`);
      logger.info(`Database '${dbName}' created successfully`);
    } else {
      logger.info(`Database '${dbName}' already exists`);
    }

    await client.end();

    // Connect to the specific database and run schema
    const dbClient = new Client({
      ...dbConfig,
      database: dbName
    });

    await dbClient.connect();
    logger.info(`Connected to database '${dbName}'`);

    // Read and execute schema file
    const schemaPath = path.join(__dirname, '..', 'database_schema.sql');
    const schemaSQL = await fs.readFile(schemaPath, 'utf8');
    
    await dbClient.query(schemaSQL);
    logger.info('Database schema applied successfully');

    await dbClient.end();
    logger.info('Database setup completed successfully');

  } catch (error) {
    logger.error('Database setup failed:', error);
    process.exit(1);
  }
}

// Run setup if called directly
if (require.main === module) {
  setupDatabase();
}

module.exports = setupDatabase;
