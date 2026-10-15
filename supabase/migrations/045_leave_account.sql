-- ============================================================
-- 045_leave_account
--
-- Lets a member leave the shared account on their own. Until now only
-- an admin could remove them (remove_account_member), even though that
-- function's error already told people to "leave the account instead".
--
-- Same outcome as being removed: the caller moves into a fresh personal
-- account they own, so their login keeps working. The owner can't
-- leave — they must transfer ownership first (the account would be
-- left without one).
-- ============================================================

CREATE OR REPLACE FUNCTION public.leave_account()
RETURNS UUID  -- the new personal account id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role account_role_enum;
  v_name TEXT;
  v_email TEXT;
  v_new_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_role, full_name, email
  INTO v_role, v_name, v_email
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_role = 'owner' THEN
    RAISE EXCEPTION 'The owner cannot leave; transfer ownership first'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_name, ''), v_email, 'My account'), auth.uid())
  RETURNING id INTO v_new_account_id;

  UPDATE profiles
  SET account_id = v_new_account_id,
      account_role = 'owner'
  WHERE user_id = auth.uid();

  RETURN v_new_account_id;
END;
$$;

REVOKE ALL ON FUNCTION public.leave_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_account() TO authenticated;
