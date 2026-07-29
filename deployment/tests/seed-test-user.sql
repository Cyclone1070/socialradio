-- Ephemeral E2E Test Fixture: Ensure user table exists and seed non-admin user (role='user')
CREATE TABLE IF NOT EXISTS "user" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" varchar NOT NULL UNIQUE,
  "passwordHash" varchar NOT NULL,
  "role" varchar NOT NULL DEFAULT 'user',
  "createdAt" TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO "user" ("email", "passwordHash", "role")
VALUES (
  'user@socialradio.com',
  '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeg6Lruj3vjPGga31lW',
  'user'
)
ON CONFLICT ("email") DO NOTHING;
