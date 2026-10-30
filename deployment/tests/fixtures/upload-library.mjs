/**
 * Puts the fixture library into the source bucket, so the promote-and-seed
 * check has something to promote. It runs before the suites: their own fixture
 * upload happens inside a suite, which is later than this.
 *
 * One audio file is reused for every key. Promote copies by key, and a key
 * carries a fingerprint, so the bytes only need to exist - not be distinct.
 */
import { readFileSync } from 'node:fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const manifest = JSON.parse(readFileSync('/usr/src/app/media-tools/library/manifest.json', 'utf8'));
const audio = readFileSync('/audio/track.mp3');
const s3 = new S3Client({
  endpoint: process.env.STORAGE_ENDPOINT,
  region: 'auto',
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.STORAGE_SECRET_KEY,
  },
  forcePathStyle: true,
});

for (const entry of manifest.entries) {
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.LIBRARY_SOURCE_BUCKET,
      Key: entry.key,
      Body: audio,
      ContentType: 'audio/mpeg',
    }),
  );
}
console.log(`uploaded ${manifest.entries.length} file(s) to ${process.env.LIBRARY_SOURCE_BUCKET}`);
