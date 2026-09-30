#!/usr/bin/env node
/**
 * Stub for the script-generation provider. Speaks the same wire contract the
 * real provider does: OpenAI-compatible /chat/completions, including SSE
 * streaming, because the app consumes a text stream rather than a single body.
 *
 * Used two ways:
 *   - in-process by the contract specs (Tier 1)
 *   - as a container in the compose mocks profile, so the whole app can run
 *     against it without credentials
 *
 * It serves recordings when they exist (test/contracts/fixtures), so refreshing
 * a mock is a reviewable diff instead of a silent assumption.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const fixturesDir = path.join(__dirname, '..', '..', 'test', 'contracts', 'fixtures');

function readFixture(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'));
  } catch {
    return null;
  }
}

/** Recorded reply, or a fixed one when no recording has been captured yet. */
function replyFor(model) {
  const recorded = readFixture('llm-reply.json');
  if (recorded && recorded.model === model && recorded.content) {
    return recorded.content;
  }
  return 'hello';
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/models')) {
      const model = process.env.LLM_MODEL || 'stub-model-free';
      return sendJson(res, 200, {
        object: 'list',
        data: [{ id: model, object: 'model', owned_by: 'stub' }],
      });
    }

    if (req.method === 'POST' && req.url.startsWith('/chat/completions')) {
      const body = await readBody(req);
      const model = body.model || 'stub-model-free';

      // Unknown models fail the way a retired model does upstream, so the
      // contract spec can assert that this path is loud rather than silent.
      const known = process.env.LLM_MODEL || 'stub-model-free';
      if (model !== known) {
        return sendJson(res, 400, {
          error: { type: 'server_error', message: 'Model is unavailable.' },
        });
      }

      const content = replyFor(model);

      if (!body.stream) {
        return sendJson(res, 200, {
          id: 'stub-completion',
          object: 'chat.completion',
          model,
          choices: [
            { index: 0, finish_reason: 'stop', message: { role: 'assistant', content } },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      for (const token of content.split(' ')) {
        res.write(
          `data: ${JSON.stringify({
            id: 'stub-chunk',
            object: 'chat.completion.chunk',
            model,
            choices: [{ index: 0, delta: { content: `${token} ` } }],
          })}\n\n`,
        );
      }
      res.write(
        `data: ${JSON.stringify({
          id: 'stub-chunk',
          object: 'chat.completion.chunk',
          model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    sendJson(res, 404, { error: { message: `no stub route for ${req.url}` } });
  });
}

if (require.main === module) {
  const port = Number(process.env.STUB_PORT || 4010);
  createServer().listen(port, '0.0.0.0', () => {
    process.stdout.write(`llm stub listening on ${port}\n`);
  });
}

module.exports = { createServer };
