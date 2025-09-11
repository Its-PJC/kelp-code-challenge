const { query, transaction } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');

class HistoricalEvent {
  constructor(data) {
    this.event_id = data.event_id || uuidv4();
    this.event_name = data.event_name;
    this.description = data.description || null;
    this.start_date = data.start_date;
    this.end_date = data.end_date;
    this.parent_event_id = data.parent_event_id || null;
    this.metadata = data.metadata || {};
  }

  // Create a new historical event
  static async create(eventData) {
    const event = new HistoricalEvent(eventData);
    
    const queryText = `
      INSERT INTO historical_events (event_id, event_name, description, start_date, end_date, parent_event_id, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    
    const values = [
      event.event_id,
      event.event_name,
      event.description,
      event.start_date,
      event.end_date,
      event.parent_event_id,
      JSON.stringify(event.metadata)
    ];

    try {
      const result = await query(queryText, values);
      return result.rows[0];
    } catch (error) {
      logger.error('Error creating historical event:', error);
      throw error;
    }
  }

  // Find event by ID
  static async findById(eventId) {
    const queryText = 'SELECT * FROM historical_events WHERE event_id = $1';
    
    try {
      const result = await query(queryText, [eventId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error finding event by ID:', error);
      throw error;
    }
  }

  // Get complete timeline hierarchy for a root event
  static async getTimeline(rootEventId) {
    const queryText = `
      WITH RECURSIVE event_hierarchy AS (
        -- Base case: start with the root event
        SELECT event_id, event_name, description, start_date, end_date, 
               duration_minutes, parent_event_id, metadata, 0 as level
        FROM historical_events
        WHERE event_id = $1
        
        UNION ALL
        
        -- Recursive case: get all children
        SELECT he.event_id, he.event_name, he.description, he.start_date, he.end_date,
               he.duration_minutes, he.parent_event_id, he.metadata, eh.level + 1
        FROM historical_events he
        INNER JOIN event_hierarchy eh ON he.parent_event_id = eh.event_id
      )
      SELECT * FROM event_hierarchy
      ORDER BY level, start_date
    `;

    try {
      const result = await query(queryText, [rootEventId]);
      return this.buildHierarchy(result.rows);
    } catch (error) {
      logger.error('Error getting timeline:', error);
      throw error;
    }
  }

  // Build hierarchical structure from flat array
  static buildHierarchy(events) {
    if (events.length === 0) return null;

    const eventMap = new Map();
    const rootEvent = events[0];

    // Create map of all events
    events.forEach(event => {
      eventMap.set(event.event_id, { ...event, children: [] });
    });

    // Build parent-child relationships
    events.forEach(event => {
      if (event.parent_event_id && eventMap.has(event.parent_event_id)) {
        const parent = eventMap.get(event.parent_event_id);
        const child = eventMap.get(event.event_id);
        parent.children.push(child);
      }
    });

    return eventMap.get(rootEvent.event_id);
  }

  // Search events with filters and pagination
  static async search(filters = {}) {
    let queryText = `
      SELECT event_id, event_name, description, start_date, end_date, 
             duration_minutes, parent_event_id, metadata
      FROM historical_events
      WHERE 1=1
    `;
    
    const values = [];
    let paramCount = 0;

    // Add filters
    if (filters.name) {
      paramCount++;
      queryText += ` AND LOWER(event_name) LIKE LOWER($${paramCount})`;
      values.push(`%${filters.name}%`);
    }

    if (filters.start_date_after) {
      paramCount++;
      queryText += ` AND start_date >= $${paramCount}`;
      values.push(filters.start_date_after);
    }

    if (filters.end_date_before) {
      paramCount++;
      queryText += ` AND end_date <= $${paramCount}`;
      values.push(filters.end_date_before);
    }

    // Add sorting
    const sortBy = filters.sortBy || 'start_date';
    const sortOrder = filters.sortOrder || 'asc';
    queryText += ` ORDER BY ${sortBy} ${sortOrder}`;

    // Add pagination
    const limit = parseInt(filters.limit) || 10;
    const page = parseInt(filters.page) || 1;
    const offset = (page - 1) * limit;

    paramCount++;
    queryText += ` LIMIT $${paramCount}`;
    values.push(limit);

    paramCount++;
    queryText += ` OFFSET $${paramCount}`;
    values.push(offset);

    try {
      const result = await query(queryText, values);
      
      // Get total count for pagination
      let countQuery = `
        SELECT COUNT(*) as total
        FROM historical_events
        WHERE 1=1
      `;
      
      const countValues = [];
      let countParamCount = 0;

      if (filters.name) {
        countParamCount++;
        countQuery += ` AND LOWER(event_name) LIKE LOWER($${countParamCount})`;
        countValues.push(`%${filters.name}%`);
      }

      if (filters.start_date_after) {
        countParamCount++;
        countQuery += ` AND start_date >= $${countParamCount}`;
        countValues.push(filters.start_date_after);
      }

      if (filters.end_date_before) {
        countParamCount++;
        countQuery += ` AND end_date <= $${countParamCount}`;
        countValues.push(filters.end_date_before);
      }

      const countResult = await query(countQuery, countValues);
      const totalEvents = parseInt(countResult.rows[0].total);

      return {
        events: result.rows,
        totalEvents,
        page,
        limit
      };
    } catch (error) {
      logger.error('Error searching events:', error);
      throw error;
    }
  }

  // Find overlapping events
  static async findOverlappingEvents() {
    const queryText = `
      SELECT 
        e1.event_id as event1_id,
        e1.event_name as event1_name,
        e1.start_date as event1_start,
        e1.end_date as event1_end,
        e2.event_id as event2_id,
        e2.event_name as event2_name,
        e2.start_date as event2_start,
        e2.end_date as event2_end,
        EXTRACT(EPOCH FROM (
          LEAST(e1.end_date, e2.end_date) - GREATEST(e1.start_date, e2.start_date)
        )) / 60 as overlap_duration_minutes
      FROM historical_events e1
      INNER JOIN historical_events e2 ON e1.event_id < e2.event_id
      WHERE e1.start_date < e2.end_date 
        AND e2.start_date < e1.end_date
        AND EXTRACT(EPOCH FROM (
          LEAST(e1.end_date, e2.end_date) - GREATEST(e1.start_date, e2.start_date)
        )) > 0
      ORDER BY overlap_duration_minutes DESC
    `;

    try {
      const result = await query(queryText);
      
      return result.rows.map(row => ({
        overlappingEventPairs: [
          {
            event_id: row.event1_id,
            event_name: row.event1_name,
            start_date: row.event1_start,
            end_date: row.event1_end
          },
          {
            event_id: row.event2_id,
            event_name: row.event2_name,
            start_date: row.event2_start,
            end_date: row.event2_end
          }
        ],
        overlap_duration_minutes: Math.round(row.overlap_duration_minutes)
      }));
    } catch (error) {
      logger.error('Error finding overlapping events:', error);
      throw error;
    }
  }

  // Find temporal gaps
  static async findTemporalGaps(startDate, endDate) {
    const queryText = `
      WITH ordered_events AS (
        SELECT event_id, event_name, start_date, end_date
        FROM historical_events
        WHERE start_date >= $1 AND end_date <= $2
        ORDER BY start_date
      ),
      gaps AS (
        SELECT 
          LAG(end_date) OVER (ORDER BY start_date) as gap_start,
          start_date as gap_end,
          LAG(event_id) OVER (ORDER BY start_date) as preceding_event_id,
          LAG(event_name) OVER (ORDER BY start_date) as preceding_event_name,
          LAG(end_date) OVER (ORDER BY start_date) as preceding_end_date,
          event_id as succeeding_event_id,
          event_name as succeeding_event_name,
          start_date as succeeding_start_date,
          EXTRACT(EPOCH FROM (
            start_date - LAG(end_date) OVER (ORDER BY start_date)
          )) / 60 as gap_duration_minutes
        FROM ordered_events
      )
      SELECT *
      FROM gaps
      WHERE gap_start IS NOT NULL 
        AND gap_duration_minutes > 0
      ORDER BY gap_duration_minutes DESC
      LIMIT 1
    `;

    try {
      const result = await query(queryText, [startDate, endDate]);
      
      if (result.rows.length === 0) {
        return {
          largestGap: null,
          message: "No significant temporal gaps found within the specified range, or too few events."
        };
      }

      const gap = result.rows[0];
      return {
        largestGap: {
          startOfGap: gap.gap_start,
          endOfGap: gap.gap_end,
          durationMinutes: Math.round(gap.gap_duration_minutes),
          precedingEvent: {
            event_id: gap.preceding_event_id,
            event_name: gap.preceding_event_name,
            end_date: gap.preceding_end_date
          },
          succeedingEvent: {
            event_id: gap.succeeding_event_id,
            event_name: gap.succeeding_event_name,
            start_date: gap.succeeding_start_date
          }
        },
        message: "Largest temporal gap identified."
      };
    } catch (error) {
      logger.error('Error finding temporal gaps:', error);
      throw error;
    }
  }

  // Find shortest path between events (Event Influence Spreader)
  static async findShortestPath(sourceEventId, targetEventId) {
    // First, build the graph of parent-child relationships
    const graphQuery = `
      SELECT event_id, event_name, duration_minutes, parent_event_id
      FROM historical_events
    `;

    try {
      const result = await query(graphQuery);
      const events = result.rows;
      
      // Build adjacency list (parent -> children)
      const graph = new Map();
      const eventDetails = new Map();
      
      events.forEach(event => {
        eventDetails.set(event.event_id, event);
        if (!graph.has(event.event_id)) {
          graph.set(event.event_id, []);
        }
        
        if (event.parent_event_id) {
          if (!graph.has(event.parent_event_id)) {
            graph.set(event.parent_event_id, []);
          }
          graph.get(event.parent_event_id).push(event.event_id);
        }
      });

      // Use Dijkstra's algorithm to find shortest path
      const distances = new Map();
      const previous = new Map();
      const visited = new Set();
      const queue = [];

      // Initialize distances
      events.forEach(event => {
        distances.set(event.event_id, Infinity);
      });
      distances.set(sourceEventId, 0);
      queue.push({ eventId: sourceEventId, distance: 0 });

      while (queue.length > 0) {
        // Sort queue by distance and get the closest unvisited node
        queue.sort((a, b) => a.distance - b.distance);
        const current = queue.shift();
        
        if (visited.has(current.eventId)) continue;
        visited.add(current.eventId);

        if (current.eventId === targetEventId) break;

        const neighbors = graph.get(current.eventId) || [];
        
        for (const neighborId of neighbors) {
          if (visited.has(neighborId)) continue;
          
          const neighborEvent = eventDetails.get(neighborId);
          const newDistance = distances.get(current.eventId) + neighborEvent.duration_minutes;
          
          if (newDistance < distances.get(neighborId)) {
            distances.set(neighborId, newDistance);
            previous.set(neighborId, current.eventId);
            queue.push({ eventId: neighborId, distance: newDistance });
          }
        }
      }

      // Reconstruct path
      if (!previous.has(targetEventId) && sourceEventId !== targetEventId) {
        return {
          sourceEventId,
          targetEventId,
          shortestPath: [],
          totalDurationMinutes: 0,
          message: "No temporal path found from source to target event."
        };
      }

      const path = [];
      let currentEventId = targetEventId;
      
      while (currentEventId !== undefined) {
        const event = eventDetails.get(currentEventId);
        path.unshift({
          event_id: event.event_id,
          event_name: event.event_name,
          duration_minutes: event.duration_minutes
        });
        currentEventId = previous.get(currentEventId);
      }

      const totalDuration = path.reduce((sum, event) => sum + event.duration_minutes, 0);

      return {
        sourceEventId,
        targetEventId,
        shortestPath: path,
        totalDurationMinutes: totalDuration,
        message: "Shortest temporal path found from source to target event."
      };
    } catch (error) {
      logger.error('Error finding shortest path:', error);
      throw error;
    }
  }

  // Bulk create events (for file ingestion)
  static async bulkCreate(events) {
    if (events.length === 0) return [];

    return await transaction(async (client) => {
      const results = [];
      
      for (const eventData of events) {
        const event = new HistoricalEvent(eventData);
        
        const queryText = `
          INSERT INTO historical_events (event_id, event_name, description, start_date, end_date, parent_event_id, metadata)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `;
        
        const values = [
          event.event_id,
          event.event_name,
          event.description,
          event.start_date,
          event.end_date,
          event.parent_event_id,
          JSON.stringify(event.metadata)
        ];

        try {
          const result = await client.query(queryText, values);
          results.push(result.rows[0]);
        } catch (error) {
          logger.error('Error in bulk create for event:', event.event_id, error);
          throw error;
        }
      }
      
      return results;
    });
  }
}

module.exports = HistoricalEvent;
