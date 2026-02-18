-- Enforce a maximum of 100 users for beta/MVP phase
-- This prevents unlimited growth and keeps the service manageable

-- Create a function to check user limit
CREATE OR REPLACE FUNCTION check_user_limit()
RETURNS BOOLEAN AS $$
DECLARE
  user_count INTEGER;
BEGIN
  -- Count unique users who have created at least one itinerary
  SELECT COUNT(DISTINCT user_id) INTO user_count
  FROM itineraries;

  -- Return true if under limit, false if at or over limit
  RETURN user_count < 100;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a function to get current user count
CREATE OR REPLACE FUNCTION get_user_count()
RETURNS INTEGER AS $$
DECLARE
  user_count INTEGER;
BEGIN
  SELECT COUNT(DISTINCT user_id) INTO user_count
  FROM itineraries;

  RETURN user_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a trigger function to enforce user limit on itinerary creation
CREATE OR REPLACE FUNCTION enforce_user_limit()
RETURNS TRIGGER AS $$
DECLARE
  user_count INTEGER;
  is_new_user BOOLEAN;
BEGIN
  -- Check if this user already has itineraries
  SELECT NOT EXISTS (
    SELECT 1 FROM itineraries
    WHERE user_id = NEW.user_id
  ) INTO is_new_user;

  -- If this is a new user, check the limit
  IF is_new_user THEN
    SELECT COUNT(DISTINCT user_id) INTO user_count
    FROM itineraries;

    -- If at or over limit, reject the insert
    IF user_count >= 100 THEN
      RAISE EXCEPTION 'USER_LIMIT_REACHED:⚠️ The app has reached its maximum capacity of 100 users. We are currently in beta and not accepting new users at this time. Please send a DM to X account @_cryptobuddha to get on the waiting list for access.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS enforce_user_limit_trigger ON itineraries;

-- Create trigger that runs before insert on itineraries table
CREATE TRIGGER enforce_user_limit_trigger
  BEFORE INSERT ON itineraries
  FOR EACH ROW
  EXECUTE FUNCTION enforce_user_limit();

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION check_user_limit() TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_count() TO authenticated;
GRANT EXECUTE ON FUNCTION check_user_limit() TO anon;
GRANT EXECUTE ON FUNCTION get_user_count() TO anon;

-- Comment for clarity
COMMENT ON FUNCTION check_user_limit() IS 'Returns true if user count is under 100, false otherwise';
COMMENT ON FUNCTION get_user_count() IS 'Returns the current number of unique users (users who have created at least one itinerary)';
COMMENT ON FUNCTION enforce_user_limit() IS 'Trigger function that prevents new users from creating itineraries when limit is reached';
