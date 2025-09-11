const { query } = require('../config/database');
const logger = require('../config/logger');

class IngestionJob {
  constructor(data) {
    this.job_id = data.job_id;
    this.status = data.status || 'PROCESSING';
    this.file_path = data.file_path;
    this.total_lines = data.total_lines || 0;
    this.processed_lines = data.processed_lines || 0;
    this.error_lines = data.error_lines || 0;
    this.errors = data.errors || [];
    this.start_time = data.start_time;
    this.end_time = data.end_time;
  }

  // Create a new ingestion job
  static async create(jobData) {
    const job = new IngestionJob(jobData);
    
    const queryText = `
      INSERT INTO ingestion_jobs (job_id, status, file_path, total_lines, processed_lines, error_lines, errors, start_time)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    
    const values = [
      job.job_id,
      job.status,
      job.file_path,
      job.total_lines,
      job.processed_lines,
      job.error_lines,
      JSON.stringify(job.errors),
      job.start_time || new Date()
    ];

    try {
      const result = await query(queryText, values);
      return result.rows[0];
    } catch (error) {
      logger.error('Error creating ingestion job:', error);
      throw error;
    }
  }

  // Find job by ID
  static async findById(jobId) {
    const queryText = 'SELECT * FROM ingestion_jobs WHERE job_id = $1';
    
    try {
      const result = await query(queryText, [jobId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error finding job by ID:', error);
      throw error;
    }
  }

  // Update job progress
  static async updateProgress(jobId, updates) {
    const allowedFields = ['status', 'total_lines', 'processed_lines', 'error_lines', 'errors', 'end_time'];
    const updateFields = [];
    const values = [];
    let paramCount = 0;

    Object.keys(updates).forEach(field => {
      if (allowedFields.includes(field)) {
        paramCount++;
        updateFields.push(`${field} = $${paramCount}`);
        
        if (field === 'errors') {
          values.push(JSON.stringify(updates[field]));
        } else {
          values.push(updates[field]);
        }
      }
    });

    if (updateFields.length === 0) {
      throw new Error('No valid fields to update');
    }

    paramCount++;
    const queryText = `
      UPDATE ingestion_jobs 
      SET ${updateFields.join(', ')}
      WHERE job_id = $${paramCount}
      RETURNING *
    `;
    
    values.push(jobId);

    try {
      const result = await query(queryText, values);
      return result.rows[0];
    } catch (error) {
      logger.error('Error updating job progress:', error);
      throw error;
    }
  }

  // Add error to job
  static async addError(jobId, errorMessage) {
    const queryText = `
      UPDATE ingestion_jobs 
      SET errors = errors || $1::jsonb,
          error_lines = error_lines + 1
      WHERE job_id = $2
      RETURNING *
    `;

    try {
      const result = await query(queryText, [JSON.stringify([errorMessage]), jobId]);
      return result.rows[0];
    } catch (error) {
      logger.error('Error adding error to job:', error);
      throw error;
    }
  }

  // Complete job
  static async complete(jobId) {
    const queryText = `
      UPDATE ingestion_jobs 
      SET status = 'COMPLETED',
          end_time = CURRENT_TIMESTAMP
      WHERE job_id = $1
      RETURNING *
    `;

    try {
      const result = await query(queryText, [jobId]);
      return result.rows[0];
    } catch (error) {
      logger.error('Error completing job:', error);
      throw error;
    }
  }

  // Fail job
  static async fail(jobId, errorMessage) {
    const queryText = `
      UPDATE ingestion_jobs 
      SET status = 'FAILED',
          end_time = CURRENT_TIMESTAMP,
          errors = errors || $1::jsonb
      WHERE job_id = $2
      RETURNING *
    `;

    try {
      const result = await query(queryText, [JSON.stringify([errorMessage]), jobId]);
      return result.rows[0];
    } catch (error) {
      logger.error('Error failing job:', error);
      throw error;
    }
  }

  // Get all jobs with optional filtering
  static async getAll(filters = {}) {
    let queryText = 'SELECT * FROM ingestion_jobs WHERE 1=1';
    const values = [];
    let paramCount = 0;

    if (filters.status) {
      paramCount++;
      queryText += ` AND status = $${paramCount}`;
      values.push(filters.status);
    }

    queryText += ' ORDER BY created_at DESC';

    if (filters.limit) {
      paramCount++;
      queryText += ` LIMIT $${paramCount}`;
      values.push(filters.limit);
    }

    try {
      const result = await query(queryText, values);
      return result.rows;
    } catch (error) {
      logger.error('Error getting all jobs:', error);
      throw error;
    }
  }
}

module.exports = IngestionJob;
