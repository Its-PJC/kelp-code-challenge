-- ArchaeoData Inc. - Chronologicon Engine Database Schema
-- PostgreSQL DDL Script

-- Create database (run this separately if needed)
-- CREATE DATABASE chronologicon_db;

-- Connect to the database
-- \c chronologicon_db;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create the historical_events table
CREATE TABLE historical_events (
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_name VARCHAR(255) NOT NULL,
    description TEXT,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    duration_minutes INTEGER GENERATED ALWAYS AS (
        EXTRACT(EPOCH FROM (end_date - start_date)) / 60
    ) STORED,
    parent_event_id UUID REFERENCES historical_events(event_id) ON DELETE CASCADE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance optimization
CREATE INDEX idx_historical_events_start_date ON historical_events(start_date);
CREATE INDEX idx_historical_events_end_date ON historical_events(end_date);
CREATE INDEX idx_historical_events_parent_id ON historical_events(parent_event_id);
CREATE INDEX idx_historical_events_name ON historical_events(event_name);
CREATE INDEX idx_historical_events_duration ON historical_events(duration_minutes);
CREATE INDEX idx_historical_events_metadata ON historical_events USING GIN(metadata);

-- Create composite index for date range queries
CREATE INDEX idx_historical_events_date_range ON historical_events(start_date, end_date);

-- Create the ingestion_jobs table for tracking file processing
CREATE TABLE ingestion_jobs (
    job_id VARCHAR(50) PRIMARY KEY,
    status VARCHAR(20) NOT NULL DEFAULT 'PROCESSING',
    file_path TEXT,
    total_lines INTEGER DEFAULT 0,
    processed_lines INTEGER DEFAULT 0,
    error_lines INTEGER DEFAULT 0,
    errors JSONB DEFAULT '[]',
    start_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Create index for job status queries
CREATE INDEX idx_ingestion_jobs_status ON ingestion_jobs(status);
CREATE INDEX idx_ingestion_jobs_created_at ON ingestion_jobs(created_at);

-- Add constraint to ensure end_date is after start_date
ALTER TABLE historical_events 
ADD CONSTRAINT chk_date_order 
CHECK (end_date > start_date);

-- Add constraint to ensure valid status values for ingestion jobs
ALTER TABLE ingestion_jobs 
ADD CONSTRAINT chk_job_status 
CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED'));

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers to automatically update updated_at
CREATE TRIGGER update_historical_events_updated_at 
    BEFORE UPDATE ON historical_events 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ingestion_jobs_updated_at 
    BEFORE UPDATE ON ingestion_jobs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create view for events with their children count (useful for queries)
CREATE VIEW events_with_children_count AS
SELECT 
    he.*,
    COALESCE(child_count.count, 0) as children_count
FROM historical_events he
LEFT JOIN (
    SELECT parent_event_id, COUNT(*) as count
    FROM historical_events
    WHERE parent_event_id IS NOT NULL
    GROUP BY parent_event_id
) child_count ON he.event_id = child_count.parent_event_id;

-- Insert some sample data for testing
INSERT INTO historical_events (event_id, event_name, description, start_date, end_date, parent_event_id, metadata) VALUES
('a1b2c3d4-e5f6-7890-1234-567890abcdef', 'Founding of ArchaeoData', 'Initial establishment of the company, focusing on data salvage.', '2023-01-01T10:00:00Z', '2023-01-01T11:30:00Z', NULL, '{"source_file": "sample_data.txt", "line_number": 1}'),
('f7e6d5c4-b3a2-1098-7654-3210fedcba98', 'Phase 1 Research', 'Early research on data fragmentation techniques.', '2023-01-01T10:30:00Z', '2023-01-01T11:00:00Z', 'a1b2c3d4-e5f6-7890-1234-567890abcdef', '{"source_file": "sample_data.txt", "line_number": 2}'),
('11223344-5566-7788-9900-aabbccddeeff', 'Internal Review Meeting', 'Reviewing initial research findings.', '2023-01-01T10:45:00Z', '2023-01-01T11:15:00Z', 'f7e6d5c4-b3a2-1098-7654-3210fedcba98', '{"source_file": "sample_data.txt", "line_number": 3}');

-- Create indexes for better performance on complex queries
CREATE INDEX idx_events_overlapping ON historical_events(start_date, end_date) 
WHERE start_date IS NOT NULL AND end_date IS NOT NULL;

-- Comments for documentation
COMMENT ON TABLE historical_events IS 'Stores historical event data with hierarchical relationships';
COMMENT ON COLUMN historical_events.event_id IS 'Unique identifier for each historical event';
COMMENT ON COLUMN historical_events.duration_minutes IS 'Calculated field storing event duration in minutes';
COMMENT ON COLUMN historical_events.parent_event_id IS 'References parent event for hierarchical relationships';
COMMENT ON COLUMN historical_events.metadata IS 'Additional unstructured data about the event';

COMMENT ON TABLE ingestion_jobs IS 'Tracks the status and progress of file ingestion operations';
COMMENT ON COLUMN ingestion_jobs.job_id IS 'Unique identifier for ingestion job';
COMMENT ON COLUMN ingestion_jobs.errors IS 'JSON array of error messages encountered during processing';
