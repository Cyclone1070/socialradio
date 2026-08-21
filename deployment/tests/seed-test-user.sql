-- Ephemeral E2E Test Fixture: Seed non-admin user (role='user')
INSERT INTO "user" ("email", "password_hash", "role")
VALUES (
  'user@socialradio.com',
  '$2b$10$8rjRlq/njPt5Eeh7npgYn.2ViEkdX9IlefqhsfnJcjmTPabmbvK4y',
  'user'
)
ON CONFLICT ("email") DO UPDATE SET "password_hash" = EXCLUDED."password_hash";
