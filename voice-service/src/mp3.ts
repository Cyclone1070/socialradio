/**
 * The true length of an MP3, measured from its frames.
 *
 * The app used to infer this from the byte count and an assumed bitrate: correct
 * while the format never moves, silently wrong the moment it does, and wrong the
 * same way for a truncated file. Counting frames answers "how long is this
 * audio?" instead of "how long should audio of this size be?".
 */

// Index by the header's 4-bit bitrate index. Zero means "free" or invalid.
const BITRATES_KBPS_V1_L3 = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
];
const BITRATES_KBPS_V2_L3 = [
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0,
];
const SAMPLE_RATES_V1 = [44100, 48000, 32000, 0];
const SAMPLE_RATES_V2 = [22050, 24000, 16000, 0];
const SAMPLE_RATES_V25 = [11025, 12000, 8000, 0];

type Frame = { length: number; seconds: number };

/** Everything before the first frame, if the file carries an ID3v2 tag. */
function audioStart(audio: Buffer): number {
  if (audio.length >= 10 && audio.toString('latin1', 0, 3) === 'ID3') {
    const size =
      ((audio[6] & 0x7f) << 21) |
      ((audio[7] & 0x7f) << 14) |
      ((audio[8] & 0x7f) << 7) |
      (audio[9] & 0x7f);
    return 10 + size;
  }
  return 0;
}

/** Returns null where the bytes are not the start of an MPEG-1/2/2.5 Layer III frame. */
function readFrame(audio: Buffer, at: number): Frame | null {
  if (audio.length - at < 4) return null;
  if (audio[at] !== 0xff || (audio[at + 1] & 0xe0) !== 0xe0) return null;

  const versionBits = (audio[at + 1] >> 3) & 0x03;
  const layerBits = (audio[at + 1] >> 1) & 0x03;
  // 01 in the version field is reserved, and this parser only walks Layer III.
  if (versionBits === 1 || layerBits !== 1) return null;

  const bitrateIndex = (audio[at + 2] >> 4) & 0x0f;
  const sampleRateIndex = (audio[at + 2] >> 2) & 0x03;
  const padding = (audio[at + 2] >> 1) & 0x01;

  const mpeg1 = versionBits === 3;
  const bitrate =
    (mpeg1 ? BITRATES_KBPS_V1_L3 : BITRATES_KBPS_V2_L3)[bitrateIndex] * 1000;
  const sampleRate = (
    mpeg1
      ? SAMPLE_RATES_V1
      : versionBits === 2
        ? SAMPLE_RATES_V2
        : SAMPLE_RATES_V25
  )[sampleRateIndex];
  if (!bitrate || !sampleRate) return null;

  const samplesPerFrame = mpeg1 ? 1152 : 576;
  return {
    length: Math.floor(((mpeg1 ? 144 : 72) * bitrate) / sampleRate) + padding,
    seconds: samplesPerFrame / sampleRate,
  };
}

export function measureMp3Seconds(audio: Buffer): number {
  let at = audioStart(audio);
  let seconds = 0;
  let frames = 0;

  if (!readFrame(audio, at)) {
    throw new Error(
      `not MP3 audio: no Layer III frame at offset ${at} of ${audio.length} bytes`,
    );
  }

  while (at < audio.length) {
    const frame = readFrame(audio, at);
    // Fewer than four bytes left is padding, not audio. Anything else means this
    // file is not what it claims, and guessing a length would hide that.
    if (!frame) {
      if (audio.length - at < 4) break;
      throw new Error(
        `not MP3 audio: no Layer III frame at offset ${at} of ${audio.length} bytes`,
      );
    }
    seconds += frame.seconds;
    frames += 1;
    at += frame.length;
  }

  if (frames === 0) {
    throw new Error('not MP3 audio: the file contains no frames');
  }
  // Frame lengths are exact multiples of a millisecond at these sample rates;
  // rounding here keeps accumulated float noise out of the column the app stores.
  return Math.round(seconds * 1000) / 1000;
}
