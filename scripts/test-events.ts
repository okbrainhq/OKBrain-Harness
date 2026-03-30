/**
 * Manual test script for event management system
 * Run with: npx tsx scripts/test-events.ts
 */

import {
  createEvent,
  getEvent,
  getAllEvents,
  updateEvent,
  deleteEvent,
  searchEvents,
  getEventsByDateRange,
  getUpcomingEvents,
  getPastEvents,
  ensureInitialized,
} from '../src/lib/db';

import { getUpcomingEventsContext } from '../src/lib/ai/tools/events';

// Test user ID
const TEST_USER_ID = 'test_user_events_123';

async function testEventManagement() {
  console.log('🧪 Starting Event Management System Tests\n');

  try {
    // Initialize database
    await ensureInitialized();
    console.log('✅ Database initialized\n');

    // Test 1: Create events
    console.log('📝 Test 1: Creating events...');
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const event1 = await createEvent(
      TEST_USER_ID,
      'evt_test_1',
      'Team Meeting',
      'Weekly team sync meeting',
      'Conference Room A',
      tomorrow.toISOString(),
      null
    );
    console.log(`✅ Created event: ${event1.title} (ID: ${event1.id})`);

    const event2 = await createEvent(
      TEST_USER_ID,
      'evt_test_2',
      'Doctor Appointment',
      'Annual checkup at the clinic',
      'City Medical Center',
      nextWeek.toISOString(),
      null
    );
    console.log(`✅ Created event: ${event2.title} (ID: ${event2.id})`);

    const event3 = await createEvent(
      TEST_USER_ID,
      'evt_test_3',
      'Lunch with Sarah',
      'Catch up over lunch at favorite restaurant',
      'The Italian Place',
      yesterday.toISOString(),
      null
    );
    console.log(`✅ Created event: ${event3.title} (ID: ${event3.id})\n`);

    // Test 2: Get a specific event
    console.log('🔍 Test 2: Getting specific event...');
    const retrievedEvent = await getEvent(TEST_USER_ID, 'evt_test_1');
    if (retrievedEvent && retrievedEvent.title === 'Team Meeting') {
      console.log(`✅ Retrieved event: ${retrievedEvent.title}\n`);
    } else {
      throw new Error('Failed to retrieve event');
    }

    // Test 3: Get all events
    console.log('📋 Test 3: Getting all events...');
    const allEvents = await getAllEvents(TEST_USER_ID);
    console.log(`✅ Retrieved ${allEvents.length} events:`);
    allEvents.forEach(e => {
      console.log(`   - ${e.title} at ${new Date(e.start_datetime).toLocaleString()}`);
    });
    console.log();

    // Test 4: Update an event
    console.log('✏️  Test 4: Updating event...');
    await updateEvent(
      TEST_USER_ID,
      'evt_test_1',
      'Team Meeting (Updated)',
      'Weekly team sync meeting - Remote',
      'Zoom',
      tomorrow.toISOString(),
      null
    );
    const updatedEvent = await getEvent(TEST_USER_ID, 'evt_test_1');
    if (updatedEvent && updatedEvent.title === 'Team Meeting (Updated)' && updatedEvent.location === 'Zoom') {
      console.log(`✅ Updated event: ${updatedEvent.title} at ${updatedEvent.location}\n`);
    } else {
      throw new Error('Failed to update event');
    }

    // Test 5: Search events (full-text search)
    console.log('🔎 Test 5: Searching events...');
    const searchResults = await searchEvents(TEST_USER_ID, 'meeting');
    console.log(`✅ Found ${searchResults.length} event(s) matching "meeting":`);
    searchResults.forEach(e => {
      console.log(`   - ${e.title}`);
    });
    console.log();

    // Test 6: Get upcoming events
    console.log('⏰ Test 6: Getting upcoming events...');
    const upcomingEvents = await getUpcomingEvents(TEST_USER_ID, 10);
    console.log(`✅ Found ${upcomingEvents.length} upcoming event(s):`);
    upcomingEvents.forEach(e => {
      console.log(`   - ${e.title} at ${new Date(e.start_datetime).toLocaleString()}`);
    });
    console.log();

    // Test 7: Get past events
    console.log('📅 Test 7: Getting past events...');
    const pastEvents = await getPastEvents(TEST_USER_ID, 10);
    console.log(`✅ Found ${pastEvents.length} past event(s):`);
    pastEvents.forEach(e => {
      console.log(`   - ${e.title} at ${new Date(e.start_datetime).toLocaleString()}`);
    });
    console.log();

    // Test 8: Get events by date range
    console.log('📆 Test 8: Getting events by date range...');
    const rangeStart = new Date(now);
    rangeStart.setDate(rangeStart.getDate() - 2);
    const rangeEnd = new Date(now);
    rangeEnd.setDate(rangeEnd.getDate() + 10);
    const rangeEvents = await getEventsByDateRange(
      TEST_USER_ID,
      rangeStart.toISOString(),
      rangeEnd.toISOString()
    );
    console.log(`✅ Found ${rangeEvents.length} event(s) in date range:`);
    rangeEvents.forEach(e => {
      console.log(`   - ${e.title} at ${new Date(e.start_datetime).toLocaleString()}`);
    });
    console.log();

    // Test 9: Get upcoming events context (for system prompt injection)
    console.log('💬 Test 9: Getting upcoming events context for system prompt...');
    const context = await getUpcomingEventsContext(TEST_USER_ID, 5);
    console.log('✅ Generated context:');
    console.log(context);
    console.log();

    // Test 10: Delete an event
    console.log('🗑️  Test 10: Deleting event...');
    await deleteEvent(TEST_USER_ID, 'evt_test_3');
    const deletedEvent = await getEvent(TEST_USER_ID, 'evt_test_3');
    if (!deletedEvent) {
      console.log('✅ Event deleted successfully\n');
    } else {
      throw new Error('Failed to delete event');
    }

    // Cleanup: Delete remaining test events
    console.log('🧹 Cleaning up test events...');
    await deleteEvent(TEST_USER_ID, 'evt_test_1');
    await deleteEvent(TEST_USER_ID, 'evt_test_2');
    console.log('✅ Cleanup complete\n');

    console.log('✨ All tests passed! Event management system is working correctly.\n');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
testEventManagement();
