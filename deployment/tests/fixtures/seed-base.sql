-- Ephemeral E2E Test Fixture: Seed non-admin user (role='user')
INSERT INTO "user" ("email", "password_hash", "role")
VALUES (
  'user@socialradio.com',
  '$2b$10$8rjRlq/njPt5Eeh7npgYn.2ViEkdX9IlefqhsfnJcjmTPabmbvK4y',
  'user'
)
ON CONFLICT ("email") DO UPDATE SET "password_hash" = EXCLUDED."password_hash";

-- Ephemeral E2E Test Fixture: Seed sample music, liners, and jingles for media rotation
INSERT INTO "music_track" ("id", "title", "artist", "file_path", "duration_seconds")
VALUES
  (gen_random_uuid(), 'Neon Waves', 'Synthwave Master', 'music/neon-waves.mp3', 180.0),
  (gen_random_uuid(), 'Midnight Drive', 'City Walker', 'music/midnight-drive.mp3', 210.0)
ON CONFLICT DO NOTHING;

INSERT INTO "liner" ("id", "text", "file_path", "duration_seconds")
VALUES
  (gen_random_uuid(), 'We will be right back after this.', 'liners/seed-back-01.mp3', 5.0),
  (gen_random_uuid(), 'Stay with us, the phones are still open.', 'liners/seed-back-02.mp3', 5.0)
ON CONFLICT DO NOTHING;

INSERT INTO "jingle" ("id", "name", "file_path", "duration_seconds")
VALUES
  (gen_random_uuid(), 'Station ID Top of Hour', 'jingles/station-id.mp3', 5.0),
  (gen_random_uuid(), 'Social Radio Intro', 'jingles/intro.mp3', 8.0)
ON CONFLICT DO NOTHING;
