-- Owner explicitly designated by the workspace operator.
-- Membership alone does not create a Supabase Auth account or bypass sign-in.
insert into capital_grow.memberships
  (email,app_user_id,name,role,floor_operator,can_export)
values
  ('capitalgrow8651@gmail.com','u0','Capital Grow Owner','Admin',true,true);
