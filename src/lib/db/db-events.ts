import { DbWrapper, Event } from './db-types';

/**
 * Helper function to expand recurring events into individual occurrences
 * within a given date range.
 */
function expandRecurringEvent(
  event: Event,
  rangeStart: Date,
  rangeEnd: Date,
  maxOccurrences: number = 50
): Array<Event & { occurrence_date: string }> {
  // If not recurring, return the event as-is if it falls within range
  if (!event.recurrence_type) {
    const eventStart = new Date(event.start_datetime);
    const eventEnd = event.end_datetime ? new Date(event.end_datetime) : eventStart;

    // Check if event overlaps with range
    if (eventStart <= rangeEnd && eventEnd >= rangeStart) {
      return [{ ...event, occurrence_date: event.start_datetime }];
    }
    return [];
  }

  const occurrences: Array<Event & { occurrence_date: string }> = [];
  const eventStart = new Date(event.start_datetime);
  const eventDuration = event.end_datetime
    ? new Date(event.end_datetime).getTime() - eventStart.getTime()
    : 0;

  const recurrenceEndDate = event.recurrence_end_date
    ? new Date(event.recurrence_end_date)
    : new Date(rangeEnd.getTime() + 365 * 24 * 60 * 60 * 1000); // Default 1 year if no end date

  let currentDate = new Date(eventStart);
  let count = 0;

  while (currentDate <= rangeEnd && currentDate <= recurrenceEndDate && count < maxOccurrences) {
    // Check if this occurrence falls within the requested range
    const occurrenceEnd = eventDuration > 0
      ? new Date(currentDate.getTime() + eventDuration)
      : currentDate;

    if (currentDate >= rangeStart || occurrenceEnd >= rangeStart) {
      const occurrenceStartStr = currentDate.toISOString();
      const occurrenceEndStr = eventDuration > 0
        ? new Date(currentDate.getTime() + eventDuration).toISOString()
        : null;

      occurrences.push({
        ...event,
        start_datetime: occurrenceStartStr,
        end_datetime: occurrenceEndStr,
        occurrence_date: occurrenceStartStr
      });
    }

    // Move to next occurrence
    if (event.recurrence_type === 'weekly') {
      currentDate.setDate(currentDate.getDate() + 7);
    } else if (event.recurrence_type === 'monthly') {
      currentDate.setMonth(currentDate.getMonth() + 1);
    }

    count++;
  }

  return occurrences;
}

export async function createEvent(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string,
  title: string,
  description: string,
  location: string,
  startDatetime: string,
  endDatetime: string | null = null,
  recurrenceType: string | null = null,
  recurrenceEndDate: string | null = null
): Promise<Event> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    INSERT INTO events (id, user_id, title, description, location, start_datetime, end_datetime, recurrence_type, recurrence_end_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, title, description, location, startDatetime, endDatetime, recurrenceType, recurrenceEndDate);

  return (await getEvent(dbWrapper, ensureInitialized, userId, id))!;
}

export async function getEvent(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string
): Promise<Event | null> {
  await ensureInitialized();
  // Family-wide access: lookup by id only (no user_id filter)
  const result = await dbWrapper.prepare("SELECT * FROM events WHERE id = ?").get(id);
  return (result as Event | undefined) || null;
}

export async function getAllEvents(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string
): Promise<Event[]> {
  await ensureInitialized();
  // Family-wide access: get all events (no user_id filter)
  const results = await dbWrapper.prepare(
    "SELECT * FROM events ORDER BY start_datetime ASC"
  ).all();
  return results as Event[];
}

export async function updateEvent(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string,
  title: string,
  description: string,
  location: string,
  startDatetime: string,
  endDatetime: string | null,
  recurrenceType: string | null = null,
  recurrenceEndDate: string | null = null
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare(`
    UPDATE events
    SET title = ?, description = ?, location = ?, start_datetime = ?, end_datetime = ?, recurrence_type = ?, recurrence_end_date = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(title, description, location, startDatetime, endDatetime, recurrenceType, recurrenceEndDate, id, userId);
}

export async function deleteEvent(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  id: string
): Promise<void> {
  await ensureInitialized();
  await dbWrapper.prepare("DELETE FROM events WHERE id = ? AND user_id = ?").run(id, userId);
}

export async function searchEvents(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  searchQuery: string
): Promise<Event[]> {
  await ensureInitialized();

  // Family-wide access: Use FTS5 for full-text search across title, location, and description (no user_id filter)
  const results = await dbWrapper.prepare(`
    SELECT e.* FROM events e
    JOIN events_fts fts ON e.rowid = fts.rowid
    WHERE fts.events_fts MATCH ?
    ORDER BY e.start_datetime ASC
  `).all(searchQuery);

  return results as Event[];
}

export async function getEventsByDateRange(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  startDate: string,
  endDate: string
): Promise<Event[]> {
  await ensureInitialized();

  const start = new Date(startDate);
  const end = new Date(endDate);

  // Family-wide access: Get all events that could have occurrences in this range (no user_id filter)
  // This includes non-recurring events in range and recurring events that haven't ended yet
  const results = await dbWrapper.prepare(`
    SELECT * FROM events
    WHERE (
      (recurrence_type IS NULL AND start_datetime >= ? AND start_datetime <= ?)
      OR (recurrence_type IS NOT NULL AND
          start_datetime <= ? AND
          (recurrence_end_date IS NULL OR recurrence_end_date >= ?))
    )
    ORDER BY start_datetime ASC
  `).all(startDate, endDate, endDate, startDate);

  const events = results as Event[];

  // Expand recurring events
  const expandedEvents: Event[] = [];
  for (const event of events) {
    const occurrences = expandRecurringEvent(event, start, end, 100);
    expandedEvents.push(...occurrences);
  }

  // Sort by start datetime
  expandedEvents.sort((a, b) =>
    new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime()
  );

  return expandedEvents;
}

export async function getUpcomingEvents(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  limit: number = 5
): Promise<Event[]> {
  await ensureInitialized();

  const now = new Date();
  const nowISO = now.toISOString();
  const futureDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // Look 1 year ahead

  // Family-wide access: Get all events that are (no user_id filter):
  // 1. Non-recurring and upcoming/ongoing
  // 2. Recurring with recurrence_end_date in the future or null
  const results = await dbWrapper.prepare(`
    SELECT * FROM events
    WHERE (
      (recurrence_type IS NULL AND (start_datetime >= ? OR (end_datetime IS NOT NULL AND end_datetime >= ?)))
      OR (recurrence_type IS NOT NULL AND (recurrence_end_date IS NULL OR recurrence_end_date >= ?))
    )
    ORDER BY start_datetime ASC
  `).all(nowISO, nowISO, nowISO);

  const events = results as Event[];

  // Expand recurring events
  const expandedEvents: Event[] = [];
  for (const event of events) {
    const occurrences = expandRecurringEvent(event, now, futureDate, 100);
    expandedEvents.push(...occurrences);
  }

  // Sort by start datetime and limit
  expandedEvents.sort((a, b) =>
    new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime()
  );

  return expandedEvents.slice(0, limit);
}

export async function getPastEvents(
  dbWrapper: DbWrapper,
  ensureInitialized: () => Promise<void>,
  userId: string,
  limit: number = 10
): Promise<Event[]> {
  await ensureInitialized();

  const now = new Date().toISOString();
  // Family-wide access: Get all past events (no user_id filter)
  const results = await dbWrapper.prepare(`
    SELECT * FROM events
    WHERE start_datetime < ?
    ORDER BY start_datetime DESC
    LIMIT ?
  `).all(now, limit);

  return results as Event[];
}
