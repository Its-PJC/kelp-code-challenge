const express = require('express');
const multer = require('multer');
const path = require('path');
const Joi = require('joi');
const HistoricalEvent = require('../models/HistoricalEvent');
const FileIngestionService = require('../services/FileIngestionService');
const logger = require('../config/logger');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/plain' || path.extname(file.originalname) === '.txt') {
      cb(null, true);
    } else {
      cb(new Error('Only .txt files are allowed'));
    }
  }
});

// Validation schemas
const ingestionSchema = Joi.object({
  filePath: Joi.string().required()
});

const searchSchema = Joi.object({
  name: Joi.string().optional(),
  start_date_after: Joi.string().isoDate().optional(),
  end_date_before: Joi.string().isoDate().optional(),
  sortBy: Joi.string().valid('start_date', 'end_date', 'event_name', 'duration_minutes').default('start_date'),
  sortOrder: Joi.string().valid('asc', 'desc').default('asc'),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10)
});

// POST /api/events/ingest
router.post('/ingest', async (req, res) => {
  try {
    let filePath;

    // Handle both file upload and server file path
    if (req.body.filePath) {
      // Server file path provided
      const { error, value } = ingestionSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation Error',
          message: error.details[0].message
        });
      }
      filePath = value.filePath;
    } else {
      // Handle file upload
      upload.single('file')(req, res, async (err) => {
        if (err) {
          logger.error('File upload error:', err);
          return res.status(400).json({
            error: 'File Upload Error',
            message: err.message
          });
        }

        if (!req.file) {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'No file provided. Either upload a file or provide filePath in JSON body.'
          });
        }

        filePath = req.file.path;
        
        try {
          const result = await FileIngestionService.startIngestion(filePath);
          res.status(202).json(result);
        } catch (error) {
          logger.error('Ingestion start error:', error);
          res.status(500).json({
            error: 'Ingestion Error',
            message: error.message
          });
        }
      });
      return;
    }

    // Process server file path
    const result = await FileIngestionService.startIngestion(filePath);
    res.status(202).json(result);
  } catch (error) {
    logger.error('Ingestion error:', error);
    res.status(500).json({
      error: 'Ingestion Error',
      message: error.message
    });
  }
});

// GET /api/events/ingestion-status/:jobId
router.get('/ingestion-status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    if (!jobId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Job ID is required'
      });
    }

    const status = await FileIngestionService.getJobStatus(jobId);
    res.json(status);
  } catch (error) {
    if (error.message === 'Job not found') {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Job not found'
      });
    }
    
    logger.error('Job status error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

// GET /api/timeline/:rootEventId
router.get('/timeline/:rootEventId', async (req, res) => {
  try {
    const { rootEventId } = req.params;
    
    if (!rootEventId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Root event ID is required'
      });
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(rootEventId)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid UUID format for root event ID'
      });
    }

    const timeline = await HistoricalEvent.getTimeline(rootEventId);
    
    if (!timeline) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Event not found'
      });
    }

    res.json(timeline);
  } catch (error) {
    logger.error('Timeline error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

// GET /api/events/search
router.get('/search', async (req, res) => {
  try {
    const { error, value } = searchSchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    const result = await HistoricalEvent.search(value);
    res.json(result);
  } catch (error) {
    logger.error('Search error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

// GET /api/events (get all events - for debugging/admin)
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const result = await HistoricalEvent.search({
      page: parseInt(page),
      limit: parseInt(limit)
    });
    res.json(result);
  } catch (error) {
    logger.error('Get all events error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

// POST /api/events (create single event - for testing)
router.post('/', async (req, res) => {
  try {
    const eventSchema = Joi.object({
      event_id: Joi.string().uuid().optional(),
      event_name: Joi.string().required(),
      description: Joi.string().optional(),
      start_date: Joi.string().isoDate().required(),
      end_date: Joi.string().isoDate().required(),
      parent_event_id: Joi.string().uuid().optional(),
      metadata: Joi.object().optional()
    });

    const { error, value } = eventSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    const event = await HistoricalEvent.create(value);
    res.status(201).json(event);
  } catch (error) {
    logger.error('Create event error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

module.exports = router;
