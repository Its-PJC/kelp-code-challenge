const express = require('express');
const Joi = require('joi');
const HistoricalEvent = require('../models/HistoricalEvent');
const logger = require('../config/logger');

const router = express.Router();

// Validation schemas
const temporalGapsSchema = Joi.object({
  startDate: Joi.string().isoDate().required(),
  endDate: Joi.string().isoDate().required()
});

const eventInfluenceSchema = Joi.object({
  sourceEventId: Joi.string().uuid().required(),
  targetEventId: Joi.string().uuid().required()
});

// GET /api/insights/overlapping-events
router.get('/overlapping-events', async (req, res) => {
  try {
    const overlappingEvents = await HistoricalEvent.findOverlappingEvents();
    res.json(overlappingEvents);
  } catch (error) {
    logger.error('Overlapping events error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

// GET /api/insights/temporal-gaps
router.get('/temporal-gaps', async (req, res) => {
  try {
    const { error, value } = temporalGapsSchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    const { startDate, endDate } = value;
    
    // Validate that startDate is before endDate
    if (new Date(startDate) >= new Date(endDate)) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'startDate must be before endDate'
      });
    }

    const gaps = await HistoricalEvent.findTemporalGaps(startDate, endDate);
    res.json(gaps);
  } catch (error) {
    logger.error('Temporal gaps error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

// GET /api/insights/event-influence
router.get('/event-influence', async (req, res) => {
  try {
    const { error, value } = eventInfluenceSchema.validate(req.query);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    const { sourceEventId, targetEventId } = value;
    
    // Check if source and target are the same
    if (sourceEventId === targetEventId) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Source and target event IDs cannot be the same'
      });
    }

    const influence = await HistoricalEvent.findShortestPath(sourceEventId, targetEventId);
    res.json(influence);
  } catch (error) {
    logger.error('Event influence error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

// GET /api/insights/statistics (bonus endpoint for additional insights)
router.get('/statistics', async (req, res) => {
  try {
    const { query } = require('../config/database');
    
    const statsQuery = `
      SELECT 
        COUNT(*) as total_events,
        COUNT(CASE WHEN parent_event_id IS NULL THEN 1 END) as root_events,
        COUNT(CASE WHEN parent_event_id IS NOT NULL THEN 1 END) as child_events,
        AVG(duration_minutes) as avg_duration_minutes,
        MIN(start_date) as earliest_event,
        MAX(end_date) as latest_event,
        MAX(duration_minutes) as longest_event_duration,
        MIN(duration_minutes) as shortest_event_duration
      FROM historical_events
    `;
    
    const result = await query(statsQuery);
    const stats = result.rows[0];
    
    // Convert numeric strings to numbers
    stats.total_events = parseInt(stats.total_events);
    stats.root_events = parseInt(stats.root_events);
    stats.child_events = parseInt(stats.child_events);
    stats.avg_duration_minutes = Math.round(parseFloat(stats.avg_duration_minutes) || 0);
    stats.longest_event_duration = parseInt(stats.longest_event_duration) || 0;
    stats.shortest_event_duration = parseInt(stats.shortest_event_duration) || 0;
    
    res.json({
      statistics: stats,
      message: "Database statistics retrieved successfully"
    });
  } catch (error) {
    logger.error('Statistics error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

module.exports = router;
