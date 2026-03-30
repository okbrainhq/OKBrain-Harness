import { ToolDefinition, Tool } from './types';
import { requireUserId } from './context';
import {
  createEvent,
  getEvent,
  updateEvent,
  deleteEvent,
  searchEvents,
  getEventsByDateRange,
  getUpcomingEvents,
  getPastEvents,
  getUserById,
} from '../../db';
import { Event } from '../../db/db-types';

/**
 * Get user ID from context
 * Uses AsyncLocalStorage context injected by the AI provider
 */
function getUserId(): string {
  return requireUserId();
}

/**
 * Enrich events with creator name and ownership info for AI consumption.
 * Strips raw user_id and adds created_by (name from email) and is_own flag.
 */
async function enrichEventsForAI(events: Event[], currentUserId: string) {
  const uniqueUserIds = [...new Set(events.map(e => e.user_id))];
  const userMap = new Map<string, string>();
  for (const uid of uniqueUserIds) {
    const user = await getUserById(uid);
    if (user) {
      userMap.set(uid, user.email.split('@')[0]);
    }
  }
  return events.map(({ user_id, ...rest }) => ({
    ...rest,
    created_by: userMap.get(user_id) || 'unknown',
    is_own: user_id === currentUserId,
  }));
}

/**
 * Event Lookup Tools - Can be called automatically by AI
 */

const searchEventsDefinition: ToolDefinition = {
  name: "search_events",
  shortDescription: "Search events by keyword. Provide a query string.",
  description: "Search for events using full-text search across title, location, and description. Returns events with times in UTC. When displaying to user, convert times from UTC to their local timezone.",
  parameters: {
    type: "OBJECT",
    properties: {
      query: {
        type: "STRING",
        description: "Search query to match against event title, location, and description. Use FTS5 syntax (e.g., 'meeting', 'doctor AND appointment', 'lunch OR dinner')."
      }
    },
    required: ["query"]
  }
};

async function executeSearchEvents(args: any): Promise<any> {
  try {
    const userId = getUserId();
    const rawEvents = await searchEvents(userId, args.query);
    const events = await enrichEventsForAI(rawEvents, userId);
    return {
      events,
      count: events.length
    };
  } catch (error: any) {
    console.error('[EVENT TOOLS ERROR] search_events failed:', error.message);
    console.error('[EVENT TOOLS ERROR] Args:', JSON.stringify(args));
    console.error('[EVENT TOOLS ERROR] Stack:', error.stack);
    return { error: `Failed to search events: ${error.message}` };
  }
}

const getEventsByDateRangeDefinition: ToolDefinition = {
  name: "get_events_by_date_range",
  shortDescription: "Get events in a date range. Provide start_date and end_date in UTC ISO 8601.",
  description: "Get events within a specific date range. Query parameters should be in UTC. Returns events with times in UTC. When displaying to user, convert times from UTC to their local timezone.",
  parameters: {
    type: "OBJECT",
    properties: {
      start_date: {
        type: "STRING",
        description: "Start date in ISO 8601 UTC format (must end with 'Z'). Example: '2026-02-01T00:00:00Z'"
      },
      end_date: {
        type: "STRING",
        description: "End date in ISO 8601 UTC format (must end with 'Z'). Example: '2026-02-28T23:59:59Z'"
      }
    },
    required: ["start_date", "end_date"]
  }
};

async function executeGetEventsByDateRange(args: any): Promise<any> {
  try {
    const userId = getUserId();
    const rawEvents = await getEventsByDateRange(userId, args.start_date, args.end_date);
    const events = await enrichEventsForAI(rawEvents, userId);
    return {
      events,
      count: events.length,
      start_date: args.start_date,
      end_date: args.end_date
    };
  } catch (error: any) {
    console.error('[EVENT TOOLS ERROR] get_events_by_date_range failed:', error.message);
    console.error('[EVENT TOOLS ERROR] Args:', JSON.stringify(args));
    return { error: `Failed to get events by date range: ${error.message}` };
  }
}

const getUpcomingEventsDefinition: ToolDefinition = {
  name: "get_upcoming_events",
  shortDescription: "Get upcoming events. Optionally provide a limit (default 5).",
  description: "Get upcoming events starting from now. Returns events sorted by start date in UTC. When displaying to user, convert times from UTC to their local timezone.",
  parameters: {
    type: "OBJECT",
    properties: {
      limit: {
        type: "INTEGER",
        description: "Maximum number of events to return (default: 5, max: 50)"
      }
    },
    required: []
  }
};

async function executeGetUpcomingEvents(args: any): Promise<any> {
  try {
    const userId = getUserId();
    const limit = args.limit || 5;
    const rawEvents = await getUpcomingEvents(userId, Math.min(limit, 50));
    const events = await enrichEventsForAI(rawEvents, userId);
    return {
      events,
      count: events.length
    };
  } catch (error: any) {
    console.error('[EVENT TOOLS ERROR] get_upcoming_events failed:', error.message);
    console.error('[EVENT TOOLS ERROR] Args:', JSON.stringify(args));
    return { error: `Failed to get upcoming events: ${error.message}` };
  }
}

const getPastEventsDefinition: ToolDefinition = {
  name: "get_past_events",
  shortDescription: "Get past events. Optionally provide a limit (default 10).",
  description: "Get past events. Returns events sorted by start date (most recent first) in UTC. When displaying to user, convert times from UTC to their local timezone.",
  parameters: {
    type: "OBJECT",
    properties: {
      limit: {
        type: "INTEGER",
        description: "Maximum number of events to return (default: 10, max: 50)"
      }
    },
    required: []
  }
};

async function executeGetPastEvents(args: any): Promise<any> {
  try {
    const userId = getUserId();
    const limit = args.limit || 10;
    const rawEvents = await getPastEvents(userId, Math.min(limit, 50));
    const events = await enrichEventsForAI(rawEvents, userId);
    return {
      events,
      count: events.length
    };
  } catch (error: any) {
    console.error('[EVENT TOOLS ERROR] get_past_events failed:', error.message);
    console.error('[EVENT TOOLS ERROR] Args:', JSON.stringify(args));
    return { error: `Failed to get past events: ${error.message}` };
  }
}

const getEventDefinition: ToolDefinition = {
  name: "get_event",
  shortDescription: "Get a specific event by its ID.",
  description: "Get a specific event by ID. Returns event with times in UTC. When displaying to user, convert times from UTC to their local timezone.",
  parameters: {
    type: "OBJECT",
    properties: {
      event_id: {
        type: "STRING",
        description: "The ID of the event to retrieve"
      }
    },
    required: ["event_id"]
  }
};

async function executeGetEvent(args: any): Promise<any> {
  try {
    const userId = getUserId();
    const event = await getEvent(userId, args.event_id);
    if (!event) {
      return { error: "Event not found" };
    }
    const [enriched] = await enrichEventsForAI([event], userId);
    return { event: enriched };
  } catch (error: any) {
    console.error('[EVENT TOOLS ERROR] get_event failed:', error.message);
    console.error('[EVENT TOOLS ERROR] Args:', JSON.stringify(args));
    return { error: `Failed to get event: ${error.message}` };
  }
}

/**
 * Event CRUD Tools - Require user confirmation before execution
 * These are marked with requiresConfirmation to ensure user approval
 */

const createEventDefinition: ToolDefinition = {
  name: "create_event",
  shortDescription: "Create events. Provide an array of event objects with title and start_datetime (UTC ISO 8601 with Z).",
  description: "Create one or multiple events. This requires user confirmation. TIMEZONE HANDLING: ALWAYS store times in UTC (ISO 8601 with 'Z' suffix). When user provides time without timezone, interpret it in their current location's timezone and convert to UTC. When displaying times back to user, convert from UTC to their local timezone. RECURRENCE: Supports weekly and monthly recurring events.",
  parameters: {
    type: "OBJECT",
    properties: {
      events: {
        type: "ARRAY",
        description: "Array of events to create.",
        items: {
          type: "OBJECT",
          properties: {
            title: {
              type: "STRING",
              description: "Event title (required)"
            },
            description: {
              type: "STRING",
              description: "Event description (optional)"
            },
            location: {
              type: "STRING",
              description: "Event location (optional)"
            },
            start_datetime: {
              type: "STRING",
              description: "Start date and time in ISO 8601 UTC format (MUST end with 'Z'). Example: '2026-02-15T14:00:00Z'. Required."
            },
            end_datetime: {
              type: "STRING",
              description: "End date and time in ISO 8601 UTC format (MUST end with 'Z'). Optional. Example: '2026-02-15T16:00:00Z'."
            },
            recurrence_type: {
              type: "STRING",
              description: "Recurrence pattern: 'weekly' or 'monthly'. Optional."
            },
            recurrence_end_date: {
              type: "STRING",
              description: "Date when recurrence stops in ISO 8601 UTC format (MUST end with 'Z'). Optional."
            }
          },
          required: ["title", "start_datetime"]
        }
      }
    },
    required: ["events"]
  }
};

async function executeCreateEvent(args: any): Promise<any> {
  try {
    const userId = getUserId();

    if (!args.events || !Array.isArray(args.events)) {
      return { error: 'Missing required field: events array' };
    }

    const createdEvents = [];
    const errors = [];

    for (let i = 0; i < args.events.length; i++) {
      const eventData = args.events[i];
      try {
        const id = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}_${i}`;

        if (!eventData.title || !eventData.start_datetime) {
          errors.push({ index: i, error: 'Missing required fields: title and start_datetime' });
          continue;
        }

        const event = await createEvent(
          userId,
          id,
          eventData.title,
          eventData.description || '',
          eventData.location || '',
          eventData.start_datetime,
          eventData.end_datetime || null,
          eventData.recurrence_type || null,
          eventData.recurrence_end_date || null
        );

        createdEvents.push(event);
      } catch (error: any) {
        errors.push({ index: i, title: eventData.title, error: error.message });
      }
    }

    const enrichedEvents = await enrichEventsForAI(createdEvents, userId);
    return {
      success: errors.length === 0,
      events: enrichedEvents,
      count: enrichedEvents.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Created ${enrichedEvents.length} event(s)${errors.length > 0 ? ` with ${errors.length} error(s)` : ''}`
    };
  } catch (error: any) {
    console.error('[EVENT TOOLS ERROR] create_event failed:', error.message);
    console.error('[EVENT TOOLS ERROR] Args:', JSON.stringify(args));
    console.error('[EVENT TOOLS ERROR] Stack:', error.stack);
    return { error: `Failed to create event: ${error.message}` };
  }
}

const updateEventDefinition: ToolDefinition = {
  name: "update_event",
  shortDescription: "Update events. Provide an array of event objects with event_id, title, and start_datetime (UTC ISO 8601 with Z).",
  description: "Update one or multiple existing events. This requires user confirmation. Users can only update their own events, not events created by other family members. TIMEZONE HANDLING: ALWAYS store times in UTC (ISO 8601 with 'Z' suffix). When user provides time without timezone, interpret it in their current location's timezone and convert to UTC. When displaying times back to user, convert from UTC to their local timezone. RECURRENCE: Supports weekly and monthly recurring events.",
  parameters: {
    type: "OBJECT",
    properties: {
      events: {
        type: "ARRAY",
        description: "Array of event updates to perform.",
        items: {
          type: "OBJECT",
          properties: {
            event_id: {
              type: "STRING",
              description: "The ID of the event to update (required)"
            },
            title: {
              type: "STRING",
              description: "Event title (required)"
            },
            description: {
              type: "STRING",
              description: "Event description (optional)"
            },
            location: {
              type: "STRING",
              description: "Event location (optional)"
            },
            start_datetime: {
              type: "STRING",
              description: "Start date and time in ISO 8601 UTC format (MUST end with 'Z'). Required."
            },
            end_datetime: {
              type: "STRING",
              description: "End date and time in ISO 8601 UTC format (MUST end with 'Z'). Optional."
            },
            recurrence_type: {
              type: "STRING",
              description: "Recurrence pattern: 'weekly' or 'monthly'. Optional."
            },
            recurrence_end_date: {
              type: "STRING",
              description: "Date when recurrence stops in ISO 8601 UTC format (MUST end with 'Z'). Optional."
            }
          },
          required: ["event_id", "title", "start_datetime"]
        }
      }
    },
    required: ["events"]
  }
};

async function executeUpdateEvent(args: any): Promise<any> {
  try {
    const userId = getUserId();

    if (!args.events || !Array.isArray(args.events)) {
      return { error: 'Missing required field: events array' };
    }

    const updatedEvents = [];
    const errors = [];

    for (let i = 0; i < args.events.length; i++) {
      const eventData = args.events[i];
      try {
        if (!eventData.event_id || !eventData.title || !eventData.start_datetime) {
          errors.push({ index: i, error: 'Missing required fields: event_id, title, and start_datetime' });
          continue;
        }

        // Check if event exists
        const existingEvent = await getEvent(userId, eventData.event_id);
        if (!existingEvent) {
          errors.push({ index: i, event_id: eventData.event_id, error: 'Event not found' });
          continue;
        }

        // Check ownership
        if (existingEvent.user_id !== userId) {
          const creator = await getUserById(existingEvent.user_id);
          const creatorName = creator ? creator.email.split('@')[0] : 'another user';
          errors.push({ index: i, event_id: eventData.event_id, error: `This event was created by ${creatorName}. You can only update your own events.` });
          continue;
        }

        await updateEvent(
          userId,
          eventData.event_id,
          eventData.title,
          eventData.description || '',
          eventData.location || '',
          eventData.start_datetime,
          eventData.end_datetime || null,
          eventData.recurrence_type || null,
          eventData.recurrence_end_date || null
        );

        const updatedEvent = await getEvent(userId, eventData.event_id);
        if (updatedEvent) {
          updatedEvents.push(updatedEvent);
        }
      } catch (error: any) {
        errors.push({ index: i, event_id: eventData.event_id, error: error.message });
      }
    }

    const enrichedEvents = await enrichEventsForAI(updatedEvents, userId);
    return {
      success: errors.length === 0,
      events: enrichedEvents,
      count: enrichedEvents.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Updated ${enrichedEvents.length} event(s)${errors.length > 0 ? ` with ${errors.length} error(s)` : ''}`
    };
  } catch (error: any) {
    console.error('[EVENT TOOLS ERROR] update_event failed:', error.message);
    console.error('[EVENT TOOLS ERROR] Args:', JSON.stringify(args));
    console.error('[EVENT TOOLS ERROR] Stack:', error.stack);
    return { error: `Failed to update event: ${error.message}` };
  }
}

const deleteEventDefinition: ToolDefinition = {
  name: "delete_event",
  shortDescription: "Delete events by ID. Provide an array of event_ids.",
  description: "Delete one or multiple events. This requires user confirmation. Users can only delete their own events, not events created by other family members. Use this when the user wants to remove event(s).",
  parameters: {
    type: "OBJECT",
    properties: {
      event_ids: {
        type: "ARRAY",
        description: "Array of event IDs to delete.",
        items: {
          type: "STRING",
          description: "Event ID to delete"
        }
      }
    },
    required: ["event_ids"]
  }
};

async function executeDeleteEvent(args: any): Promise<any> {
  try {
    const userId = getUserId();

    if (!args.event_ids || !Array.isArray(args.event_ids)) {
      return { error: 'Missing required field: event_ids array' };
    }

    const deletedEvents = [];
    const errors = [];

    for (let i = 0; i < args.event_ids.length; i++) {
      const eventId = args.event_ids[i];
      try {
        // Check if event exists
        const existingEvent = await getEvent(userId, eventId);
        if (!existingEvent) {
          errors.push({ index: i, event_id: eventId, error: 'Event not found' });
          continue;
        }

        // Check ownership
        if (existingEvent.user_id !== userId) {
          const creator = await getUserById(existingEvent.user_id);
          const creatorName = creator ? creator.email.split('@')[0] : 'another user';
          errors.push({ index: i, event_id: eventId, error: `This event was created by ${creatorName}. You can only delete your own events.` });
          continue;
        }

        await deleteEvent(userId, eventId);
        deletedEvents.push({ id: eventId, title: existingEvent.title });
      } catch (error: any) {
        errors.push({ index: i, event_id: eventId, error: error.message });
      }
    }

    return {
      success: errors.length === 0,
      deleted: deletedEvents,
      count: deletedEvents.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Deleted ${deletedEvents.length} event(s)${errors.length > 0 ? ` with ${errors.length} error(s)` : ''}`
    };
  } catch (error: any) {
    console.error('[EVENT TOOLS ERROR] delete_event failed:', error.message);
    console.error('[EVENT TOOLS ERROR] Args:', JSON.stringify(args));
    console.error('[EVENT TOOLS ERROR] Stack:', error.stack);
    return { error: `Failed to delete event: ${error.message}` };
  }
}

/**
 * All event tools
 */
export const eventTools: Tool[] = [
  // Lookup tools (can be called automatically)
  { definition: searchEventsDefinition, execute: executeSearchEvents },
  { definition: getEventsByDateRangeDefinition, execute: executeGetEventsByDateRange },
  { definition: getUpcomingEventsDefinition, execute: executeGetUpcomingEvents },
  { definition: getPastEventsDefinition, execute: executeGetPastEvents },
  { definition: getEventDefinition, execute: executeGetEvent },

  // CRUD tools (require user confirmation)
  { definition: createEventDefinition, execute: executeCreateEvent },
  { definition: updateEventDefinition, execute: executeUpdateEvent },
  { definition: deleteEventDefinition, execute: executeDeleteEvent },
];

/**
 * Get all event tool definitions
 */
export const eventToolDefinitions: ToolDefinition[] = eventTools.map(t => t.definition);

/**
 * Execute an event tool by name
 */
export async function executeEventTool(name: string, args: any): Promise<any> {
  const tool = eventTools.find(t => t.definition.name === name);
  if (!tool) {
    throw new Error(`Unknown event tool: ${name}`);
  }
  return tool.execute(args);
}

/**
 * Get upcoming events for system context injection
 * This function formats upcoming events into a string that can be injected into the system prompt
 */
export async function getUpcomingEventsContext(userId: string, limit: number = 5): Promise<string> {
  try {
    const rawEvents = await getUpcomingEvents(userId, limit);

    if (rawEvents.length === 0) {
      return "No upcoming events scheduled.";
    }

    const enrichedEvents = await enrichEventsForAI(rawEvents, userId);

    // Sort events by start_datetime to ensure chronological order
    const sortedEvents = [...enrichedEvents].sort((a, b) =>
      new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime()
    );

    const eventLines = sortedEvents.map(event => {
      // Pass the UTC datetime directly - let the AI handle timezone conversion based on user's location
      const parts = [
        `- ${event.title} (by ${event.created_by})`,
        `  Start: ${event.start_datetime}`, // ISO 8601 UTC format
      ];

      if (event.end_datetime) {
        parts.push(`  End: ${event.end_datetime}`); // ISO 8601 UTC format
      }

      if (event.location) {
        parts.push(`  Location: ${event.location}`);
      }

      if (event.description) {
        parts.push(`  Description: ${event.description}`);
      }

      if (event.recurrence_type) {
        let recurrenceInfo = `  Recurrence: ${event.recurrence_type}`;
        if (event.recurrence_end_date) {
          recurrenceInfo += ` until ${event.recurrence_end_date}`;
        }
        parts.push(recurrenceInfo);
      }

      // Do not include event ID - only show to user if they specifically request it

      return parts.join('\n');
    });

    return `Upcoming Events (Next ${sortedEvents.length}):\n\n${eventLines.join('\n\n')}`;
  } catch (error: any) {
    console.error('Failed to get upcoming events for context:', error);
    return "Failed to load upcoming events.";
  }
}

/**
 * @deprecated Use AsyncLocalStorage context instead via runWithToolContext in context.ts
 * Set the current user ID for the events tools
 * This should be called at the start of each request/session
 */
export function setEventToolsUserId(userId: string): void {
  console.warn('[EVENT TOOLS] setEventToolsUserId is deprecated. Use runWithToolContext instead.');
  (globalThis as any).__currentUserId = userId;
}

/**
 * @deprecated Use AsyncLocalStorage context instead via runWithToolContext in context.ts
 * Clear the current user ID
 * This should be called at the end of each request/session
 */
export function clearEventToolsUserId(): void {
  console.warn('[EVENT TOOLS] clearEventToolsUserId is deprecated. Use runWithToolContext instead.');
  delete (globalThis as any).__currentUserId;
}
