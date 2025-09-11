# Chronologicon Engine - ArchaeoData Inc.

A robust Node.js backend service for ingesting, managing, and querying historical event data to reconstruct complete timelines from fragmented archaeological records.

## Features

- **File Ingestion System**: Asynchronous processing of large text files with job tracking
- **Timeline Reconstruction**: Hierarchical event relationships with parent-child structures
- **Temporal Gap Finder**: Identifies largest continuous gaps in recorded events
- **Event Influence Spreader**: Finds shortest temporal paths between events using Dijkstra's algorithm
- **Advanced Search**: Full-text search with filtering, pagination, and sorting
- **Overlapping Events Detection**: Identifies events with overlapping timeframes
- **RESTful API**: Comprehensive API endpoints for all functionality

## Tech Stack

- **Runtime**: Node.js 16+
- **Framework**: Express.js
- **Database**: PostgreSQL with JSONB support
- **Validation**: Joi
- **Logging**: Winston
- **File Processing**: Multer, Readline
- **Security**: Helmet, CORS, Rate Limiting

## Quick Start

### Prerequisites

- Node.js 16 or higher
- PostgreSQL 12 or higher
- npm or yarn

### Installation

#### Option 1: Local Development Setup

1. **Clone and setup the project:**
   ```bash
   cd kelp-code-challenge
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

3. **Setup PostgreSQL database:**
   ```bash
   # Automated setup (recommended)
   npm run db:setup
   
   # OR manual setup
   createdb chronologicon_db
   psql -d chronologicon_db -f database_schema.sql
   ```

4. **Start the server:**
   ```bash
   # Development mode with auto-reload
   npm run dev
   
   # Production mode
   npm start
   ```

#### Option 2: Docker Deployment (Recommended)

1. **Start with Docker Compose:**
   ```bash
   docker-compose up -d
   ```
   
   This will automatically:
   - Start PostgreSQL with the schema pre-loaded
   - Build and start the Chronologicon Engine
   - Set up networking between services

2. **Verify deployment:**
   ```bash
   curl http://localhost:3000/health
   ```

The server will start on `http://localhost:3000`

## API Documentation

### Base URL
```
http://localhost:3000
```

### Core Endpoints

#### 1. File Ingestion

**POST /api/events/ingest**

Initiates asynchronous ingestion of historical event data.

**Request (JSON with server file path):**
```json
{
  "filePath": "/path/to/sample_historical_data_from_csv.txt"
}
```

**Request (File upload):**
```bash
curl -X POST http://localhost:3000/api/events/ingest \
  -F "file=@sample_historical_data_from_csv.txt"
```

**Response (202 Accepted):**
```json
{
  "status": "Ingestion initiated",
  "jobId": "ingest-job-12345-abcde",
  "message": "Check /api/events/ingestion-status/ingest-job-12345-abcde for updates."
}
```

#### 2. Ingestion Status

**GET /api/events/ingestion-status/:jobId**

Retrieves the current status and progress of an ingestion job.

**Example:**
```bash
curl http://localhost:3000/api/events/ingestion-status/ingest-job-12345-abcde
```

**Response (Processing):**
```json
{
  "jobId": "ingest-job-12345-abcde",
  "status": "PROCESSING",
  "processedLines": 10,
  "errorLines": 2,
  "totalLines": 15,
  "errors": [
    "Line 11: Malformed entry: missing field",
    "Line 12: Invalid date format"
  ]
}
```

#### 3. Timeline Reconstruction

**GET /api/timeline/:rootEventId**

Returns the complete hierarchical timeline for a root event.

**Example:**
```bash
curl http://localhost:3000/api/timeline/a1b2c3d4-e5f6-7890-1234-567890abcdef
```

**Response:**
```json
{
  "event_id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
  "event_name": "Founding of ArchaeoData",
  "description": "Initial establishment of the company",
  "start_date": "2023-01-01T10:00:00.000Z",
  "end_date": "2023-01-01T11:30:00.000Z",
  "duration_minutes": 90,
  "parent_event_id": null,
  "children": [
    {
      "event_id": "f7e6d5c4-b3a2-1098-7654-3210fedcba98",
      "event_name": "Phase 1 Research",
      "children": []
    }
  ]
}
```

#### 4. Event Search

**GET /api/events/search**

Search events with filtering, pagination, and sorting.

**Query Parameters:**
- `name`: Partial match for event name (case-insensitive)
- `start_date_after`: Events starting after this ISO 8601 date
- `end_date_before`: Events ending before this ISO 8601 date
- `sortBy`: Field to sort by (`start_date`, `event_name`, `duration_minutes`)
- `sortOrder`: `asc` or `desc`
- `page`: Page number (default: 1)
- `limit`: Results per page (default: 10, max: 100)

**Example:**
```bash
curl "http://localhost:3000/api/events/search?name=phase&sortBy=start_date&page=1&limit=5"
```

#### 5. Overlapping Events

**GET /api/insights/overlapping-events**

Returns all event pairs with overlapping timeframes.

**Example:**
```bash
curl http://localhost:3000/api/insights/overlapping-events
```

#### 6. Temporal Gap Finder

**GET /api/insights/temporal-gaps**

Identifies the largest continuous gap in recorded events.

**Query Parameters:**
- `startDate`: Start of analysis period (ISO 8601)
- `endDate`: End of analysis period (ISO 8601)

**Example:**
```bash
curl "http://localhost:3000/api/insights/temporal-gaps?startDate=2023-01-01T00:00:00Z&endDate=2023-01-31T23:59:59Z"
```

#### 7. Event Influence Spreader

**GET /api/insights/event-influence**

Finds the shortest temporal path between two events.

**Query Parameters:**
- `sourceEventId`: UUID of the starting event
- `targetEventId`: UUID of the destination event

**Example:**
```bash
curl "http://localhost:3000/api/insights/event-influence?sourceEventId=d1e2f3a4-b5c6-7d8e-9f0a-1b2c3d4e5f6a&targetEventId=c6d7e8f9-a0b1-c2d3-e4f5-a6b7c8d9e0f1"
```

## File Format

Input files should follow this format (pipe-delimited):
```
EVENT_ID|EVENT_NAME|START_DATE_ISO|END_DATE_ISO|PARENT_ID_OR_NULL|DESCRIPTION
```

**Example:**
```
a1b2c3d4-e5f6-7890-1234-567890abcdef|Founding of ArchaeoData|2023-01-01T10:00:00Z|2023-01-01T11:30:00Z|NULL|Initial establishment of the company.
```

## Database Schema

The system uses PostgreSQL with the following main tables:

### historical_events
- `event_id` (UUID, Primary Key)
- `event_name` (VARCHAR)
- `description` (TEXT)
- `start_date` (TIMESTAMPTZ, Indexed)
- `end_date` (TIMESTAMPTZ, Indexed)
- `duration_minutes` (INTEGER, Generated)
- `parent_event_id` (UUID, Foreign Key)
- `metadata` (JSONB)

### ingestion_jobs
- `job_id` (VARCHAR, Primary Key)
- `status` (VARCHAR: PROCESSING, COMPLETED, FAILED)
- `file_path` (TEXT)
- `total_lines`, `processed_lines`, `error_lines` (INTEGER)
- `errors` (JSONB)
- `start_time`, `end_time` (TIMESTAMPTZ)

## Architecture & Design Decisions

### 1. Asynchronous File Processing
- Large files are processed line-by-line using Node.js streams
- Job tracking system provides real-time progress updates
- Batch processing (100 events per batch) for optimal database performance
- Robust error handling with detailed error reporting

### 2. Hierarchical Data Structure
- Self-referencing foreign key (`parent_event_id`) for tree structures
- Recursive CTEs for efficient timeline reconstruction
- Optimized indexes for parent-child relationship queries

### 3. Temporal Analysis Algorithms
- **Gap Finding**: SQL window functions to identify temporal gaps
- **Shortest Path**: Dijkstra's algorithm implementation for event influence
- **Overlap Detection**: Interval overlap queries with duration calculations

### 4. Performance Optimizations
- Database indexes on frequently queried columns
- Connection pooling for database connections
- Pagination for large result sets
- Generated columns for calculated fields (duration_minutes)

### 5. Error Handling & Validation
- Joi schema validation for all API inputs
- UUID format validation
- Date range validation
- Comprehensive error logging with Winston

### 6. Security & Best Practices
- Helmet.js for security headers
- CORS configuration
- Rate limiting (100 requests per 15 minutes)
- Input sanitization and validation
- Environment-based configuration

## Testing

### Sample Data
Use the provided `sample_historical_data_from_csv.txt` file for testing:

```bash
# Test file ingestion
curl -X POST http://localhost:3000/api/events/ingest \
  -H "Content-Type: application/json" \
  -d '{"filePath": "./sample_historical_data_from_csv.txt"}'
```

### Health Check
```bash
curl http://localhost:3000/health
```

## Development

### Project Structure
```
src/
├── config/
│   ├── database.js      # Database connection and helpers
│   └── logger.js        # Winston logging configuration
├── models/
│   ├── HistoricalEvent.js  # Event model with business logic
│   └── IngestionJob.js     # Job tracking model
├── routes/
│   ├── eventRoutes.js      # Event-related endpoints
│   └── insightRoutes.js    # Analytics endpoints
├── services/
│   └── FileIngestionService.js  # File processing service
└── server.js            # Main application entry point
```

### Available Scripts
- `npm start`: Start production server
- `npm run dev`: Start development server with nodemon
- `npm test`: Run all tests (Jest)
- `npm run test:api`: Run API tests specifically
- `npm run db:setup`: Automated database setup
- `npm run test:ingestion`: Run complete ingestion workflow test

### Environment Variables
```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=chronologicon_db
DB_USER=postgres
DB_PASSWORD=your_password

# Server
PORT=3000
NODE_ENV=development

# Logging
LOG_LEVEL=info
```

## Troubleshooting

### Common Issues

1. **Database Connection Failed**
   - Verify PostgreSQL is running
   - Check database credentials in `.env`
   - Ensure database exists and schema is applied

2. **File Ingestion Errors**
   - Check file format matches specification
   - Verify file permissions and path
   - Review error logs in `logs/error.log`

3. **Memory Issues with Large Files**
   - File processing uses streams for memory efficiency
   - Adjust batch size in `FileIngestionService.js` if needed

### Logs
- Application logs: `logs/combined.log`
- Error logs: `logs/error.log`
- Console output with timestamps and colors

## Performance Considerations

- **Database Indexes**: Optimized for common query patterns
- **Connection Pooling**: Maximum 20 concurrent connections
- **Batch Processing**: 100 events per database transaction
- **Memory Management**: Stream-based file processing
- **Rate Limiting**: Prevents API abuse

## Future Enhancements

- Real-time WebSocket updates for ingestion progress
- Advanced caching with Redis
- Horizontal scaling with database sharding
- Machine learning for automatic event classification
- GraphQL API for flexible queries
- Docker containerization

## License

MIT License - ArchaeoData Inc.

## Support

For technical support or questions about the Chronologicon Engine, please refer to the API documentation above or check the application logs for detailed error information.
