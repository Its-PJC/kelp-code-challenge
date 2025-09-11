const fs = require('fs').promises;
const readline = require('readline');
const { createReadStream } = require('fs');
const { v4: uuidv4 } = require('uuid');
const HistoricalEvent = require('../models/HistoricalEvent');
const IngestionJob = require('../models/IngestionJob');
const logger = require('../config/logger');

class FileIngestionService {
  constructor() {
    this.activeJobs = new Map();
  }

  // Generate unique job ID
  generateJobId() {
    return `ingest-job-${Date.now()}-${uuidv4().substring(0, 8)}`;
  }

  // Start file ingestion process
  async startIngestion(filePath) {
    const jobId = this.generateJobId();
    
    try {
      // Check if file exists
      await fs.access(filePath);
      
      // Create job record
      const job = await IngestionJob.create({
        job_id: jobId,
        file_path: filePath,
        status: 'PROCESSING'
      });

      // Start processing asynchronously
      this.processFile(jobId, filePath).catch(error => {
        logger.error(`Job ${jobId} failed:`, error);
        IngestionJob.fail(jobId, `Processing failed: ${error.message}`);
      });

      return {
        status: "Ingestion initiated",
        jobId: jobId,
        message: `Check /api/events/ingestion-status/${jobId} for updates.`
      };
    } catch (error) {
      logger.error('Error starting ingestion:', error);
      throw new Error(`Failed to start ingestion: ${error.message}`);
    }
  }

  // Process file line by line
  async processFile(jobId, filePath) {
    logger.info(`Starting file processing for job ${jobId}`);
    
    try {
      // First pass: count total lines
      const totalLines = await this.countLines(filePath);
      await IngestionJob.updateProgress(jobId, { total_lines: totalLines });

      const fileStream = createReadStream(filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      let lineNumber = 0;
      let processedLines = 0;
      let errorLines = 0;
      const batchSize = 100;
      let eventBatch = [];

      for await (const line of rl) {
        lineNumber++;
        
        try {
          const eventData = this.parseLine(line, lineNumber, filePath);
          if (eventData) {
            eventBatch.push(eventData);
            processedLines++;
          }
        } catch (error) {
          errorLines++;
          await IngestionJob.addError(jobId, `Line ${lineNumber}: ${error.message}`);
          logger.warn(`Error parsing line ${lineNumber}:`, error.message);
        }

        // Process batch when it reaches the batch size
        if (eventBatch.length >= batchSize) {
          try {
            await HistoricalEvent.bulkCreate(eventBatch);
            eventBatch = [];
          } catch (error) {
            logger.error(`Error processing batch at line ${lineNumber}:`, error);
            errorLines += eventBatch.length;
            processedLines -= eventBatch.length;
            eventBatch = [];
          }
        }

        // Update progress every 100 lines
        if (lineNumber % 100 === 0) {
          await IngestionJob.updateProgress(jobId, {
            processed_lines: processedLines,
            error_lines: errorLines
          });
        }
      }

      // Process remaining events in the last batch
      if (eventBatch.length > 0) {
        try {
          await HistoricalEvent.bulkCreate(eventBatch);
        } catch (error) {
          logger.error('Error processing final batch:', error);
          errorLines += eventBatch.length;
          processedLines -= eventBatch.length;
        }
      }

      // Complete the job
      await IngestionJob.updateProgress(jobId, {
        processed_lines: processedLines,
        error_lines: errorLines,
        status: 'COMPLETED',
        end_time: new Date()
      });

      logger.info(`Job ${jobId} completed. Processed: ${processedLines}, Errors: ${errorLines}`);
    } catch (error) {
      logger.error(`Job ${jobId} failed:`, error);
      await IngestionJob.fail(jobId, `Processing failed: ${error.message}`);
    }
  }

  // Count total lines in file
  async countLines(filePath) {
    return new Promise((resolve, reject) => {
      let lineCount = 0;
      const fileStream = createReadStream(filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      rl.on('line', () => {
        lineCount++;
      });

      rl.on('close', () => {
        resolve(lineCount);
      });

      rl.on('error', (error) => {
        reject(error);
      });
    });
  }

  // Parse a single line from the file
  parseLine(line, lineNumber, filePath) {
    if (!line.trim()) {
      return null; // Skip empty lines
    }

    const parts = line.split('|');
    if (parts.length !== 6) {
      throw new Error(`Malformed entry: expected 6 fields, got ${parts.length}`);
    }

    const [eventId, eventName, startDate, endDate, parentId, description] = parts;

    // Validate event ID (should be UUID format)
    if (!this.isValidUUID(eventId.trim())) {
      throw new Error(`Invalid UUID format: '${eventId.trim()}'`);
    }

    // Validate dates
    const startDateObj = new Date(startDate.trim());
    const endDateObj = new Date(endDate.trim());

    if (isNaN(startDateObj.getTime())) {
      throw new Error(`Invalid start date format: '${startDate.trim()}'`);
    }

    if (isNaN(endDateObj.getTime())) {
      throw new Error(`Invalid end date format: '${endDate.trim()}'`);
    }

    if (startDateObj >= endDateObj) {
      throw new Error(`Start date must be before end date`);
    }

    // Handle parent ID
    let parentEventId = null;
    const parentIdTrimmed = parentId.trim();
    if (parentIdTrimmed && parentIdTrimmed.toUpperCase() !== 'NULL') {
      if (!this.isValidUUID(parentIdTrimmed)) {
        throw new Error(`Invalid parent UUID format: '${parentIdTrimmed}'`);
      }
      parentEventId = parentIdTrimmed;
    }

    return {
      event_id: eventId.trim(),
      event_name: eventName.trim(),
      description: description.trim() || null,
      start_date: startDateObj,
      end_date: endDateObj,
      parent_event_id: parentEventId,
      metadata: {
        source_file: filePath,
        line_number: lineNumber,
        parsing_flags: []
      }
    };
  }

  // Validate UUID format
  isValidUUID(str) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }

  // Get job status
  async getJobStatus(jobId) {
    try {
      const job = await IngestionJob.findById(jobId);
      if (!job) {
        throw new Error('Job not found');
      }

      const response = {
        jobId: job.job_id,
        status: job.status,
        processedLines: job.processed_lines,
        errorLines: job.error_lines,
        totalLines: job.total_lines,
        errors: job.errors || []
      };

      if (job.status === 'COMPLETED') {
        response.startTime = job.start_time;
        response.endTime = job.end_time;
      }

      return response;
    } catch (error) {
      logger.error('Error getting job status:', error);
      throw error;
    }
  }

  // Get all jobs
  async getAllJobs(filters = {}) {
    try {
      return await IngestionJob.getAll(filters);
    } catch (error) {
      logger.error('Error getting all jobs:', error);
      throw error;
    }
  }
}

module.exports = new FileIngestionService();
