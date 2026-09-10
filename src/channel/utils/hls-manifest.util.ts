export interface HlsSegment {
  durationSeconds: number;
  url: string;
  discontinuity?: boolean;
}

export interface HlsManifestOptions {
  mediaSequence: number;
  segments: HlsSegment[];
  targetDuration?: number;
}

export function generateHlsManifest(options: HlsManifestOptions): string {
  const validSegments = options.segments.filter(
    (s) => s.url && s.url.trim().length > 0,
  );

  const targetDuration =
    options.targetDuration ??
    (validSegments.length > 0
      ? Math.ceil(Math.max(...validSegments.map((s) => s.durationSeconds)))
      : 10);

  const mediaSequence = Math.max(0, Math.floor(options.mediaSequence || 0));

  let manifest =
    `#EXTM3U\n` +
    `#EXT-X-VERSION:3\n` +
    `#EXT-X-TARGETDURATION:${targetDuration}\n` +
    `#EXT-X-MEDIA-SEQUENCE:${mediaSequence}\n`;

  for (const segment of validSegments) {
    if (segment.discontinuity) {
      manifest += `#EXT-X-DISCONTINUITY\n`;
    }

    const formattedDuration = Number.isInteger(segment.durationSeconds)
      ? segment.durationSeconds.toFixed(1)
      : Number(segment.durationSeconds.toFixed(3)).toString();

    manifest += `#EXTINF:${formattedDuration},\n${segment.url}\n`;
  }

  return manifest;
}
