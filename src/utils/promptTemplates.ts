/**
 * Prompt templates for AI assistant
 */

import type { Itinerary, ItineraryEvent, Contact } from '../models/types';

export interface ItineraryContext {
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
    date?: string;
    location?: {
      name: string;
      address: string;
    };
  }>;
  contacts?: Array<{
    firstName: string;
    lastName: string;
    projectCompany?: string;
    position?: string;
    eventTitle?: string;
    dateMet?: string;
    notes?: string;
  }>;
}

export function getEventCreationPrompt(
  userMessage: string,
  context: ItineraryContext
): string {
  const allEvents = context.existingEvents || [];
  const eventsSummary = allEvents.length > 0
    ? allEvents.map((e) => {
        const startTime = e.startTime ? new Date(e.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : 'TBD';
        const endTime = e.endTime ? new Date(e.endTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : 'TBD';
        const date = e.date || (e.startTime ? new Date(e.startTime).toISOString().split('T')[0] : 'TBD');
        const location = e.location ? ` at ${e.location.name}${e.location.address ? ` (${e.location.address})` : ''}` : '';
        return `- ${date}: ${e.title} (${startTime} - ${endTime})${location}`;
      }).join('\n')
    : 'No events scheduled yet';

  const allContacts = context.contacts || [];
  const contactsSummary = allContacts.length > 0
    ? allContacts.map((c) => {
        const date = c.dateMet ? new Date(c.dateMet).toISOString().split('T')[0] : 'Unknown date';
        const company = c.projectCompany ? ` (${c.projectCompany})` : '';
        const position = c.position ? ` - ${c.position}` : '';
        const event = c.eventTitle ? ` - Met at "${c.eventTitle}"` : '';
        return `- ${c.firstName} ${c.lastName}${company}${position}${event} on ${date}`;
      }).join('\n')
    : 'No contacts added yet';

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

Contacts you've met:
${contactsSummary}

User Input: "${userMessage}"

DETERMINE USER INTENT FIRST:
Is the user asking to:
A) VIEW/READ their schedule? (e.g., "what's on my schedule", "show me Feb 9", "what do I have")
B) SEARCH CONTACTS? (e.g., "who did I meet on Feb 9", "show me contacts from networking event", "list people I met")
C) CALCULATE TRANSIT/LOGISTICS? (e.g., "how long between events", "do I have enough time", "tight transitions")
D) DELETE an event? (e.g., "delete the lunch meeting", "remove the padel event", "cancel my 2pm meeting")
E) CREATE a new event? (e.g., "add lunch at noon", "schedule meeting")

If A (VIEW): Filter events by the requested date and return a summary. DO NOT create or delete an event.
If B (SEARCH CONTACTS): Filter contacts by the requested criteria and return results. DO NOT create or delete an event.
If C (CALCULATE TRANSIT): Analyze event locations and timing to provide transit estimates. DO NOT create or delete an event.
If D (DELETE): Identify the event to delete and return delete_event action. DO NOT create an event.
If E (CREATE): Follow the creation steps below.

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
1. Parse which date they're asking about (e.g., "Feb 9" = "2026-02-09", "tomorrow", "the 10th")
2. Look at the events list above - each event shows its date (e.g., "2026-02-09: Flight Arrival")
3. Filter to ONLY events matching that date (ignore events with different dates)
4. Return this format:
{
  "action": "clarify",
  "message": "Here's your schedule for [date]:\n\n[List only events for that date with times]",
  "needsClarification": false
}
5. CRITICAL: DO NOT return all events - ONLY events matching the requested date

Example for "what's on my schedule for Feb 9":
Look for events with date "2026-02-09", then return:
{
  "action": "clarify",
  "message": "Here's your schedule for February 9, 2026:\n\n• 8:00 AM - 10:00 AM: Flight Arrival\n• 12:00 PM - 1:00 PM: Lunch Meeting\n\nYou have 2 events scheduled.",
  "needsClarification": false
}

FOR SEARCHING CONTACTS (when user asks about people they've met):
1. Parse the search criteria:
   - By date: "who did I meet on Feb 9" → Filter contacts where dateMet = "2026-02-09"
   - By event: "contacts from networking event" → Filter contacts where eventTitle contains "networking"
   - By company: "people from TechCorp" → Filter contacts where projectCompany contains "TechCorp"
   - All contacts: "show all contacts" or "list everyone I met" → Return all contacts
2. Look at the contacts list above and filter based on criteria
3. Return this format:
{
  "action": "clarify",
  "message": "[Summary of search results with relevant details]",
  "needsClarification": false
}
4. Include: name, company, position, event where met, date met, and any notes

Example for "who did I meet on Feb 9":
{
  "action": "clarify",
  "message": "On February 9, 2026, you met:\n\n• John Smith (TechCorp) - CEO - Met at \"Networking Reception\"\n• Sarah Jones (StartupXYZ) - CTO - Met at \"Conference Keynote\"\n\nYou have 2 contacts from that day.",
  "needsClarification": false
}

Example for "show me contacts from networking event":
{
  "action": "clarify",
  "message": "Contacts from networking events:\n\n• John Smith (TechCorp) - CEO - Met at \"Networking Reception\" on Feb 9\n• Mike Chen - Product Manager - Met at \"Evening Networking\" on Feb 10\n\nYou have 2 contacts from networking events.",
  "needsClarification": false
}

FOR CALCULATING TRANSIT TIMES (when user asks about travel/logistics between events):
1. Look at events and their locations from the list above
2. Consider the context:
   - Primary location: ${context.location}
   - Event locations (if specified)
   - Time between events (calculate gap)
   - Event types (travel, meeting, meal, etc.)
3. Estimate transit times based on:
   - Walking: ~3-4 mph (20 min/mile), good for <1 mile
   - Driving in city: ~15-25 mph with traffic, good for 1-10 miles
   - Public transit: ~10-20 mph including stops/transfers
   - Taxi/rideshare: Similar to driving
   - Same building/venue: 5-10 minutes
4. Identify potential issues:
   - Tight transitions (<30 min between different locations)
   - Cross-city travel during rush hour
   - Insufficient buffer for transit mode
5. Return this format:
{
  "action": "clarify",
  "message": "[Analysis of transit times and recommendations]",
  "needsClarification": false
}

Example for "how long between my lunch and next meeting on Feb 9":
Look for lunch event and next event after it on Feb 9, check locations, calculate gap:
{
  "action": "clarify",
  "message": "On February 9:\n\n• Lunch: 12:00 PM - 1:00 PM at Restaurant A (123 Main St)\n• Next Meeting: 2:00 PM - 3:00 PM at Office B (456 Oak Ave)\n\nYou have 1 hour between events. Transit estimate:\n• Distance: ~2 miles between locations\n• By taxi/rideshare: 10-15 minutes with traffic\n• By public transit: 25-30 minutes\n• Walking: Not recommended (40+ minutes)\n\n✅ You have sufficient buffer time. I recommend a taxi to ensure you arrive 10-15 minutes early.",
  "needsClarification": false
}

Example for "show me any tight transitions tomorrow":
{
  "action": "clarify",
  "message": "Checking your schedule for February 10...\n\n⚠️ Found 1 tight transition:\n\n• 10:30 AM: Coffee Meeting ends at Café C (downtown)\n• 11:00 AM: Client Meeting starts at Office Tower D (uptown)\n• Gap: 30 minutes\n• Estimated transit: 20-25 minutes by taxi\n\nRecommendation: This is cutting it close. Consider leaving the coffee meeting 5-10 minutes early, or push the client meeting to 11:15 AM if possible.",
  "needsClarification": false
}

Example for "do I have enough time to get from the airport to the hotel":
{
  "action": "clarify",
  "message": "Let me check your travel plans...\n\n• Flight arrival: 8:00 AM (assumed 30 min to exit airport = 8:30 AM)\n• Hotel check-in: Not scheduled yet\n• Location: ${context.location}\n\nTypical airport to city center transit:\n• Taxi/rideshare: 30-45 minutes depending on traffic\n• Airport shuttle: 45-60 minutes with stops\n• Public transit: 45-60 minutes\n\nYou should arrive at your hotel around 9:15-9:30 AM. Would you like me to add a hotel check-in event to your schedule?",
  "needsClarification": false
}

FOR DELETING EVENTS (when user asks to delete/remove/cancel an event):
1. Parse which event they want to delete:
   - By name: "delete the padel showdown" → Find event with title matching "padel showdown"
   - By time: "cancel my 2pm meeting" → Find event at 2pm
   - By type: "remove the lunch meeting" → Find event of type "meal" with "lunch" in title
   - If multiple matches, ask for clarification
2. Look at the events list above and find the matching event
3. IMPORTANT: Check if there are contacts associated with this event
   - Look at the contacts list to see if any have eventTitle matching this event's title
   - If contacts exist, warn the user that contacts will also be deleted
4. Return this format:
{
  "action": "delete_event",
  "eventTitle": "Exact title of event to delete",
  "eventDate": "Date of the event (YYYY-MM-DD)",
  "eventTime": "Start time for confirmation",
  "hasContacts": true/false,
  "contactCount": number,
  "message": "Confirmation message to user",
  "needsClarification": false
}

Example for "delete the padel showdown":
Find event with "padel" in title, check for contacts:
{
  "action": "delete_event",
  "eventTitle": "Stablecoin Padel Showdown @ Consensus HK",
  "eventDate": "2026-02-09",
  "eventTime": "5:00 PM",
  "hasContacts": true,
  "contactCount": 1,
  "message": "I'll delete 'Stablecoin Padel Showdown @ Consensus HK' on February 9 (5:00 PM - 8:00 PM).\n\n⚠️ Warning: This event has 1 contact associated with it (Ali Zain from Nexus). The contact will also be deleted.\n\nShould I proceed?",
  "needsClarification": false
}

Example for "cancel my 2pm meeting" (when multiple 2pm meetings exist):
{
  "action": "clarify",
  "message": "I found multiple events at 2:00 PM:\n\n• February 9: Client Meeting at Office A\n• February 10: Strategy Session at Conference Room B\n\nWhich one would you like to cancel?",
  "needsClarification": true,
  "clarificationQuestion": "Please specify the date or provide more details about which 2pm meeting to cancel."
}

Example for "remove the dinner" (when event found, no contacts):
{
  "action": "delete_event",
  "eventTitle": "Dinner with Team",
  "eventDate": "2026-02-10",
  "eventTime": "7:00 PM",
  "hasContacts": false,
  "contactCount": 0,
  "message": "I'll delete 'Dinner with Team' on February 10 (7:00 PM - 9:00 PM). Should I proceed?",
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

FOR CREATE_EVENT:
{
  "action": "create_event",
  "event": {
    "title": "string (required)",
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

FOR DELETE_EVENT:
{
  "action": "delete_event",
  "eventTitle": "string - Exact title of event to delete (required)",
  "eventDate": "string - Date in YYYY-MM-DD format (optional but helpful)",
  "eventTime": "string - Start time for user confirmation (optional)",
  "hasContacts": boolean - Whether event has associated contacts,
  "contactCount": number - Number of contacts that will be deleted,
  "message": "string - Confirmation message with warning if contacts exist",
  "needsClarification": boolean
}

FOR CLARIFY OR ERROR:
{
  "action": "clarify" | "error",
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
  itinerary: Itinerary,
  events: ItineraryEvent[]
): string {
  const eventsSummary = events.map((e) => ({
    title: e.title,
    start: e.startTime,
    end: e.endTime,
    type: e.eventType,
    location: e.location?.name
  }));

  return `You are analyzing an itinerary for potential conflicts and optimization opportunities.

Itinerary: "${itinerary.title}"
Dates: ${itinerary.startDate} to ${itinerary.endDate}
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
  event: ItineraryEvent,
  contacts: Contact[]
): string {
  return `Generate a briefing for an upcoming meeting.

Event: "${event.title}"
Time: ${event.startTime} to ${event.endTime}
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
