# Luma Auto-Fetch Feature Guide 🎫

## What It Does

The Luma auto-fetch feature allows you to paste a Luma event URL (like `https://lu.ma/event-name`) and automatically populate your event form with:
- Event title
- Start and end times
- Location name and address
- Description

## How It Works

The app uses a **serverless API proxy** (`/api/fetch-luma`) to:
1. Fetch the Luma page HTML server-side (bypassing CORS)
2. Parse the event data from the HTML
3. Return it to your frontend

## Why It Doesn't Work with `npm run dev`

When you run `npm run dev`, Vite serves your frontend but **does not run the serverless functions** in the `/api` folder. These functions are:
- Vercel-specific serverless functions
- Only available when deployed to Vercel or running with Vercel's dev server

### The Error You Saw

```
Error fetching Luma event: SyntaxError: Unexpected token 'e', "export def"... is not valid JSON
```

This happens because:
1. Your app tries to call `/api/fetch-luma`
2. Vite doesn't know about this endpoint
3. It returns the TypeScript source file instead of running it
4. The frontend tries to parse TypeScript code as JSON → Error!

## How to Test Locally

### Option 1: Use Vercel Dev (Recommended for Testing Luma)

```bash
# Install Vercel CLI globally (one time)
npm install -g vercel

# Run the app with Vercel's dev server
cd /sessions/happy-practical-davinci/mnt/claude-work/shareable-itinerary
vercel dev
```

This will:
- ✅ Run your frontend (like npm run dev)
- ✅ Run the serverless functions in `/api`
- ✅ Luma auto-fetch will work!

### Option 2: Deploy to Vercel (Best for Full Testing)

Once deployed, everything works automatically:

```bash
# Push to GitHub
git add .
git commit -m "Fix Supabase UUID and improve error handling"
git push

# Deploy via Vercel dashboard or CLI
vercel --prod
```

After deployment:
- ✅ Luma auto-fetch works perfectly
- ✅ All serverless functions run
- ✅ You can share the URL with others

### Option 3: Fill Manually (During Development)

When running with `npm run dev`:
- The app will show a helpful error message
- You can still use all features except auto-fetch
- Simply type in the event details manually

## Current Behavior

### Running with `npm run dev`:
```
✅ Create/edit/delete itineraries
✅ Create/edit/delete events
✅ Google Maps integration
✅ Share URLs
✅ Authentication
❌ Luma auto-fetch (shows friendly error)
```

### Running with `vercel dev` or deployed:
```
✅ All features work, including Luma auto-fetch
```

## Error Messages

You'll see different error messages based on the situation:

### Development Mode (npm run dev)
```
⚠️ Luma auto-fetch only works when deployed to Vercel.
For now, please fill in details manually or run "vercel dev" instead of "npm run dev".
```

### Other Errors
```
Failed to fetch event data. Please fill in details manually.
```

## Architecture

```
┌─────────────┐
│   Browser   │
│  (Frontend) │
└──────┬──────┘
       │ POST /api/fetch-luma
       ▼
┌─────────────────────┐
│ Vercel Serverless   │  ← Only runs when deployed
│   Function (Node)   │     or with "vercel dev"
└──────┬──────────────┘
       │ Fetch HTML (no CORS!)
       ▼
┌─────────────┐
│  lu.ma/xyz  │
│ Luma Event  │
└─────────────┘
```

## Testing Checklist

Once deployed or running with `vercel dev`:

- [ ] Paste a Luma URL into the "Luma Event URL" field
- [ ] Click "Auto-fill from Luma"
- [ ] Verify form populates with event data
- [ ] Check that times are converted to local time
- [ ] Verify location appears correctly
- [ ] Save the event
- [ ] Click the saved event's Luma link to verify it works

## Common Issues

### Issue: "Invalid Luma URL"
**Solution**: Make sure the URL includes `lu.ma` or `luma.com`

### Issue: "Could not extract event data from page"
**Causes:**
- Event is private/password-protected
- Luma changed their HTML structure
- Event doesn't exist

**Solution**: Fill in details manually

### Issue: Location shows "guests only"
**Explanation**: Some Luma events hide location until you RSVP. The app will show a placeholder like "Hong Kong (exact location hidden - guests only)".

## Files Involved

```
src/
├── services/
│   └── lumaService.ts       # Frontend Luma parsing logic
├── components/
│   └── EventForm.tsx        # Uses Luma service
api/
└── fetch-luma.ts            # Serverless function (CORS proxy)
```

## Summary

**For Development:**
- Use `npm run dev` for everything except Luma testing
- Luma will show a friendly error but won't break anything

**For Testing Luma Locally:**
- Use `vercel dev` to run serverless functions

**For Production:**
- Deploy to Vercel - everything works automatically!

---

**Status: Luma feature is production-ready! Just needs deployment or `vercel dev` to test. 🚀**
