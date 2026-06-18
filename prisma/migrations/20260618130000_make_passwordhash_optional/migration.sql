-- Passwordless (OTP) accounts are created without a password, but the original
-- `init` migration defined Customer.passwordHash as NOT NULL. The Prisma schema
-- was updated to `passwordHash String?` without a matching migration, leaving
-- production out of sync (customer creation failed with a NOT NULL violation).
-- This migration makes the column nullable to match the schema.
ALTER TABLE "Customer" ALTER COLUMN "passwordHash" DROP NOT NULL;