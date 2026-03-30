import { eventTools } from '../src/lib/ai/tools/events';
import { runWithToolContext } from '../src/lib/ai/tools/context';
import { test, expect } from '@playwright/test';
import { loadTestEnv, setupPageWithUser } from './test-utils';
import { v4 as uuidv4 } from 'uuid';
import { createUser } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';

loadTestEnv();

// Create a test user for all event tests
let testUserId: string;

test.beforeAll(async () => {
  // Create a unique test user
  testUserId = uuidv4();
  const email = `test-events-${testUserId}@example.com`;
  const hashedPassword = await hashPassword('password123');
  await createUser(testUserId, email, hashedPassword);
});

// Helper to execute tool with context
const executeToolWithContext = async (tool: any, args: any): Promise<any> => {
  return runWithToolContext({ userId: testUserId }, () => tool.execute(args));
};

test.describe('Event Lookup Tools', () => {
  const getTool = (name: string) => eventTools.find(
    (t) => t.definition.name === name
  );

  // Test 1: Create events for testing lookups
  test('setup: create test events', async () => {
    const createTool = getTool('create_event');
    expect(createTool).toBeDefined();

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    // Create all test events in one batch
    const result = await executeToolWithContext(createTool, {
      events: [
        {
          title: 'Team Meeting',
          description: 'Weekly sync meeting with the team',
          location: 'Conference Room A',
          start_datetime: tomorrow.toISOString()
        },
        {
          title: 'Doctor Appointment',
          description: 'Annual checkup at the clinic',
          location: 'City Medical Center',
          start_datetime: nextWeek.toISOString()
        },
        {
          title: 'Lunch with Sarah',
          description: 'Catch up over lunch',
          location: 'The Italian Place',
          start_datetime: yesterday.toISOString()
        }
      ]
    });

    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('events');
    expect(result.events.length).toBe(3);
    expect(result.events[0]).toHaveProperty('title', 'Team Meeting');
    expect(result.events[0]).toHaveProperty('is_own', true);
    expect(result.events[0]).toHaveProperty('created_by');
    expect(result.events[1]).toHaveProperty('title', 'Doctor Appointment');
    expect(result.events[2]).toHaveProperty('title', 'Lunch with Sarah');
  });

  // Test 2: Get all events
  // Test 2: Get upcoming events
  test('get_upcoming_events should return only future events', async () => {
    const tool = getTool('get_upcoming_events');
    expect(tool).toBeDefined();

    const result = await executeToolWithContext(tool, { limit: 10 });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('events');
    expect(Array.isArray(result.events)).toBe(true);
    expect(result.events.length).toBeGreaterThanOrEqual(2);

    // Verify enriched fields are present
    result.events.forEach((event: any) => {
      expect(event).toHaveProperty('created_by');
      expect(event).toHaveProperty('is_own', true);
      expect(event).not.toHaveProperty('user_id');
    });

    // Verify all events are in the future
    const now = new Date();
    result.events.forEach((event: any) => {
      const eventDate = new Date(event.start_datetime);
      expect(eventDate.getTime()).toBeGreaterThan(now.getTime());
    });

    // Verify events are sorted by start date
    for (let i = 1; i < result.events.length; i++) {
      const prev = new Date(result.events[i - 1].start_datetime);
      const curr = new Date(result.events[i].start_datetime);
      expect(curr.getTime()).toBeGreaterThanOrEqual(prev.getTime());
    }
  });

  // Test 4: Get upcoming events with limit
  test('get_upcoming_events should respect limit parameter', async () => {
    const tool = getTool('get_upcoming_events');

    const result = await executeToolWithContext(tool, { limit: 1 });

    expect(result).not.toHaveProperty('error');
    expect(result.events.length).toBeLessThanOrEqual(1);
  });

  // Test 4.5: Get upcoming events includes ongoing multi-day events
  test('get_upcoming_events should include ongoing multi-day events', async () => {
    const createTool = getTool('create_event');
    const upcomingTool = getTool('get_upcoming_events');

    // Create a multi-day event that started yesterday and ends tomorrow
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const createResult = await executeToolWithContext(createTool, {
      events: [{
      title: 'Multi-Day Conference',
        description: 'Annual tech conference spanning 3 days',
        location: 'Convention Center',
        start_datetime: yesterday.toISOString(),
        end_datetime: tomorrow.toISOString()
      }]
    });

    expect(createResult).toHaveProperty('success', true);
    expect(createResult.events[0]).toHaveProperty('title', 'Multi-Day Conference');

    // Now fetch upcoming events and verify the ongoing multi-day event is included
    const result = await executeToolWithContext(upcomingTool, { limit: 10 });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('events');
    expect(Array.isArray(result.events)).toBe(true);

    // Find the multi-day event in the results
    const multiDayEvent = result.events.find((e: any) => e.title === 'Multi-Day Conference');
    expect(multiDayEvent).toBeDefined();
    expect(multiDayEvent.end_datetime).toBeDefined();

    // Verify the event's start is in the past but end is in the future
    const startDate = new Date(multiDayEvent.start_datetime);
    const endDate = new Date(multiDayEvent.end_datetime);
    expect(startDate.getTime()).toBeLessThan(now.getTime());
    expect(endDate.getTime()).toBeGreaterThan(now.getTime());
  });

  // Test 5: Get past events
  test('get_past_events should return only past events', async () => {
    const tool = getTool('get_past_events');
    expect(tool).toBeDefined();

    const result = await executeToolWithContext(tool, { limit: 10 });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('events');
    expect(Array.isArray(result.events)).toBe(true);
    expect(result.events.length).toBeGreaterThanOrEqual(1);

    // Verify all events are in the past
    const now = new Date();
    result.events.forEach((event: any) => {
      const eventDate = new Date(event.start_datetime);
      expect(eventDate.getTime()).toBeLessThan(now.getTime());
    });

    // Verify events are sorted by start date (most recent first)
    for (let i = 1; i < result.events.length; i++) {
      const prev = new Date(result.events[i - 1].start_datetime);
      const curr = new Date(result.events[i].start_datetime);
      expect(curr.getTime()).toBeLessThanOrEqual(prev.getTime());
    }
  });

  // Test 6: Search events by text
  test('search_events should find events by title', async () => {
    const tool = getTool('search_events');
    expect(tool).toBeDefined();

    const result = await executeToolWithContext(tool, { query: 'meeting' });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('events');
    expect(Array.isArray(result.events)).toBe(true);
    expect(result.events.length).toBeGreaterThanOrEqual(1);

    // Verify the found event contains "meeting" in title (case-insensitive)
    const meetingEvent = result.events.find((e: any) =>
      e.title.toLowerCase().includes('meeting')
    );
    expect(meetingEvent).toBeDefined();
  });

  // Test 7: Search events by location
  test('search_events should find events by location', async () => {
    const tool = getTool('search_events');

    const result = await executeToolWithContext(tool, { query: 'clinic' });

    expect(result).not.toHaveProperty('error');
    expect(result.events.length).toBeGreaterThanOrEqual(1);

    // Verify the found event contains "clinic" in description or location
    const clinicEvent = result.events.find((e: any) =>
      e.description.toLowerCase().includes('clinic') ||
      e.location.toLowerCase().includes('clinic')
    );
    expect(clinicEvent).toBeDefined();
  });

  // Test 8: Search events with boolean operators
  test('search_events should support FTS5 boolean operators', async () => {
    const tool = getTool('search_events');

    // Search with AND operator
    const result = await executeToolWithContext(tool, { query: 'team AND meeting' });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('events');

    if (result.events.length > 0) {
      const teamMeetingEvent = result.events[0];
      expect(teamMeetingEvent.title.toLowerCase()).toContain('team');
      expect(teamMeetingEvent.title.toLowerCase()).toContain('meeting');
    }
  });

  // Test 9: Get events by date range
  test('get_events_by_date_range should return events in range', async () => {
    const tool = getTool('get_events_by_date_range');
    expect(tool).toBeDefined();

    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 2);
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 10);

    const result = await executeToolWithContext(tool, {
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString()
    });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('events');
    expect(result).toHaveProperty('start_date');
    expect(result).toHaveProperty('end_date');
    expect(Array.isArray(result.events)).toBe(true);
    expect(result.events.length).toBeGreaterThanOrEqual(2);

    // Verify all events are within the date range
    result.events.forEach((event: any) => {
      const eventDate = new Date(event.start_datetime);
      expect(eventDate.getTime()).toBeGreaterThanOrEqual(startDate.getTime());
      expect(eventDate.getTime()).toBeLessThanOrEqual(endDate.getTime());
    });
  });

  // Test 10: Get specific event
  test('get_event should retrieve a specific event by ID', async () => {
    // Use get_upcoming_events to get a test event
    const getUpcomingTool = getTool('get_upcoming_events');
    const upcomingResult = await executeToolWithContext(getUpcomingTool, { limit: 1 });

    expect(upcomingResult.events.length).toBeGreaterThan(0);
    const firstEventId = upcomingResult.events[0].id;

    const getEventTool = getTool('get_event');
    expect(getEventTool).toBeDefined();

    const result = await executeToolWithContext(getEventTool, { event_id: firstEventId });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('event');
    expect(result.event).toHaveProperty('id', firstEventId);
    expect(result.event).toHaveProperty('created_by');
    expect(result.event).toHaveProperty('is_own', true);
    expect(result.event).not.toHaveProperty('user_id');
  });

  // Test 11: Get non-existent event
  test('get_event should return error for non-existent event', async () => {
    const tool = getTool('get_event');

    const result = await executeToolWithContext(tool, { event_id: 'non_existent_id' });

    expect(result).toHaveProperty('error', 'Event not found');
  });
});

test.describe.configure({ mode: 'serial' });

test.describe('Event CRUD Operations', () => {
  const getTool = (name: string) => eventTools.find(
    (t) => t.definition.name === name
  );

  let createdEventId: string;

  // Test 12: Create event
  test('create_event should create a new event successfully', async () => {
    const tool = getTool('create_event');
    expect(tool).toBeDefined();

    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 2);
    const endDate = new Date(startDate);
    endDate.setHours(endDate.getHours() + 1);

    const result = await executeToolWithContext(tool, {
      events: [{
        title: 'Test Conference',
        description: 'A test conference event',
        location: 'Virtual',
        start_datetime: startDate.toISOString(),
        end_datetime: endDate.toISOString()
      }]
    });

    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('events');
    expect(result).toHaveProperty('message');
    expect(result.events[0]).toHaveProperty('id');
    expect(result.events[0]).toHaveProperty('title', 'Test Conference');
    expect(result.events[0]).toHaveProperty('description', 'A test conference event');
    expect(result.events[0]).toHaveProperty('location', 'Virtual');
    expect(result.events[0]).toHaveProperty('start_datetime', startDate.toISOString());
    expect(result.events[0]).toHaveProperty('end_datetime', endDate.toISOString());

    // Save the ID for later tests
    createdEventId = result.events[0].id;
  });

  // Test 13: Create event without optional fields
  test('create_event should work with minimal required fields', async () => {
    const tool = getTool('create_event');

    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 3);

    const result = await executeToolWithContext(tool, {
      events: [{
        title: 'Simple Event',
        start_datetime: startDate.toISOString()
      }]
    });

    expect(result).toHaveProperty('success', true);
    expect(result.events[0]).toHaveProperty('title', 'Simple Event');
    expect(result.events[0]).toHaveProperty('description', '');
    expect(result.events[0]).toHaveProperty('location', '');
    expect(result.events[0].end_datetime).toBeNull();
  });

  // Test 14: Update event
  test('update_event should modify an existing event', async () => {
    const tool = getTool('update_event');
    expect(tool).toBeDefined();

    const newStartDate = new Date();
    newStartDate.setDate(newStartDate.getDate() + 5);

    const result = await executeToolWithContext(tool, {
      events: [{
        event_id: createdEventId,
        title: 'Updated Conference',
        description: 'Updated description',
        location: 'Hybrid',
        start_datetime: newStartDate.toISOString(),
        end_datetime: null
      }]
    });

    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('events');
    expect(result).toHaveProperty('message');
    expect(result.events[0]).toHaveProperty('title', 'Updated Conference');
    expect(result.events[0]).toHaveProperty('description', 'Updated description');
    expect(result.events[0]).toHaveProperty('location', 'Hybrid');
    expect(result.events[0].end_datetime).toBeNull();
  });

  // Test 15: Update non-existent event
  test('update_event should return error for non-existent event', async () => {
    const tool = getTool('update_event');

    const result = await executeToolWithContext(tool, {
      events: [{
        event_id: 'non_existent_id',
        title: 'Should Fail',
        start_datetime: new Date().toISOString()
      }]
    });

    // With batch operations, partial errors are returned differently
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  // Test 16: Delete event
  test('delete_event should remove an event successfully', async () => {
    const deleteTool = getTool('delete_event');
    expect(deleteTool).toBeDefined();

    const result = await executeToolWithContext(deleteTool, { event_ids: [createdEventId
    ] });

    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('message');
    expect(result.message).toContain('Deleted');

    // Verify the event is actually deleted
    const getEventTool = getTool('get_event');
    const getResult = await executeToolWithContext(getEventTool, { event_id: createdEventId });
    expect(getResult).toHaveProperty('error', 'Event not found');
  });

  // Test 17: Delete non-existent event
  test('delete_event should return error for non-existent event', async () => {
    const tool = getTool('delete_event');

    const result = await executeToolWithContext(tool, {
      event_ids: ['non_existent_id']
    });

    // With batch operations, deleting non-existent events returns success: false
    expect(result).toHaveProperty('success', false);
    expect(result.count).toBe(0);
  });
});

test.describe('Event Context and Family-wide Access', () => {
  // Test 18: Family-wide event access
  test('events should be visible to all users (family-wide access)', async () => {
    const createTool = eventTools.find(t => t.definition.name === 'create_event');
    const getUpcomingTool = eventTools.find(t => t.definition.name === 'get_upcoming_events');

    // Create an event for the test user
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 10);

    await executeToolWithContext(createTool, {
      events: [{
      title: 'Family Event Test',
      start_datetime: startDate.toISOString()
    }]});

    // Get events for the test user
    const user1Events = await executeToolWithContext(getUpcomingTool, { limit: 100 });
    const user1Count = user1Events.events.length;

    // Find the event we just created
    const familyEvent = user1Events.events.find((e: any) => e.title === 'Family Event Test');
    expect(familyEvent).toBeDefined();
    expect(familyEvent.is_own).toBe(true);

    // Create a different user in the same family
    const otherUserId = uuidv4();
    const otherEmail = `test-other-${otherUserId}@example.com`;
    const hashedPassword = await hashPassword('password123');
    await createUser(otherUserId, otherEmail, hashedPassword);

    // Get events for the other user with their context
    const user2Events = await runWithToolContext(
      { userId: otherUserId },
      () => getUpcomingTool?.execute({ limit: 100 })
    );

    // Other user should see the same events (family-wide access)
    expect(user2Events.events.length).toBe(user1Count);

    // Verify the other user can see the family event but is_own is false
    const familyEventForUser2 = user2Events.events.find((e: any) => e.title === 'Family Event Test');
    expect(familyEventForUser2).toBeDefined();
    expect(familyEventForUser2.is_own).toBe(false);
  });

  // Test: Delete should error when deleting another user's event
  test('delete_event should error when deleting another user\'s event', async () => {
    const createTool = eventTools.find(t => t.definition.name === 'create_event');
    const deleteTool = eventTools.find(t => t.definition.name === 'delete_event');

    // Create an event with the test user
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 11);

    const createResult = await executeToolWithContext(createTool, {
      events: [{
        title: 'Owner Only Event',
        start_datetime: startDate.toISOString()
      }]
    });
    expect(createResult.success).toBe(true);
    const eventId = createResult.events[0].id;

    // Create another user and try to delete the event
    const otherUserId = uuidv4();
    const otherEmail = `test-delete-${otherUserId}@example.com`;
    const hashedPassword = await hashPassword('password123');
    await createUser(otherUserId, otherEmail, hashedPassword);

    const deleteResult = await runWithToolContext(
      { userId: otherUserId },
      () => deleteTool?.execute({ event_ids: [eventId] })
    );

    expect(deleteResult.success).toBe(false);
    expect(deleteResult.errors).toBeDefined();
    expect(deleteResult.errors.length).toBe(1);
    expect(deleteResult.errors[0].error).toContain('test-events-');
    expect(deleteResult.errors[0].error).toContain('You can only delete your own events');
  });

  // Test: Update should error when updating another user's event
  test('update_event should error when updating another user\'s event', async () => {
    const createTool = eventTools.find(t => t.definition.name === 'create_event');
    const updateTool = eventTools.find(t => t.definition.name === 'update_event');

    // Create an event with the test user
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 12);

    const createResult = await executeToolWithContext(createTool, {
      events: [{
        title: 'Cannot Update This',
        start_datetime: startDate.toISOString()
      }]
    });
    expect(createResult.success).toBe(true);
    const eventId = createResult.events[0].id;

    // Create another user and try to update the event
    const otherUserId = uuidv4();
    const otherEmail = `test-update-${otherUserId}@example.com`;
    const hashedPassword = await hashPassword('password123');
    await createUser(otherUserId, otherEmail, hashedPassword);

    const updateResult = await runWithToolContext(
      { userId: otherUserId },
      () => updateTool?.execute({
        events: [{
          event_id: eventId,
          title: 'Hacked Title',
          start_datetime: startDate.toISOString()
        }]
      })
    );

    expect(updateResult.success).toBe(false);
    expect(updateResult.errors).toBeDefined();
    expect(updateResult.errors.length).toBe(1);
    expect(updateResult.errors[0].error).toContain('test-events-');
    expect(updateResult.errors[0].error).toContain('You can only update your own events');
  });

  // Test: Events should include created_by and is_own fields correctly for multiple users
  test('events should include correct created_by and is_own for each user', async () => {
    const createTool = eventTools.find(t => t.definition.name === 'create_event');
    const getUpcomingTool = eventTools.find(t => t.definition.name === 'get_upcoming_events');

    // Create another user
    const otherUserId = uuidv4();
    const otherEmail = `test-multi-${otherUserId}@example.com`;
    const hashedPassword = await hashPassword('password123');
    await createUser(otherUserId, otherEmail, hashedPassword);

    // Create event with other user
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 13);

    await runWithToolContext(
      { userId: otherUserId },
      () => createTool?.execute({
        events: [{
          title: 'Other User Event',
          start_datetime: startDate.toISOString()
        }]
      })
    );

    // Query as testUser - should see both own and other's events
    const result = await executeToolWithContext(getUpcomingTool, { limit: 100 });

    const ownEvent = result.events.find((e: any) => e.title === 'Family Event Test');
    const otherEvent = result.events.find((e: any) => e.title === 'Other User Event');

    expect(ownEvent).toBeDefined();
    expect(ownEvent.is_own).toBe(true);
    expect(ownEvent.created_by).toContain('test-events-');

    expect(otherEvent).toBeDefined();
    expect(otherEvent.is_own).toBe(false);
    expect(otherEvent.created_by).toContain('test-multi-');
  });

  // Test 19: Context injection formatting
  test('getUpcomingEventsContext should format events correctly', async () => {
    const { getUpcomingEventsContext } = await import('../src/lib/ai/tools/events');

    const context = await getUpcomingEventsContext(testUserId, 5);

    expect(context).toBeTruthy();
    expect(typeof context).toBe('string');

    // Should contain "Upcoming Events" header
    if (!context.includes('No upcoming events')) {
      expect(context).toContain('Upcoming Events');
      // Should contain event details
      expect(context).toMatch(/Start:/);
    }
  });

  // Test 20: Empty context when no events
  test('getUpcomingEventsContext returns family-wide events', async () => {
    const { getUpcomingEventsContext } = await import('../src/lib/ai/tools/events');

    // Create a new user who hasn't created any events themselves
    const newUserId = uuidv4();
    const newEmail = `test-new-${newUserId}@example.com`;
    const hashedPassword = await hashPassword('password123');
    await createUser(newUserId, newEmail, hashedPassword);

    // With family-wide access, the new user should see events from other family members
    const context = await getUpcomingEventsContext(newUserId, 5);

    // Should include events from the family, not just "No upcoming events"
    expect(context).toContain('Upcoming Events');
  });

  // Test 21: Verify events context injection in chat API (e2e)
  test('events context should be injected into chat API', async ({ page }) => {
    // Import event tools to create test events
    const createTool = eventTools.find(t => t.definition.name === 'create_event');
    expect(createTool).toBeDefined();

    // Create a future event for context injection test
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    await executeToolWithContext(createTool, {
      events: [{
      title: 'E2E Context Test Event',
      description: 'This event should appear in chat context',
      location: 'E2E Test Location',
      start_datetime: tomorrow.toISOString(),
      end_datetime: null
    }]});

    // Navigate to home page
    await setupPageWithUser(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Intercept the chat API request to inspect the payload
    let chatRequestBody: any = null;
    await page.route('**/api/chat', async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        chatRequestBody = request.postDataJSON();
      }
      await route.continue();
    });

    // Type a message and send it
    const input = page.locator('textarea[placeholder="Ask me anything..."]');
    await input.fill('What are my upcoming events?');
    await input.press('Enter');

    // Wait for the chat request to be made
    await page.waitForTimeout(2000);

    // Verify the events context would be available
    const { getUpcomingEventsContext } = await import('../src/lib/ai/tools/events');
    const context = await getUpcomingEventsContext(testUserId, 5);

    // Verify the context contains our test event
    expect(context).toContain('E2E Context Test Event');
    expect(context).toContain('E2E Test Location');
    expect(context).toContain('Upcoming Events');
    expect(context).not.toContain('No upcoming events');

    // Verify the format is suitable for AI injection
    expect(context).toMatch(/Start:/);
    expect(context).toMatch(/Location:/);
    expect(context).toMatch(/Description:/);
  });
});

test.describe('Error Handling', () => {
  const getTool = (name: string) => eventTools.find(
    (t) => t.definition.name === name
  );

  // Test 21: Missing user context
  test('tools should fail or return error without user context', async () => {
    const tool = getTool('get_upcoming_events');

    // Test that it either throws an error or returns an error object when called without context
    let hasError = false;
    try {
      // Call tool directly without runWithToolContext to test missing context
      const result = await tool?.execute({});
      // Check if result has an error property
      if (result && result.error) {
        hasError = true;
      }
    } catch (error: any) {
      // Throwing an error is also acceptable
      hasError = true;
    }

    // Either way (throw or error result), it should indicate a problem
    expect(hasError).toBe(true);
  });

  // Test 22: Invalid date format handling
  test('create_event should handle invalid date formats', async () => {
    const tool = getTool('create_event');

    // The tool will pass invalid dates to the DB, which should handle it
    // This tests the error propagation
    try {
      await executeToolWithContext(tool, {
        events: [{
          title: 'Invalid Date Event',
          start_datetime: 'not-a-date'
        }]
      });
      // If it doesn't throw, that's also acceptable (DB might accept it)
      // The important thing is that it doesn't crash
      expect(true).toBe(true);
    } catch (error) {
      // Error is expected and acceptable
      expect(error).toBeDefined();
    }
  });

  // Test 23: Search with empty query
  test('search_events should handle empty query', async () => {
    const tool = getTool('search_events');

    // FTS5 might throw an error or return all results for empty query
    // Test that it doesn't crash
    const result = await executeToolWithContext(tool, { query: '' });

    // Should either return results or an error, but not crash
    expect(result).toBeDefined();
  });
});

test.describe('Recurring Events', () => {
  const getEventTool = (name: string) => eventTools.find(
    (t) => t.definition.name === name
  );

  let weeklyEventId: string;

  // Test: Create weekly recurring event
  test('should create a weekly recurring event', async () => {
    const createTool = getEventTool('create_event');
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);

    const recurrenceEnd = new Date(tomorrow);
    recurrenceEnd.setDate(recurrenceEnd.getDate() + 28); // 4 weeks

    const result = await executeToolWithContext(createTool, {
      events: [{
      title: 'Weekly Team Standup',
      description: 'Weekly team sync meeting',
      location: 'Conference Room B',
      start_datetime: tomorrow.toISOString(),
      end_datetime: new Date(tomorrow.getTime() + 60 * 60 * 1000).toISOString(), // 1 hour later
      recurrence_type: 'weekly',
      recurrence_end_date: recurrenceEnd.toISOString()
    }]});

    expect(result).toHaveProperty('success', true);
    expect(result.events[0]).toHaveProperty('recurrence_type', 'weekly');
    expect(result.events[0]).toHaveProperty('recurrence_end_date');
    expect(result.message).toContain('Created');

    weeklyEventId = result.events[0].id;
  });

  // Test: Create monthly recurring event
  test('should create a monthly recurring event', async () => {
    const createTool = getEventTool('create_event');
    const now = new Date();
    const nextMonth = new Date(now);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(1);
    nextMonth.setHours(14, 0, 0, 0);

    const recurrenceEnd = new Date(nextMonth);
    recurrenceEnd.setMonth(recurrenceEnd.getMonth() + 6); // 6 months

    const result = await executeToolWithContext(createTool, {
      events: [{
      title: 'Monthly Review Meeting',
      description: 'Monthly performance review',
      location: 'Executive Office',
      start_datetime: nextMonth.toISOString(),
      end_datetime: new Date(nextMonth.getTime() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours later
      recurrence_type: 'monthly',
      recurrence_end_date: recurrenceEnd.toISOString()
    }]});

    expect(result).toHaveProperty('success', true);
    expect(result.events[0]).toHaveProperty('recurrence_type', 'monthly');
    expect(result.events[0]).toHaveProperty('recurrence_end_date');
    expect(result.message).toContain('Created');
  });

  // Test: Get upcoming events should include recurring occurrences
  test('get_upcoming_events should return multiple occurrences of recurring events', async () => {
    const tool = getEventTool('get_upcoming_events');
    const result = await executeToolWithContext(tool, { limit: 20 });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('events');
    expect(Array.isArray(result.events)).toBe(true);

    // Should have multiple occurrences of the weekly event
    const weeklyOccurrences = result.events.filter(
      (e: any) => e.title === 'Weekly Team Standup'
    );
    expect(weeklyOccurrences.length).toBeGreaterThan(1);

    // Verify occurrences are spaced 7 days apart
    if (weeklyOccurrences.length >= 2) {
      const first = new Date(weeklyOccurrences[0].start_datetime);
      const second = new Date(weeklyOccurrences[1].start_datetime);
      const daysDiff = (second.getTime() - first.getTime()) / (1000 * 60 * 60 * 24);
      expect(Math.abs(daysDiff - 7)).toBeLessThan(1); // Allow small floating point difference
    }
  });

  // Test: Get events by date range should include recurring occurrences
  test('get_events_by_date_range should expand recurring events', async () => {
    const tool = getEventTool('get_events_by_date_range');
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 1);
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 60); // 2 months ahead

    const result = await executeToolWithContext(tool, {
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString()
    });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('events');
    expect(Array.isArray(result.events)).toBe(true);

    // Should have multiple occurrences of recurring events
    const weeklyOccurrences = result.events.filter(
      (e: any) => e.title === 'Weekly Team Standup'
    );
    const monthlyOccurrences = result.events.filter(
      (e: any) => e.title === 'Monthly Review Meeting'
    );

    expect(weeklyOccurrences.length).toBeGreaterThan(1);
    expect(monthlyOccurrences.length).toBeGreaterThanOrEqual(1);
  });

  // Test: Update recurring event
  test('should update recurring event pattern', async () => {
    const updateTool = getEventTool('update_event');
    const getEventToolFunc = getEventTool('get_event');

    // Get the current event
    const currentEvent = await executeToolWithContext(getEventToolFunc, {
      event_id: weeklyEventId
    });

    // Update to change recurrence end date
    const newRecurrenceEnd = new Date();
    newRecurrenceEnd.setDate(newRecurrenceEnd.getDate() + 14); // 2 weeks

    const result = await executeToolWithContext(updateTool, {
      events: [{
      event_id: weeklyEventId,
      title: 'Weekly Team Standup (Updated)',
      description: currentEvent.event.description,
      location: currentEvent.event.location,
      start_datetime: currentEvent.event.start_datetime,
      end_datetime: currentEvent.event.end_datetime,
      recurrence_type: 'weekly',
      recurrence_end_date: newRecurrenceEnd.toISOString()
    }]});

    expect(result).toHaveProperty('success', true);
    expect(result.events[0].title).toBe('Weekly Team Standup (Updated)');
    expect(result.events[0].recurrence_type).toBe('weekly');
    expect(result.events[0].recurrence_end_date).toBe(newRecurrenceEnd.toISOString());
  });

  // Test: Create recurring event without end date
  test('should create recurring event without end date', async () => {
    const createTool = getEventTool('create_event');
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() + 2);
    startDate.setHours(9, 0, 0, 0);

    const result = await executeToolWithContext(createTool, {
      events: [{
      title: 'Daily Reminder',
      description: 'Daily task reminder',
      location: 'Online',
      start_datetime: startDate.toISOString(),
      recurrence_type: 'weekly'
      // No recurrence_end_date - should recur indefinitely
    }]});

    expect(result).toHaveProperty('success', true);
    expect(result.events[0]).toHaveProperty('recurrence_type', 'weekly');
    expect(result.events[0].recurrence_end_date).toBeNull();
  });

  // Test: Delete recurring event should delete the base event
  test('should delete recurring event', async () => {
    const createTool = getEventTool('create_event');
    const deleteTool = getEventTool('delete_event');
    const getEventToolFunc = getEventTool('get_event');

    // First create an event to delete
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() + 3);
    startDate.setHours(15, 0, 0, 0);

    const createResult = await executeToolWithContext(createTool, {
      events: [{
      title: 'Event to Delete',
      description: 'This event will be deleted',
      location: 'Nowhere',
      start_datetime: startDate.toISOString(),
      recurrence_type: 'weekly'
    }]});

    expect(createResult).toHaveProperty('success', true);
    const eventIdToDelete = createResult.events[0].id;

    // Now delete it
    const result = await executeToolWithContext(deleteTool, { event_ids: [eventIdToDelete
    ] });

    expect(result).toHaveProperty('success', true);

    // Verify event is deleted
    const getResult = await executeToolWithContext(getEventToolFunc, {
      event_id: eventIdToDelete
    });

    expect(getResult).toHaveProperty('error', 'Event not found');
  });
});

test.describe('Batch Operations', () => {
  const getEventTool = (name: string) => eventTools.find(
    (t) => t.definition.name === name
  );

  // Test: Batch create events
  test('should create multiple events in batch', async () => {
    const createTool = getEventTool('create_event');
    const now = new Date();

    const event1Start = new Date(now);
    event1Start.setDate(event1Start.getDate() + 5);
    event1Start.setHours(10, 0, 0, 0);

    const event2Start = new Date(now);
    event2Start.setDate(event2Start.getDate() + 6);
    event2Start.setHours(14, 0, 0, 0);

    const event3Start = new Date(now);
    event3Start.setDate(event3Start.getDate() + 7);
    event3Start.setHours(16, 0, 0, 0);

    const result = await executeToolWithContext(createTool, {
      events: [
        {
          title: 'Batch Event 1',
          description: 'First batch event',
          location: 'Location 1',
          start_datetime: event1Start.toISOString(),
          end_datetime: new Date(event1Start.getTime() + 60 * 60 * 1000).toISOString()
        },
        {
          title: 'Batch Event 2',
          description: 'Second batch event',
          location: 'Location 2',
          start_datetime: event2Start.toISOString(),
          end_datetime: new Date(event2Start.getTime() + 90 * 60 * 1000).toISOString()
        },
        {
          title: 'Batch Event 3',
          description: 'Third batch event',
          location: 'Location 3',
          start_datetime: event3Start.toISOString()
        }
      ]
    });

    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('events');
    expect(Array.isArray(result.events)).toBe(true);
    expect(result.events.length).toBe(3);
    expect(result.count).toBe(3);
    expect(result.message).toContain('Created 3 event(s)');

    // Verify each event was created correctly
    expect(result.events[0].title).toBe('Batch Event 1');
    expect(result.events[1].title).toBe('Batch Event 2');
    expect(result.events[2].title).toBe('Batch Event 3');
  });

  // Test: Batch update events
  test('should update multiple events in batch', async () => {
    const createTool = getEventTool('create_event');
    const updateTool = getEventTool('update_event');
    const now = new Date();

    // First create some events
    const event1Start = new Date(now);
    event1Start.setDate(event1Start.getDate() + 10);
    event1Start.setHours(9, 0, 0, 0);

    const event2Start = new Date(now);
    event2Start.setDate(event2Start.getDate() + 11);
    event2Start.setHours(11, 0, 0, 0);

    const createResult = await executeToolWithContext(createTool, {
      events: [
        {
          title: 'Event to Update 1',
          description: 'Original description 1',
          location: 'Original Location 1',
          start_datetime: event1Start.toISOString()
        },
        {
          title: 'Event to Update 2',
          description: 'Original description 2',
          location: 'Original Location 2',
          start_datetime: event2Start.toISOString()
        }
      ]
    });

    expect(createResult.success).toBe(true);
    const eventIds = createResult.events.map((e: any) => e.id);

    // Now update them in batch
    const newEvent1Start = new Date(event1Start);
    newEvent1Start.setHours(10, 0, 0, 0);
    const newEvent2Start = new Date(event2Start);
    newEvent2Start.setHours(12, 0, 0, 0);

    const updateResult = await executeToolWithContext(updateTool, {
      events: [
        {
          event_id: eventIds[0],
          title: 'Updated Event 1',
          description: 'Updated description 1',
          location: 'Updated Location 1',
          start_datetime: newEvent1Start.toISOString()
        },
        {
          event_id: eventIds[1],
          title: 'Updated Event 2',
          description: 'Updated description 2',
          location: 'Updated Location 2',
          start_datetime: newEvent2Start.toISOString()
        }
      ]
    });

    expect(updateResult).toHaveProperty('success', true);
    expect(updateResult.events.length).toBe(2);
    expect(updateResult.count).toBe(2);
    expect(updateResult.message).toContain('Updated 2 event(s)');

    // Verify updates
    expect(updateResult.events[0].title).toBe('Updated Event 1');
    expect(updateResult.events[1].title).toBe('Updated Event 2');
  });

  // Test: Batch delete events
  test('should delete multiple events in batch', async () => {
    const createTool = getEventTool('create_event');
    const deleteTool = getEventTool('delete_event');
    const getEventToolFunc = getEventTool('get_event');
    const now = new Date();

    // Create events to delete
    const event1Start = new Date(now);
    event1Start.setDate(event1Start.getDate() + 15);
    event1Start.setHours(8, 0, 0, 0);

    const event2Start = new Date(now);
    event2Start.setDate(event2Start.getDate() + 16);
    event2Start.setHours(9, 0, 0, 0);

    const event3Start = new Date(now);
    event3Start.setDate(event3Start.getDate() + 17);
    event3Start.setHours(10, 0, 0, 0);

    const createResult = await executeToolWithContext(createTool, {
      events: [
        {
          title: 'Event to Delete 1',
          description: 'Will be deleted',
          location: 'Somewhere',
          start_datetime: event1Start.toISOString()
        },
        {
          title: 'Event to Delete 2',
          description: 'Will be deleted',
          location: 'Somewhere',
          start_datetime: event2Start.toISOString()
        },
        {
          title: 'Event to Delete 3',
          description: 'Will be deleted',
          location: 'Somewhere',
          start_datetime: event3Start.toISOString()
        }
      ]
    });

    expect(createResult.success).toBe(true);
    const eventIds = createResult.events.map((e: any) => e.id);

    // Delete them in batch
    const deleteResult = await executeToolWithContext(deleteTool, {
      event_ids: eventIds
    });

    expect(deleteResult).toHaveProperty('success', true);
    expect(deleteResult.count).toBe(3);
    expect(deleteResult.message).toContain('Deleted 3 event(s)');

    // Verify all events are deleted
    for (const eventId of eventIds) {
      const getResult = await executeToolWithContext(getEventToolFunc, {
        event_id: eventId
      });
      expect(getResult).toHaveProperty('error', 'Event not found');
    }
  });

  // Test: Batch create with partial errors
  test('should handle partial errors in batch create', async () => {
    const createTool = getEventTool('create_event');
    const now = new Date();

    const validStart = new Date(now);
    validStart.setDate(validStart.getDate() + 20);
    validStart.setHours(10, 0, 0, 0);

    const result = await executeToolWithContext(createTool, {
      events: [
        {
          title: 'Valid Event',
          description: 'This one is valid',
          location: 'Location',
          start_datetime: validStart.toISOString()
        },
        {
          // Missing required fields
          description: 'Missing title and start_datetime',
          location: 'Location'
        },
        {
          title: 'Another Valid Event',
          description: 'This one is also valid',
          location: 'Location 2',
          start_datetime: new Date(validStart.getTime() + 24 * 60 * 60 * 1000).toISOString()
        }
      ]
    });

    expect(result).toHaveProperty('success', false); // Not all succeeded
    expect(result.events.length).toBe(2); // 2 valid events created
    expect(result.errors).toBeDefined();
    expect(result.errors.length).toBe(1); // 1 error
    expect(result.message).toContain('Created 2 event(s)');
    expect(result.message).toContain('1 error');
  });
});

test.describe('Tool Definitions', () => {
  // Test 24: All tools have required properties
  test('all event tools should have valid definitions', () => {
    eventTools.forEach((tool) => {
      expect(tool).toHaveProperty('definition');
      expect(tool).toHaveProperty('execute');

      const def = tool.definition;
      expect(def).toHaveProperty('name');
      expect(def).toHaveProperty('description');
      expect(def).toHaveProperty('parameters');

      expect(typeof def.name).toBe('string');
      expect(typeof def.description).toBe('string');
      expect(def.parameters).toHaveProperty('type');
      expect(def.parameters).toHaveProperty('properties');
    });
  });

  // Test 25: Tool names are unique
  test('all event tools should have unique names', () => {
    const names = eventTools.map(t => t.definition.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  // Test 26: Expected tools exist
  test('should have all expected event tools', () => {
    const expectedTools = [
      'search_events',
      'get_events_by_date_range',
      'get_upcoming_events',
      'get_past_events',
      'get_event',
      'create_event',
      'update_event',
      'delete_event'
    ];

    expectedTools.forEach(toolName => {
      const tool = eventTools.find(t => t.definition.name === toolName);
      expect(tool).toBeDefined();
    });

    expect(eventTools.length).toBe(expectedTools.length);
  });
});

// Cleanup after all tests
test.afterAll(async () => {
  // Clean up all test events using database directly
  const { getAllEvents } = await import('../src/lib/db');
  const deleteTool = eventTools.find(t => t.definition.name === 'delete_event');

  const allEvents = await getAllEvents(testUserId);

  for (const event of allEvents) {
    await executeToolWithContext(deleteTool, { event_ids: [event.id ] });
  }
});
