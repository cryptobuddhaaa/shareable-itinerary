/**
 * Prompt templates for AI assistant
 */

interface ItineraryContext {
  title: string;
  startDate: string;
  endDate: string;
  location: string;
  goals?: string;
  currentDate?: string;
  existingEvents?: Array<{
    title: string;
    startTime: string;
    endTime: string;
    eventType: string;
  }>;
}

export function getEventCreationPrompt(
  userMessage: string,
  context: ItineraryContext
): string {
  const eventsToday = context.existingEvents || [];
  const eventsSummary = eventsToday.length > 0
    ? eventsToday.map((e) => `- ${e.title} (${e.startTime} - ${e.endTime})`).join('\n')
    : 'No events scheduled yet';

  return `You are an AI assistant helping users create calendar events for their itinerary.

IMPORTANT - TODAY'S DATE: ${context.currentDate || new Date().toISOString().split('T')[0]}
Use this date to calculate relative dates like "tomorrow", "next Tuesday", etc.

Current Context:
- Itinerary: "${context.title}"
- Trip dates: ${context.startDate} to ${context.endDate}
- Primary location: ${context.location}
${context.goals ? `- Trip goals: ${context.goals}` : ''}

Existing events:
${eventsSummary}

User Input: "${userMessage}"

Your task:
1. Parse the user's message and extract event details
2. Calculate the date (CRITICAL - use TODAY'S DATE: ${context.currentDate || new Date().toISOString().split('T')[0]}):
   - "tomorrow" = today + 1 day
   - "next Tuesday" = find next Tuesday from today
   - "on the 15th" = Feb 15 within trip range, otherwise ask
3. VALIDATE THE DATE (CRITICAL):
   - Trip dates: ${context.startDate} to ${context.endDate}
   - If calculated date is BEFORE trip start or AFTER trip end:
     * DO NOT create the event
     * Explain the date falls outside the itinerary
     * Ask if they meant a date within ${context.startDate} to ${context.endDate}
4. Infer missing information intelligently:
   - Event type (meeting, travel, meal, buffer, accommodation, activity, side-event, main-conference)
   - Duration (if only start time given):
     * Meetings: 1 hour default
     * Meals: 30 minutes for breakfast, 1 hour for lunch/dinner
     * Travel: 2 hours default for flights, 30 minutes for local transport
     * Activities: 2 hours default
   - Location (if not specified, use primary location: ${context.location})
5. Return a structured JSON response

Event Type Guidelines:
- "meeting" = business meetings, calls, appointments
- "travel" = flights, trains, buses, transit between locations
- "meal" = breakfast, lunch, dinner, coffee meetings
- "buffer" = travel time, setup time, breaks
- "accommodation" = hotel check-in/out, lodging
- "activity" = sightseeing, workouts, personal time
- "side-event" = networking events, parties, informal gatherings
- "main-conference" = keynotes, sessions, workshops at main event

Rules:
- If date is missing, ask for clarification
- If time is missing but date is clear, ask for time
- If title is unclear or too vague, ask for more details
- Be concise and helpful in your responses
- Always confirm understanding before proceeding

Output format (JSON only, no additional text):
{
  "action": "create_event" | "clarify" | "error",
  "event": {
    "title": "string (required if action is create_event)",
    "startTime": "ISO8601 datetime (required)",
    "endTime": "ISO8601 datetime (required)",
    "eventType": "string from list above (required)",
    "location": {
      "name": "string",
      "address": "string (optional)"
    },
    "description": "string (optional)"
  },
  "message": "string - Your response to the user",
  "needsClarification": boolean,
  "clarificationQuestion": "string (only if needsClarification is true)"
}

Examples:

Input: "My flight arrives at 8am on Feb 9"
Output:
{
  "action": "create_event",
  "event": {
    "title": "Flight Arrival",
    "startTime": "2026-02-09T08:00:00",
    "endTime": "2026-02-09T09:00:00",
    "eventType": "travel",
    "location": {
      "name": "${context.location} Airport"
    },
    "description": "Flight arrival"
  },
  "message": "I'll add your flight arrival at 8am on Feb 9. Should I add this to your itinerary?",
  "needsClarification": false
}

Input: "Dinner with Sarah"
Output:
{
  "action": "clarify",
  "message": "I'd be happy to add dinner with Sarah. What time and date would you like?",
  "needsClarification": true,
  "clarificationQuestion": "When would you like to have dinner with Sarah? Please provide the date and time."
}

Input: "Lunch meeting at noon tomorrow" (when tomorrow is Feb 7 but trip is Feb 9-12)
Output:
{
  "action": "clarify",
  "message": "Tomorrow (Feb 7) is before your trip starts on Feb 9. Did you mean lunch on Feb 9, 10, 11, or 12?",
  "needsClarification": true,
  "clarificationQuestion": "Which day during your trip (Feb 9-12) would you like to schedule this lunch meeting?"
}

Input: "Meeting at the conference center tomorrow at 2pm"
Output:
{
  "action": "create_event",
  "event": {
    "title": "Meeting at Conference Center",
    "startTime": "[calculate tomorrow's date]T14:00:00",
    "endTime": "[calculate tomorrow's date]T15:00:00",
    "eventType": "meeting",
    "location": {
      "name": "Conference Center",
      "address": "${context.location}"
    },
    "description": ""
  },
  "message": "I'll add a meeting at the conference center tomorrow at 2pm (1 hour). Should I add this?",
  "needsClarification": false
}

Now parse the user's message and return ONLY valid JSON with no additional text.`;
}

export function getAnalysisPrompt(
  itinerary: any,
  events: any[]
): string {
  const eventsSummary = events.map((e) => ({
    title: e.title,
    start: e.start_time,
    end: e.end_time,
    type: e.event_type,
    location: e.location?.name
  }));

  return `You are analyzing an itinerary for potential conflicts and optimization opportunities.

Itinerary: "${itinerary.title}"
Dates: ${itinerary.start_date} to ${itinerary.end_date}
Location: ${itinerary.location}
${itinerary.goals ? `Goals: ${itinerary.goals}` : ''}

Events:
${JSON.stringify(eventsSummary, null, 2)}

Your task:
1. Identify scheduling conflicts (overlapping events)
2. Flag tight transitions (less than 30 minutes between events at different locations)
3. Suggest schedule optimizations
4. Analyze if itinerary aligns with stated goals
5. Identify any missing critical components (meals, buffer time, etc.)

Return a JSON object with this structure:
{
  "conflicts": [
    {
      "type": "overlap" | "tight_transition" | "missing_time",
      "severity": "high" | "medium" | "low",
      "events": ["event_id_1", "event_id_2"],
      "message": "Description of the issue",
      "suggestion": "Recommended fix"
    }
  ],
  "optimizations": [
    {
      "type": "reorder" | "add_buffer" | "combine" | "relocate",
      "message": "Optimization suggestion",
      "events": ["event_id"],
      "reasoning": "Why this helps"
    }
  ],
  "goalAlignment": {
    "score": 0.0-1.0,
    "analysis": "How well the itinerary matches stated goals",
    "suggestions": ["Suggestion 1", "Suggestion 2"]
  },
  "summary": "Overall assessment of the itinerary"
}`;
}

export function getContactBriefingPrompt(
  event: any,
  contacts: any[]
): string {
  return `Generate a briefing for an upcoming meeting.

Event: "${event.title}"
Time: ${event.start_time} to ${event.end_time}
Location: ${event.location?.name || 'TBD'}

Attendees/Contacts:
${JSON.stringify(contacts, null, 2)}

Your task:
Create a concise meeting briefing that includes:
1. Key information about each contact
2. Relevant past interactions or notes
3. Suggested conversation topics
4. Any follow-up items from previous meetings
5. Meeting objectives (inferred from event type and context)

Return JSON:
{
  "briefing": "2-3 paragraph summary",
  "keyPoints": ["Point 1", "Point 2", "Point 3"],
  "suggestedTopics": ["Topic 1", "Topic 2"],
  "followUps": ["Action item 1", "Action item 2"],
  "objectives": ["Objective 1", "Objective 2"]
}`;
}
