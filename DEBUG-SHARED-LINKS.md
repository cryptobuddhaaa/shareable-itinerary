# Debug Checklist for Shared Links

## Quick Tests

### 1. Test in Browser Console
Open the share link in an incognito window, then open Console (F12) and run:

```javascript
// Check if the share ID is being detected
console.log(new URLSearchParams(window.location.search).get('share'));

// Check for any errors
console.log('Check console for errors');
```

### 2. Check Supabase Policies

The shared link needs to read from the `itineraries` table even though the viewer isn't logged in. Check if there's a policy allowing anonymous reads for shared itineraries.

Run this in Supabase SQL Editor:

```sql
-- Check existing policies on itineraries table
SELECT * FROM pg_policies WHERE tablename = 'itineraries';

-- Check if there's a policy for anonymous access to shared itineraries
```

### 3. Expected Issue: Missing RLS Policy

**Problem**: The `itineraries` table probably only allows users to see their own itineraries. When an anonymous user tries to view a shared link, they get blocked by RLS.

**Solution**: Add a policy that allows anyone to read itineraries that have been shared:

```sql
-- Allow anonymous users to read itineraries that have been shared
DROP POLICY IF EXISTS "Anyone can view shared itineraries" ON itineraries;
CREATE POLICY "Anyone can view shared itineraries"
  ON itineraries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM shared_itineraries
      WHERE shared_itineraries.itinerary_id = itineraries.id
    )
  );
```

### 4. Alternative: Simpler Policy

If the above doesn't work, try this simpler approach:

```sql
-- Allow anyone to read any itinerary (less restrictive)
DROP POLICY IF EXISTS "Public read access" ON itineraries;
CREATE POLICY "Public read access"
  ON itineraries
  FOR SELECT
  USING (true);
```

Note: This allows anyone to read all itineraries, not just shared ones. It's simpler but less secure. Only use this for testing, then switch to the more restrictive policy above.

## Common Errors and Solutions

### Error: "Failed to load shared itinerary"
- **Cause**: RLS policy blocking access
- **Fix**: Add the policy above

### Error: "Share link not found"
- **Cause**: Share ID doesn't exist in database
- **Fix**: Generate a new share link

### Error: "relation 'users' does not exist"
- **Cause**: Trying to join with auth.users which requires special access
- **Fix**: Modify the query to not join users table (less ideal but works)

### Page shows login screen
- **Cause**: App requires auth before checking for shared itinerary
- **Fix**: Already handled in code (should check for share link first)

## Testing Steps

1. Create a share link (click share button)
2. Copy the short URL (e.g., `?share=2ma0qhto`)
3. Open in incognito window
4. Should see itinerary without login
5. Check if creator name is shown
6. Verify all events display correctly
