# The media library's inputs

**The station's library is the database and the bucket.** A row carries the object key
and the duration; the bucket holds the audio; the app reads nothing else. It has no
knowledge of the files in this folder and never looks at them at runtime.

What lives here is *authoring input*: the break liner scripts written as words, the
audio files supplied by hand, and `manifest.json`, which is the dev tool's receipt of
what a batch produced. This folder is not a source of truth and nothing needs it once a
batch has run - the rows and the objects are the result.

| Piece | Where it lives | Who owns it |
|---|---|---|
| The library (what the station plays) | a database row + a bucket object | `media-tools` writes both |
| The scripts | `media-tools/library/break-liner-lines.json` | a person, reviewing a diff |
| The batch receipt | `media-tools/library/manifest.json` | `media-tools`, written as it generates |

The flow for adding a break liner, and the reason the tool is shaped the way it is,
are below.

```json
{
  "version": 1,
  "entries": [
    {
      "kind": "music",
      "key": "music/neon-waves-8f2a1c.mp3",
      "durationSeconds": 214.5,
      "title": "Neon Waves",
      "artist": "The Static"
    },
    {
      "kind": "break_liner",
      "key": "break_liners/we-ll-be-right-back-4b1e9d.mp3",
      "durationSeconds": 4.8,
      "text": "We'll be right back after this."
    }
  ]
}
```

## Adding a break liner

```sh
# 1. write the line
$EDITOR media-tools/library/break-liner-lines.json

# 2. speak it, upload it, write the row - one command, both stores
npm run media -- speak

# 3. nothing else. The station picks it up on the next break.
```

`speak` is the whole authoring flow: it speaks the lines that have no clip yet in the
station's voice, uploads each clip, and inserts the row that makes it drawable. A line
that already has a clip is skipped, so running it twice is a no-op rather than a
duplicate.

## Removing a break liner

```sh
npm run media -- remove --key break_liners/<slug>.mp3 [--object]
```

Deleting is a deliberate act on a row, never a diff somebody forgot to make. `remove`
drops the manifest entry and the row (so it stops airing immediately), drops the line
from the pool of words (so speaking the pool again cannot bring it back), and with
`--object` deletes the clip as well. Name the clip by key: deleting by words or by
`--kind` is how the wrong clip gets retired.

## Reconciling a deployed environment

The manifest under `media-tools/library/` is the *desired* inventory; the database and
the bucket are the *actual* one. `seed` reconciles the rows to the manifest - writes
what it lists, deletes rows it no longer lists - and `seed --prune` also deletes library
audio no entry claims. Pruning is scoped to `music/`, `jingle/` and `break_liners/`, so
the show's own output under `audio/` is never touched.

An entry whose audio the bucket does not hold fails the run rather than writing a row
that points at nothing.

A staging bucket stays in place between deploys: it is what an older manifest is
re-promoted from, and at this size it costs nothing to keep.

## Why the durations are written down

The app image (`node:20-alpine`) has no way to read a duration out of an audio
file, so a duration is measured once — on the machine that adds the file — and
carried in the manifest from then on.

## Keys carry the fingerprint

Every key ends in a short hash of the file's content. Replacing a song therefore
produces a new key rather than overwriting an old one, which is what keeps a CDN
or a browser from serving the audio that used to be there. Delete the old entry
from the manifest when you replace a file; the object can be pruned after the
next deploy.

## Adding a song or a jingle

1. `npm run media -- add ./track.mp3 --kind music --title "Neon Waves" --artist "The Static"`
   copies the file into the local mirror and measures it, naming it by a fingerprint
   of its content.
2. `npm run media -- publish` uploads what the manifest lists.
3. Commit `manifest.json`. That is the review.

The next deploy reads the manifest, copies the audio into the production bucket and
seeds the rows.

`add` and `speak` are the only two ways in: supplied audio, and spoken words. There is
no third path, which is what keeps the manifest and the bucket describing the same set.

## The promote, in a deploy

`promote --from <staging bucket> --to <production bucket>` copies exactly what the
manifest lists into the bucket the station serves from. It fails when an entry has no
audio in the source, so a deploy stops rather than shipping a station quietly emptier
than its inventory. Staging is kept afterwards: it is what an older manifest is
re-promoted from when something has to be rolled back.
