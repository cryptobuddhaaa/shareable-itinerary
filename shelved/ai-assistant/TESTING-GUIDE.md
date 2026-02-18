# AI Assistant Testing Guide

## Prerequisites

### 1. Set Up Database Schema

Run the SQL schema in your Supabase SQL Editor:

```bash
# Copy the contents of supabase-premium-schema.sql
# Go to Supabase Dashboard → SQL Editor → New Query
# Paste and execute the entire file
```

This will create:
- `subscriptions` table
- `ai_usage` table
- `ai_conversations` table
- Helper functions for tier management
- Abuse detection function

### 2. Configure Environment Variables

```bash
# Copy the example file
cp .env.example .env

# Edit .env and add your Claude API key
# Get it from: https://console.anthropic.com/settings/keys
CLAUDE_API_KEY=sk-ant-your-actual-key-here
```

### 3. Start the Development Server

```bash
npm run dev
```

## Testing Scenarios

### Test 1: Basic AI Event Creation

1. **Create an itinerary** with dates (e.g., Feb 9-11, 2026)
2. **Click "✨ AI Assistant"** button in the header
3. **Try these commands**:
   ```
   "My flight arrives at 8am on Feb 9"
   "Lunch with John at noon on Feb 10"
   "Conference keynote from 10am to 11:30am on Feb 11"
   ```
4. **Verify**:
   - AI responds with event confirmation
   - Event details are correct (time, date, type)
   - Location is inferred from itinerary location
   - Confirmation card appears

### Test 2: Usage Limits (Free Tier)

1. **Send 3 AI queries** (you start with 3 free)
2. **Check the counter** in modal header decreases: 3 → 2 → 1 → 0
3. **Try 4th query** - should see paywall modal
4. **Verify paywall**:
   - Shows Premium ($7.77/month) and Pro ($18.88/month)
   - Displays current usage (3 of 3)
   - Has upgrade buttons

### Test 3: Event Confirmation Flow

1. **Send**: "Meeting at 2pm tomorrow"
2. **AI should ask for clarification** if date is ambiguous
3. **Provide more details**: "Meeting at 2pm on Feb 10"
4. **Verify confirmation card shows**:
   - Title
   - Start/end time
   - Event type
   - Location
5. **Click "Add Event"** - event appears in timeline
6. **Verify success message** in chat

### Test 4: Natural Language Parsing

Test various input formats:

```
"Flight at 8am"
"Dinner with Sarah tomorrow at 7pm"
"Conference from 9am to 5pm on Monday"
"Breakfast meeting next Tuesday at 8:30am"
"Workshop on the 15th from 2pm to 4pm"
```

Expected behavior:
- AI infers missing information (duration, event type)
- Handles relative dates ("tomorrow", "next Monday")
- Confirms before creating events

### Test 5: Error Handling

1. **Try vague input**: "Meeting"
   - Should ask for time/date
2. **Try invalid API key**: Remove CLAUDE_API_KEY
   - Should show error message
   - Usage not counted
3. **Try with no dates selected**: Create itinerary without dates
   - Should handle gracefully

## Database Verification

Check that usage is being tracked:

```sql
-- In Supabase SQL Editor
SELECT * FROM ai_usage ORDER BY created_at DESC LIMIT 10;

-- Check your subscription
SELECT * FROM subscriptions WHERE user_id = auth.uid();

-- Check usage this month
SELECT COUNT(*) as queries_used
FROM ai_usage
WHERE user_id = auth.uid()
  AND created_at >= date_trunc('month', CURRENT_TIMESTAMP);
```

## Known Issues & Limitations

### ⚠️ Security Warning
The Claude API key is currently exposed in the frontend code. This is **NOT production-ready** and is only for MVP testing. In production, you MUST:
- Create a serverless API endpoint
- Move API calls to backend
- Never expose API keys in frontend

### Current Limitations
- No voice input yet (Phase 2)
- No actual Stripe payments (shows alert placeholder)
- AI calls are made directly from browser (insecure)
- No rate limiting on API calls (abuse detection in DB only)

## Troubleshooting

### AI Assistant Button Not Showing
- Make sure you're logged in (button only shows for authenticated users)
- Check console for errors

### "API key not configured" Error
- Verify `.env` file exists with `CLAUDE_API_KEY`
- Restart dev server after adding env vars
- Check that key starts with `sk-ant-`

### Events Not Being Created
- Check browser console for errors
- Verify the event date falls within itinerary dates
- Check if `addEvent` function exists in `useItinerary` hook

### Usage Counter Not Decreasing
- Check Supabase `ai_usage` table
- Verify RLS policies allow INSERT
- Check browser console for tracking errors

### Paywall Not Showing
- Verify you've used all 3 free queries
- Check `subscriptions` table has your user with tier='free'
- Look for console errors

## Success Criteria

✅ AI Assistant modal opens and shows welcome message
✅ Natural language input creates accurate events
✅ Usage counter decreases after each query
✅ Paywall appears after 3 queries
✅ Events are added to correct dates in timeline
✅ Confirmation flow works smoothly
✅ Database tracks usage correctly

## Next Steps After Testing

Once testing is complete:
1. Create serverless API endpoint for secure Claude API calls
2. Integrate Stripe for actual payment processing
3. Add voice input (Whisper API)
4. Implement rate limiting middleware
5. Add more AI features (analysis, briefings)

## Feedback

Document any issues found during testing:
- What inputs caused confusion?
- What edge cases weren't handled?
- Any UI/UX improvements needed?
- Performance issues?
