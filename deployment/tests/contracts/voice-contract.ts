/**
 * Tier 2 probe: does the real speech service answer the way this backend requires?
 *
 * It posts a toy two-turn script to the service the app itself calls, and checks the
 * audio that comes back and the length the service reports for it. The frame walk
 * below is deliberately a second implementation of the measurement, not an import of
 * the service's: a check that shares the code under test verifies nothing.
 *
 * Run it against a live service:
 *   VOICE_SERVICE_URL=http://host:port npx ts-node --transpile-only voice-contract.ts
 * Without that variable, or when the engine is unreachable, it reports SKIP and
 * exits 0: a third-party endpoint being down is availability, not a broken contract.
 */

const base = process.env.VOICE_SERVICE_URL;

let failures = 0;
const check = (held: boolean, msg: string): void => {
  if (held) {
    process.stdout.write(`  OK   - ${msg}\n`);
  } else {
    failures++;
    process.stdout.write(`  FAIL - ${msg}\n`);
  }
};

const skip = (reason: string): never => {
  process.stdout.write(`  SKIP: ${reason}\n`);
  process.exit(0);
};

/** MPEG-1/2/2.5 Layer III only: enough to measure what this service produces. */
function audioSeconds(audio: Buffer): number {
  const bitratesV1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const bitratesV2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
  const ratesV1 = [44100, 48000, 32000, 0];
  const ratesV2 = [22050, 24000, 16000, 0];
  const ratesV25 = [11025, 12000, 8000, 0];

  let at = 0;
  if (audio.length >= 10 && audio.toString('latin1', 0, 3) === 'ID3') {
    at =
      10 +
      (((audio[6] & 0x7f) << 21) |
        ((audio[7] & 0x7f) << 14) |
        ((audio[8] & 0x7f) << 7) |
        (audio[9] & 0x7f));
  }

  let seconds = 0;
  let frames = 0;
  while (at + 4 <= audio.length) {
    if (audio[at] !== 0xff || (audio[at + 1] & 0xe0) !== 0xe0) break;
    const versionBits = (audio[at + 1] >> 3) & 0x03;
    const layerBits = (audio[at + 1] >> 1) & 0x03;
    if (versionBits === 1 || layerBits !== 1) break;
    const bitrateIndex = (audio[at + 2] >> 4) & 0x0f;
    const sampleRateIndex = (audio[at + 2] >> 2) & 0x03;
    const padding = (audio[at + 2] >> 1) & 0x01;
    const mpeg1 = versionBits === 3;
    const bitrate = (mpeg1 ? bitratesV1 : bitratesV2)[bitrateIndex] * 1000;
    const sampleRate = (
      mpeg1 ? ratesV1 : versionBits === 2 ? ratesV2 : ratesV25
    )[sampleRateIndex];
    if (!bitrate || !sampleRate) break;
    seconds += (mpeg1 ? 1152 : 576) / sampleRate;
    frames += 1;
    at += Math.floor(((mpeg1 ? 144 : 72) * bitrate) / sampleRate) + padding;
  }
  if (frames === 0) throw new Error('no MPEG frames in the answer');
  return seconds;
}

const SCRIPT = {
  postId: 'probe-post',
  turns: [
    { speaker: 'Dave', text: 'This is a contract probe.' },
    { speaker: 'Sarah', text: 'Nothing more than a few words.' },
  ],
};

async function main(): Promise<void> {
  if (!base) {
    skip('VOICE_SERVICE_URL is not set - point it at a running voice service');
  }
  process.stdout.write(`=== Contract: speech service at ${base} ===\n`);

  let response: Response;
  try {
    response = await fetch(`${base}/synthesize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SCRIPT),
    });
  } catch (err) {
    skip(`voice service unreachable (${(err as Error).message})`);
  }

  if (response.status >= 500) {
    skip(`voice service says its engine is unavailable (${response.status})`);
  }
  check(
    response.ok,
    `a two-turn script is answered with ${response.status}`,
  );
  if (!response.ok) {
    process.exit(1);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  check(audio.length > 0, `the answer carries ${audio.length} bytes of audio`);

  const header = response.headers.get('x-duration-seconds');
  const reported = Number(header);
  check(
    Number.isFinite(reported) && reported > 0,
    `the reported duration is a positive number (${header})`,
  );

  let measured = 0;
  try {
    measured = audioSeconds(audio);
    check(true, `the answer decodes to ${measured.toFixed(3)}s of MPEG audio`);
  } catch (err) {
    check(false, `the answer does not decode as MPEG audio: ${(err as Error).message}`);
  }

  if (measured > 0 && Number.isFinite(reported)) {
    // The number the app stores as a segment's length has to be the length of the
    // audio it also stores, or the stream claims a duration it does not have.
    check(
      Math.abs(reported - measured) <= 0.05,
      `the reported duration matches the audio (reported ${reported}s, measured ${measured.toFixed(3)}s)`,
    );
  }

  const refused = await fetch(`${base}/synthesize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ postId: 'probe-post', turns: [] }),
  });
  check(
    refused.status === 400,
    `a script with nothing to speak is refused with ${refused.status}`,
  );

  process.stdout.write(
    `\ncontract probes: ${failures === 0 ? 'all answered as required' : `${failures} wrong`}\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((err: Error) => {
  process.stdout.write(`  FAIL: ${err.name}: ${err.message}\n`);
  process.exit(1);
});
