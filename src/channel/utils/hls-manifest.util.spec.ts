import { generateHlsManifest } from './hls-manifest.util';

describe('HlsManifestUtil', () => {
  describe('Cycle 1.1: Basic Header Formatting', () => {
    it('generates standard HLS header with EXTM3U and version', () => {
      const manifest = generateHlsManifest({
        mediaSequence: 0,
        segments: [],
      });

      expect(manifest.startsWith('#EXTM3U\n#EXT-X-VERSION:3\n')).toBe(true);
    });
  });

  describe('Cycle 1.2: Target Duration Upper Bound (Invariant HLS-1)', () => {
    it('computes target duration as integer ceiling of max segment duration', () => {
      const manifest = generateHlsManifest({
        mediaSequence: 0,
        segments: [
          { durationSeconds: 12.4, url: 'http://cdn/chunk1.mp3' },
          { durationSeconds: 45.1, url: 'http://cdn/chunk2.mp3' },
          { durationSeconds: 30.0, url: 'http://cdn/chunk3.mp3' },
        ],
      });

      expect(manifest).toContain('#EXT-X-TARGETDURATION:46\n');
    });

    it('defaults to 10 seconds if segments list is empty', () => {
      const manifest = generateHlsManifest({
        mediaSequence: 0,
        segments: [],
      });

      expect(manifest).toContain('#EXT-X-TARGETDURATION:10\n');
    });
  });

  describe('Cycle 1.3: Media Sequence Rendering (Invariant HLS-2)', () => {
    it('renders EXT-X-MEDIA-SEQUENCE matching provided sequence index', () => {
      const manifest = generateHlsManifest({
        mediaSequence: 104,
        segments: [],
      });

      expect(manifest).toContain('#EXT-X-MEDIA-SEQUENCE:104\n');
    });

    it('guards against negative sequence index by clamping to 0', () => {
      const manifest = generateHlsManifest({
        mediaSequence: -5,
        segments: [],
      });

      expect(manifest).toContain('#EXT-X-MEDIA-SEQUENCE:0\n');
    });
  });

  describe('Cycle 1.4: Segment Entry Serialization (Invariants HLS-3 & HLS-5)', () => {
    it('serializes segments with EXTINF duration and target URI', () => {
      const manifest = generateHlsManifest({
        mediaSequence: 10,
        segments: [
          { durationSeconds: 42.5, url: 'http://cdn/talk-1.mp3' },
          { durationSeconds: 15.0, url: 'http://cdn/ad-1.mp3' },
        ],
      });

      const expected =
        '#EXTINF:42.5,\n' +
        'http://cdn/talk-1.mp3\n' +
        '#EXTINF:15.0,\n' +
        'http://cdn/ad-1.mp3\n';

      expect(manifest).toContain(expected);
    });

    it('formats integer durations with one decimal place', () => {
      const manifest = generateHlsManifest({
        mediaSequence: 1,
        segments: [{ durationSeconds: 6, url: 'http://cdn/jingle.mp3' }],
      });

      expect(manifest).toContain('#EXTINF:6.0,\nhttp://cdn/jingle.mp3\n');
    });

    it('emits EXT-X-DISCONTINUITY tag before a segment flagged with discontinuity', () => {
      const manifest = generateHlsManifest({
        mediaSequence: 1,
        segments: [
          { durationSeconds: 30, url: 'http://cdn/song.mp3' },
          {
            durationSeconds: 45,
            url: 'http://cdn/talk.mp3',
            discontinuity: true,
          },
        ],
      });

      expect(manifest).toContain(
        '#EXTINF:30.0,\nhttp://cdn/song.mp3\n#EXT-X-DISCONTINUITY\n#EXTINF:45.0,\nhttp://cdn/talk.mp3\n',
      );
    });

    it('filters out segments with empty or whitespace-only URLs', () => {
      const manifest = generateHlsManifest({
        mediaSequence: 1,
        segments: [
          { durationSeconds: 10, url: '' },
          { durationSeconds: 20, url: '   ' },
          { durationSeconds: 30, url: 'http://cdn/valid.mp3' },
        ],
      });

      expect(manifest).not.toContain('#EXTINF:10.0');
      expect(manifest).not.toContain('#EXTINF:20.0');
      expect(manifest).toContain('#EXTINF:30.0,\nhttp://cdn/valid.mp3\n');
    });
  });

  describe('Cycle 1.5: Liveness Invariant (Invariant HLS-4)', () => {
    it('ensures live stream manifest does not terminate with EXT-X-ENDLIST', () => {
      const manifest = generateHlsManifest({
        mediaSequence: 5,
        segments: [{ durationSeconds: 10, url: 'http://cdn/chunk.mp3' }],
      });

      expect(manifest).not.toContain('#EXT-X-ENDLIST');
    });
  });
});
