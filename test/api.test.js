const request = require('supertest');
const app = require('../src/server');

describe('Chronologicon Engine API Tests', () => {
  describe('Health Check', () => {
    test('GET /health should return 200', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      expect(response.body.status).toBe('OK');
      expect(response.body.service).toBe('Chronologicon Engine');
    });
  });

  describe('Event Routes', () => {
    test('GET /api/events/search should return paginated results', async () => {
      const response = await request(app)
        .get('/api/events/search?page=1&limit=5')
        .expect(200);
      
      expect(response.body).toHaveProperty('events');
      expect(response.body).toHaveProperty('totalEvents');
      expect(response.body).toHaveProperty('page');
      expect(response.body).toHaveProperty('limit');
    });

    test('POST /api/events/ingest should validate file path', async () => {
      const response = await request(app)
        .post('/api/events/ingest')
        .send({ filePath: './sample_historical_data_from_csv.txt' })
        .expect(202);
      
      expect(response.body).toHaveProperty('jobId');
      expect(response.body.status).toBe('Ingestion initiated');
    });
  });

  describe('Insight Routes', () => {
    test('GET /api/insights/overlapping-events should return array', async () => {
      const response = await request(app)
        .get('/api/insights/overlapping-events')
        .expect(200);
      
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('GET /api/insights/temporal-gaps should validate date parameters', async () => {
      await request(app)
        .get('/api/insights/temporal-gaps')
        .expect(400); // Missing required parameters
    });

    test('GET /api/insights/event-influence should validate UUID parameters', async () => {
      await request(app)
        .get('/api/insights/event-influence?sourceEventId=invalid&targetEventId=invalid')
        .expect(400); // Invalid UUID format
    });
  });
});

describe('Data Validation', () => {
  test('Should reject invalid UUID formats', async () => {
    const response = await request(app)
      .get('/api/timeline/invalid-uuid')
      .expect(400);
    
    expect(response.body.error).toBe('Bad Request');
  });

  test('Should validate date ranges for temporal gaps', async () => {
    const response = await request(app)
      .get('/api/insights/temporal-gaps?startDate=2023-01-02T00:00:00Z&endDate=2023-01-01T00:00:00Z')
      .expect(400);
    
    expect(response.body.message).toContain('startDate must be before endDate');
  });
});
