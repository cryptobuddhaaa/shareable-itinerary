# 🔐 Authentication & Deployment Guide

Your itinerary app now has Google authentication! Follow these steps to deploy it.

## Overview

**What Changed:**
- ✅ Google OAuth login
- ✅ User-specific itineraries (stored in Supabase database)
- ✅ Each user has their own private itineraries
- ✅ Share the app with friends - they each get their own account

## Quick Start (5 Steps)

### 1. Set Up Supabase (~5 minutes)

Follow the detailed instructions in [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md) to:
1. Create a Supabase project
2. Set up the database schema
3. Configure Google OAuth
4. Get your API keys

### 2. Add Environment Variables Locally

Create a `.env` file in your project root:

```bash
cd /path/to/shareable-itinerary
nano .env  # or use your editor
```

Add these lines (get values from Supabase → Settings → API):

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

**Important**: Never commit `.env` to git! It's already in `.gitignore`.

### 3. Test Locally

```bash
npm install  # Install new dependencies (Supabase packages)
npm run dev  # Start dev server
```

Open http://localhost:5173 and you should see the login page!

- Click "Sign in with Google"
- Authenticate with your Google account
- Create a test itinerary
- Sign out and sign in again - your itinerary should still be there!

### 4. Deploy to Vercel

**Add Environment Variables to Vercel:**

1. Go to your [Vercel dashboard](https://vercel.com/dashboard)
2. Select your `shareable-itinerary` project
3. Go to **Settings** → **Environment Variables**
4. Add:
   - `VITE_SUPABASE_URL` = `https://your-project-ref.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `your-anon-key`
5. Click **Save**

**Deploy the Code:**

```bash
git add .
git commit -m "Add Google authentication and Supabase database"
git push origin main
```

Vercel will automatically deploy (~60 seconds).

### 5. Update Google OAuth Redirect URI

After Vercel deploys:

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Click on your OAuth client ID
3. Add your Vercel URL to **Authorized redirect URIs**:
   ```
   https://your-app.vercel.app/**
   ```
   (Replace `your-app.vercel.app` with your actual Vercel URL)
4. Click **Save**

**Done!** 🎉 Your app is now live with authentication.

## Testing the Deployed App

1. Go to your Vercel URL
2. Click "Sign in with Google"
3. Authenticate
4. Create an itinerary
5. Share the URL with a friend
6. They can sign in with their Google account
7. Each of you will see only your own itineraries!

## Sharing with Friends

Simply share your Vercel URL:
```
https://your-app.vercel.app
```

Each friend who visits will:
1. See the login page
2. Sign in with their Google account
3. Get their own private account
4. Create and manage their own itineraries

## Security Features

✅ **Row Level Security (RLS)**: Users can only access their own data
✅ **Google OAuth**: Secure authentication
✅ **No localStorage**: All data stored securely in Supabase
✅ **Automatic user management**: Supabase handles user accounts
✅ **Environment variables**: API keys are not exposed in code

## Troubleshooting

### "Invalid login credentials" after Google sign-in
- **Fix**: Check that you added both redirect URIs in Google Cloud Console:
  - `https://<your-project-ref>.supabase.co/auth/v1/callback`
  - `https://your-app.vercel.app/**`

### Login page shows but button doesn't work
- **Fix**: Check that environment variables are set correctly in Vercel
- Go to Vercel → Settings → Environment Variables
- Redeploy after adding variables

### Can't see any itineraries after login
- **Fix**: Check that you ran the SQL script in Supabase
- Go to Supabase → SQL Editor → Run the schema script from `SUPABASE_SETUP.md`

### Environment variables not working locally
- **Fix**: Make sure `.env` file is in the project root (not in `src/`)
- Restart dev server: `npm run dev`

### Old localStorage data still showing
- **Fix**: Clear browser localStorage:
  - Open DevTools (F12)
  - Application → Local Storage → Clear
  - Refresh page

## Architecture Changes

**Before (localStorage):**
```
Browser localStorage → itineraries (public, no auth)
```

**After (Supabase):**
```
User Authentication (Google OAuth)
      ↓
Supabase Database (PostgreSQL)
      ↓
Row Level Security (RLS)
      ↓
User-specific itineraries
```

## What Happens to Old Data?

Old itineraries stored in localStorage will NOT be automatically migrated. Users will start fresh with a new account.

If you want to migrate existing data:
1. Export from localStorage (DevTools → Application → Local Storage → Copy)
2. Sign in to the app
3. Manually recreate the itineraries

## File Changes Summary

**New Files:**
- `src/lib/supabase.ts` - Supabase client configuration
- `src/hooks/useAuth.tsx` - Authentication context/hook
- `src/components/Login.tsx` - Login page component
- `src/hooks/useItinerary.ts` - Updated to use Supabase (replaces localStorage version)
- `.env.example` - Template for environment variables
- `SUPABASE_SETUP.md` - Detailed Supabase setup guide
- `AUTH_DEPLOYMENT_GUIDE.md` - This file

**Modified Files:**
- `src/main.tsx` - Wrapped with AuthProvider
- `src/App.tsx` - Added authentication logic and user UI
- `.gitignore` - Added `.env` files
- `package.json` - Added Supabase dependencies

**Backup Files:**
- `src/hooks/useItinerary.localStorage.ts` - Original localStorage version (backup)

## Next Steps

After deploying:

1. **Test thoroughly** - Create, edit, delete itineraries
2. **Invite friends** - Share the URL and have them create accounts
3. **Monitor usage** - Check Supabase dashboard for user activity
4. **Set up billing alerts** - Supabase free tier is generous, but set alerts to be safe

## Need Help?

If you run into issues:
1. Check the troubleshooting section above
2. Review `SUPABASE_SETUP.md` for detailed setup steps
3. Check Supabase logs: Supabase Dashboard → Logs
4. Check Vercel logs: Vercel Dashboard → Deployments → View Function Logs

---

**Congratulations!** 🎉 Your app now has secure authentication and each user has their own private itineraries.
