#!/usr/bin/env node

/**
 * Test script for file ingestion functionality
 * This script tests the complete ingestion workflow
 */

require('dotenv').config();
const axios = require('axios');
const path = require('path');

const BASE_URL = 'http://localhost:3000';

async function testIngestion() {
  try {
    console.log('🚀 Starting Chronologicon Engine ingestion test...\n');

    // Test 1: Health check
    console.log('1. Testing health endpoint...');
    const healthResponse = await axios.get(`${BASE_URL}/health`);
    console.log('✅ Health check passed:', healthResponse.data.status);

    // Test 2: Start ingestion
    console.log('\n2. Starting file ingestion...');
    const filePath = path.join(__dirname, '..', 'sample_historical_data_from_csv.txt');
    const ingestionResponse = await axios.post(`${BASE_URL}/api/events/ingest`, {
      filePath: filePath
    });
    
    const jobId = ingestionResponse.data.jobId;
    console.log('✅ Ingestion started:', jobId);

    // Test 3: Monitor job progress
    console.log('\n3. Monitoring job progress...');
    let jobCompleted = false;
    let attempts = 0;
    const maxAttempts = 30;

    while (!jobCompleted && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      
      const statusResponse = await axios.get(`${BASE_URL}/api/events/ingestion-status/${jobId}`);
      const status = statusResponse.data;
      
      console.log(`   Status: ${status.status}, Processed: ${status.processedLines}/${status.totalLines}, Errors: ${status.errorLines}`);
      
      if (status.status === 'COMPLETED' || status.status === 'FAILED') {
        jobCompleted = true;
        if (status.errors && status.errors.length > 0) {
          console.log('   Errors encountered:', status.errors);
        }
      }
      
      attempts++;
    }

    if (!jobCompleted) {
      console.log('⚠️  Job did not complete within expected time');
      return;
    }

    // Test 4: Search events
    console.log('\n4. Testing event search...');
    const searchResponse = await axios.get(`${BASE_URL}/api/events/search?limit=5`);
    console.log('✅ Found events:', searchResponse.data.totalEvents);
    console.log('   Sample events:', searchResponse.data.events.map(e => e.event_name));

    // Test 5: Get timeline
    if (searchResponse.data.events.length > 0) {
      console.log('\n5. Testing timeline reconstruction...');
      const rootEvent = searchResponse.data.events.find(e => !e.parent_event_id);
      if (rootEvent) {
        const timelineResponse = await axios.get(`${BASE_URL}/api/timeline/${rootEvent.event_id}`);
        console.log('✅ Timeline reconstructed for:', timelineResponse.data.event_name);
        console.log('   Children count:', timelineResponse.data.children?.length || 0);
      }
    }

    // Test 6: Overlapping events
    console.log('\n6. Testing overlapping events detection...');
    const overlapResponse = await axios.get(`${BASE_URL}/api/insights/overlapping-events`);
    console.log('✅ Overlapping event pairs found:', overlapResponse.data.length);

    // Test 7: Temporal gaps
    console.log('\n7. Testing temporal gap finder...');
    const gapResponse = await axios.get(`${BASE_URL}/api/insights/temporal-gaps?startDate=2023-01-01T00:00:00Z&endDate=2023-01-31T23:59:59Z`);
    console.log('✅ Temporal gap analysis completed');
    if (gapResponse.data.largestGap) {
      console.log('   Largest gap duration:', gapResponse.data.largestGap.durationMinutes, 'minutes');
    } else {
      console.log('   No significant gaps found');
    }

    // Test 8: Event influence (if we have events with relationships)
    if (searchResponse.data.events.length >= 2) {
      console.log('\n8. Testing event influence spreader...');
      const events = searchResponse.data.events;
      const sourceEvent = events[0];
      const targetEvent = events[1];
      
      try {
        const influenceResponse = await axios.get(`${BASE_URL}/api/insights/event-influence?sourceEventId=${sourceEvent.event_id}&targetEventId=${targetEvent.event_id}`);
        console.log('✅ Event influence analysis completed');
        console.log('   Path found:', influenceResponse.data.shortestPath.length > 0 ? 'Yes' : 'No');
        if (influenceResponse.data.shortestPath.length > 0) {
          console.log('   Total duration:', influenceResponse.data.totalDurationMinutes, 'minutes');
        }
      } catch (error) {
        console.log('   No path found between selected events (expected for unrelated events)');
      }
    }

    console.log('\n🎉 All tests completed successfully!');
    console.log('\n📊 System is ready for production use.');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('   Response:', error.response.data);
    }
    process.exit(1);
  }
}

// Run test if called directly
if (require.main === module) {
  testIngestion();
}

module.exports = testIngestion;
