import request from 'supertest';
import { createApp } from './app';
import { NothingToSpeakError, Script, Track } from './types';

const audio = Buffer.from([0xff, 0xf3, 0x64, 0xc4]);

describe('the voice service HTTP surface', () => {
  const appWith = (synthesize: (script: Script) => Promise<Track>) =>
    createApp(synthesize);

  it('answers a script with the audio and the length of that audio', async () => {
    const synthesize = jest
      .fn<Promise<Track>, [Script]>()
      .mockResolvedValue({ audio, seconds: 2.5 });

    const res = await request(appWith(synthesize))
      .post('/synthesize')
      .send({ postId: 'p1', turns: [{ speaker: 'Dave', text: 'Hello.' }] });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    // The caller stores this number as the segment's length, so it travels with
    // the audio rather than being recomputed by whoever receives it.
    expect(res.headers['x-duration-seconds']).toBe('2.5');
    expect(res.body).toEqual(audio);
    expect(synthesize).toHaveBeenCalledWith({
      postId: 'p1',
      turns: [{ speaker: 'Dave', text: 'Hello.' }],
    });
  });

  it('refuses a body that is not a script', async () => {
    const res = await request(appWith(jest.fn()))
      .post('/synthesize')
      .send({
        postId: 'p1',
        turns: [{ speaker: 'Dave' }],
      });

    expect(res.status).toBe(400);
  });

  it('answers 400 when the script has nothing to speak', async () => {
    const synthesize = jest
      .fn<Promise<Track>, [Script]>()
      .mockRejectedValue(
        new NothingToSpeakError('script has no turns to speak'),
      );

    const res = await request(appWith(synthesize))
      .post('/synthesize')
      .send({ postId: 'p1', turns: [] });

    expect(res.status).toBe(400);
  });

  it('answers 500 when the engine fails, which is not the caller_s fault', async () => {
    const synthesize = jest
      .fn<Promise<Track>, [Script]>()
      .mockRejectedValue(new Error('the endpoint refused the connection'));

    const res = await request(appWith(synthesize))
      .post('/synthesize')
      .send({ postId: 'p1', turns: [{ speaker: 'Dave', text: 'Hello.' }] });

    expect(res.status).toBe(500);
  });

  it('answers health checks', async () => {
    const res = await request(appWith(jest.fn())).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
