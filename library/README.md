# The media library

What the station can play when it isn't talking: songs, break liner announcements and
jingles. Two halves, kept apart on purpose.

| Half | Where it lives | Who owns it |
|---|---|---|
| The audio | an object bucket | `npm run media -- publish` puts it there |
| The inventory | `library/manifest.json` in this repository | a person, reviewing a diff |

`manifest.json` lists every file the station owns: its object key, what kind of
thing it is, how long it lasts, and the facts the row needs (a song's title and
artist, a break liner's words, a jingle's name). The database is a projection of this
file — `npm run seed:media` makes the rows agree with it, and refuses to write a
row for a file the bucket does not hold.

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

## Adding something

1. Put the file in the bucket under its key (`media:publish` does this, hashing
   and measuring as it goes).
2. Add its entry to `manifest.json` and commit it. That is the review.
3. The next deploy reads the manifest, copies the audio into the production
   bucket and writes the rows.

BreakLiner clips are the exception: their words are already in
`library/break-liner-lines.json`, so they are spoken rather than supplied, and their
entries are produced by the side that spoke them.

## Seeding, on the command line

```sh
npm run media -- seed --dry-run   # what would change, and what has no audio
npm run media -- seed             # make the rows agree with the manifest
```

A run that finds an entry with no audio in the bucket exits non-zero, so a deploy
notices instead of shipping a station that is quietly emptier than its manifest.

## The commands, by hand

BreakLiner clips are spoken rather than supplied, so they have their own command:

```sh
npm run media -- speak --dry-run      # which lines have no clip yet
npm run media -- speak                # speak them into the bucket, record them
```

Songs and jingles are files you have, so they take two steps:

```sh
npm run media -- add ./track.mp3 --kind music --title "Neon Waves" --artist "The Static"
npm run media -- publish              # upload what the manifest lists
```

`add` measures the file and names it by a fingerprint of its content; `publish`
skips any key the bucket already holds, because a key that is already there
already holds exactly this audio.

In the deploy, one more command runs: `promote --from <staging bucket> --to
<production bucket>`, which copies exactly what the manifest lists. `seed` then
writes the rows. Neither is run by the station itself.
