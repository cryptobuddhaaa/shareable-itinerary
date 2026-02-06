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

⚠️ CRITICAL RULES - READ FIRST:
1. TODAY'S DATE: ${context.currentDate || new Date().toISOString().split('T')[0]}
2. TRIP DATES: ${context.startDate} to ${context.endDate}
3. ONLY create events within trip dates. If date is outside this range, ASK for clarification.

Current Context:
- Itinerary: "${context.title}"
- Primary location: ${context.location}
${context.goals ? `- Trip goals: ${context.goals}` : ''}

Existing events:
${eventsSummary}

User Input: "${userMessage}"

DETERMINE USER INTENT FIRST:
Is the user asking to:
A) VIEW/READ their schedule? (e.g., "what's on my schedule", "show me Feb 9", "what do I have")
B) CREATE a new event? (e.g., "add lunch at noon", "schedule meeting")

If A (VIEW): Filter events by the requested date and return a summary. DO NOT create an event.
If B (CREATE): Follow the creation steps below.

STEP-BY-STEP PROCESS (for creating events):

STEP 1: Calculate the actual date
- If user says "tomorrow": Calculate ${context.currentDate} + 1 day
- If user says "next Tuesday": Find next Tuesday from ${context.currentDate}
- If user says "on the 15th": Use current month

STEP 2: CHECK DATE VALIDITY (MANDATORY - DO NOT SKIP)
- Is the calculated date >= ${context.startDate}? If NO → go to STEP 3
- Is the calculated date <= ${context.endDate}? If NO → go to STEP 3
- If BOTH are YES → continue to STEP 4

STEP 3: DATE IS OUTSIDE TRIP - ASK FOR CLARIFICATION
Return this format:
{
  "action": "clarify",
  "message": "The date [calculated date] is [before/after] your trip (${context.startDate} to ${context.endDate}). Which day during your trip would you like this event?",
  "needsClarification": true,
  "clarificationQuestion": "Please specify a date between ${context.startDate} and ${context.endDate}"
}
STOP HERE - do not proceed to STEP 4

STEP 4: Infer missing information (only if date is valid)
- Event type: meeting, travel, meal, buffer, accommodation, activity, side-event, main-conference
- Duration defaults:
  * Meetings: 1 hour
  * Meals: 30 min breakfast, 1 hour lunch/dinner
  * Travel: 2 hours flights, 30 min local
  * Activities: 2 hours
- Location: Use ${context.location} if not specified

STEP 5: Return structured JSON

FOR VIEWING SCHEDULE (when user asks to see their schedule):
1. Parse which date they're asking about (e.g., "Feb 9", "tomorrow", "the 10th")
2. Filter events to ONLY that specific date
3. Return this format:
{
  "action": "clarify",
  "message": "Here's your schedule for [date]:\n\n[List only events for that date with times]",
  "needsClarification": false
}
4. DO NOT return all events - only events for the requested date

Example for "what's on my schedule for Feb 9":
{
  "action": "clarify",
  "message": "Here's your schedule for February 9, 2026:\n\n• 8:00 AM - 10:00 AM: Flight Arrival\n• 12:00 PM - 1:00 PM: Lunch Meeting\n\nYou have 2 events scheduled.",
  "needsClarification": false
}

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
