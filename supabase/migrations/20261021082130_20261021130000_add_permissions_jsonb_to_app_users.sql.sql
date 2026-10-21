/*
# Add Granular Permissions JSONB Column to app_users

## Purpose
Upgrade the access control system from simple role + PU report booleans to a fine-grained
page-based permissions matrix stored as JSONB. This enables per-user control over:
- Calendar viewing, rate editing, and net/B2B price visibility
- MiniRMS module access level (full / data_only / none)
- System settings: inventory management and user management

## Changes
1. Add `permissions` JSONB column to `app_users` (nullable, defaults to NULL)
   - Existing users get NULL (treated as full access for admins, none for regular users)
   - New users get a sensible default based on role

2. Backfill existing rows:
   - Admin users → full permissions object
   - Regular users with can_access_pu_report=true → full mini_rms, read-only calendar
   - Regular users with can_upload_pu_only=true → data_only mini_rms
   - Others → minimal permissions (calendar view only)

## Permissions JSONB Structure
{
  "calendar": { "view": true, "edit_rates": false, "view_net_b2b": false },
  "mini_rms": "full" | "data_only" | "none",
  "settings": { "manage_inventory": false, "manage_users": false }
}

## Security
- No RLS policy changes (app_users already has authenticated-scoped policies).
- Column is nullable for backward compatibility.

## Notes
- Admins implicitly bypass all permission checks in the frontend (role === 'admin').
- The permissions object is read at login time and stored in AppUser context.
- Idempotent: uses DO $$ IF NOT EXISTS block for column addition.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'app_users' AND column_name = 'permissions'
  ) THEN
    ALTER TABLE app_users ADD COLUMN permissions jsonb;
  END IF;
END $$;

-- Backfill: admin users get full permissions
UPDATE app_users
SET permissions = '{"calendar":{"view":true,"edit_rates":true,"view_net_b2b":true},"mini_rms":"full","settings":{"manage_inventory":true,"manage_users":true}}'::jsonb
WHERE role = 'admin' AND permissions IS NULL;

-- Backfill: regular users with can_access_pu_report = true
UPDATE app_users
SET permissions = '{"calendar":{"view":true,"edit_rates":false,"view_net_b2b":false},"mini_rms":"full","settings":{"manage_inventory":false,"manage_users":false}}'::jsonb
WHERE role != 'admin' AND can_access_pu_report = true AND permissions IS NULL;

-- Backfill: regular users with can_upload_pu_only = true
UPDATE app_users
SET permissions = '{"calendar":{"view":true,"edit_rates":false,"view_net_b2b":false},"mini_rms":"data_only","settings":{"manage_inventory":false,"manage_users":false}}'::jsonb
WHERE role != 'admin' AND can_access_pu_report != true AND can_upload_pu_only = true AND permissions IS NULL;

-- Backfill: remaining users (no PU access)
UPDATE app_users
SET permissions = '{"calendar":{"view":true,"edit_rates":false,"view_net_b2b":false},"mini_rms":"none","settings":{"manage_inventory":false,"manage_users":false}}'::jsonb
WHERE permissions IS NULL;
