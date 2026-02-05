# Supabase Setup Guide 🔐

This guide will help you set up Google authentication and database storage for your itinerary app.

## Step 1: Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up/login
2. Click "New Project"
3. Fill in:
   - **Project name**: `itinerary-app` (or your choice)
   - **Database password**: Generate a strong password (save it!)
   - **Region**: Choose closest to you
4. Click "Create new project" (takes ~2 minutes)

## Step 2: Set Up Database Schema

1. In your Supabase project, click **SQL Editor** in the left sidebar
2. Click "New Query"
3. Copy the contents of `supabase-setup-safe.sql` from your project folder and paste it, OR paste the SQL below:

**Note:** This SQL script is safe to run multiple times - it won't error if tables already exist!

```sql
-- Safe Supabase Database Setup
-- This script can be run multiple times without errors

-- Create itineraries table (only if it doesn't exist)
CREATE TABLE IF NOT EXISTS itineraries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  location TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE itineraries ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Users can view their own itineraries" ON itineraries;
DROP POLICY IF EXISTS "Users can create their own itineraries" ON itineraries;
DROP POLICY IF EXISTS "Users can update their own itineraries" ON itineraries;
DROP POLICY IF EXISTS "Users can delete their own itineraries" ON itineraries;

-- Create policies
CREATE POLICY "Users can view their own itineraries"
  ON itineraries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own itineraries"
  ON itineraries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own itineraries"
  ON itineraries FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own itineraries"
  ON itineraries FOR DELETE
  USING (auth.uid() = user_id);

-- Create indexes (only if they don't exist)
CREATE INDEX IF NOT EXISTS itineraries_user_id_idx ON itineraries(user_id);
CREATE INDEX IF NOT EXISTS itineraries_created_at_idx ON itineraries(created_at DESC);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS update_itineraries_updated_at ON itineraries;

-- Create trigger
CREATE TRIGGER update_itineraries_updated_at
  BEFORE UPDATE ON itineraries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

## Step 3: Set Up Google OAuth

1. In your Supabase project, click **Authentication** → **Providers**
2. Find **Google** and click to expand
3. Toggle **Enable Sign in with Google** to ON
4. You'll see two fields that need to be filled:
   - **Client ID** (from Google)
   - **Client Secret** (from Google)

### Get Google OAuth Credentials:

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing one
3. Go to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **OAuth client ID**
5. If prompted, configure the OAuth consent screen:
   - User Type: **External**
   - App name: `Itinerary App`
   - User support email: Your email
   - Developer contact: Your email
   - Click **Save and Continue** through the rest
6. Back to **Create OAuth client ID**:
   - Application type: **Web application**
   - Name: `Itinerary App`
   - **Authorized redirect URIs**: Add this URL from your Supabase:
     ```
     https://<your-project-ref>.supabase.co/auth/v1/callback
     ```
     (Get this exact URL from Supabase → Authentication → Providers → Google → "Callback URL")
7. Click **Create**
8. Copy the **Client ID** and **Client Secret**
9. Paste them into your Supabase Google provider settings
10. Click **Save**

## Step 4: Add Environment Variables to Your Project

Create a `.env` file in your project root:

```bash
cd /path/to/shareable-itinerary
```

Create `.env` file with:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

**To get these values:**
1. In Supabase, go to **Settings** (gear icon) → **API**
2. Copy:
   - **Project URL** → paste as `VITE_SUPABASE_URL`
   - **Project API keys** → **anon public** → paste as `VITE_SUPABASE_ANON_KEY`

## Step 5: Add Environment Variables to Vercel

1. Go to your Vercel dashboard
2. Select your `shareable-itinerary` project
3. Go to **Settings** → **Environment Variables**
4. Add these two variables:
   - `VITE_SUPABASE_URL` = `https://your-project-ref.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `your-anon-key`
5. Click **Save**

## Step 6: Update Vercel Redirect URIs

1. Go back to **Google Cloud Console** → **Credentials**
2. Click on your OAuth client ID
3. Add your Vercel deployment URL to **Authorized redirect URIs**:
   ```
   https://your-app.vercel.app/**
   ```
   Replace `your-app.vercel.app` with your actual Vercel URL
4. Also add the Supabase callback URL again if not there:
   ```
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```
5. Click **Save**

## Step 7: Test the Setup

After deploying (next step), you should be able to:
1. Click "Sign in with Google"
2. Authenticate with your Google account
3. Create itineraries (saved to Supabase database)
4. Share with friends who can sign in with their Google accounts
5. Each user only sees their own itineraries

## Security Features

✅ **Row Level Security (RLS)**: Users can only access their own data
✅ **Google OAuth**: Secure authentication
✅ **No passwords to manage**: Google handles authentication
✅ **Automatic user management**: Supabase handles user accounts

## Troubleshooting

**Issue**: "Invalid login credentials" after clicking Google sign-in
- **Fix**: Check that you added the correct redirect URI in Google Cloud Console

**Issue**: Can't see any itineraries after login
- **Fix**: Check that RLS policies are enabled (run the SQL script again)

**Issue**: Environment variables not working
- **Fix**: Make sure `.env` file is in the project root and restart dev server

---

## Next Steps

Once you've completed these steps:
1. Come back and I'll help you deploy the updated app
2. You can invite your friends to use the app with their Google accounts
3. Each user will have their own private itineraries

Let me know when you're ready or if you need help with any step!
