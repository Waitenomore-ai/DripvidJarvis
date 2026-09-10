'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { loadConfig } =
  require('./config');

const {
  createDripVidAdapter
} = require('./adapters/dripvid');

const {
  createMcpAdapter
} = require('./adapters/mcp');

const {
  createOpenAiAdapter
} = require('./adapters/openai');

const {
  createModelRouter
} = require('./adapters/router');

const {
  createBrain
} = require('./brain');

const {
  createJarvis
} = require('./jarvis');

const PUBLIC_DIR =
  path.resolve(__dirname, '..', 'public');

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js':
    'application/javascript; charset=utf-8',
  '.json':
    'application/json; charset=utf-8'
};

function sendJson(
  res,
  statusCode,
  body
) {
  res.statusCode = statusCode;
  res.setHeader(
    'content-type',
    'application/json; charset=utf-8'
  );
  res.setHeader(
    'cache-control',
    'no-store'
  );
  res.end(JSON.stringify(body));
}

function readJson(
  req,
  limit = 1024 * 1024
) {
  return new Promise(
    (resolve, reject) => {
      let size = 0;
      const chunks = [];

      req.on('data', (chunk) => {
        size += chunk.length;

        if (size > limit) {
          reject(
            new Error(
              'Request body too large'
            )
          );
          req.destroy();
          return;
        }

        chunks.push(chunk);
      });

      req.on('end', () => {
        if (chunks.length === 0) {
          resolve({});
          return;
        }

        try {
          resolve(
            JSON.parse(
              Buffer.concat(
                chunks
              ).toString('utf8')
            )
          );
        } catch {
          reject(
            new Error(
              'Malformed JSON'
            )
          );
        }
      });

      req.on('error', reject);
    }
  );
}

function serveStatic(req, res) {
  const requestPath =
    req.url === '/'
      ? '/index.html'
      : req.url;

  const pathname =
    new URL(
      requestPath,
      'http://127.0.0.1'
    ).pathname;

  const relative =
    pathname.replace(/^\/+/, '');

  const fullPath =
    path.resolve(
      PUBLIC_DIR,
      relative
    );

  if (!fullPath.startsWith(
    `${PUBLIC_DIR}${path.sep}`
  )) {
    return false;
  }

  if (!fs.existsSync(fullPath) ||
      !fs.statSync(fullPath).isFile()) {
    return false;
  }

  res.statusCode = 200;
  res.setHeader(
    'content-type',
    STATIC_TYPES[
      path.extname(fullPath)
    ] || 'application/octet-stream'
  );
  res.setHeader(
    'cache-control',
    'no-cache'
  );

  fs.createReadStream(fullPath)
    .pipe(res);

  return true;
}

function createRuntime({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now
} = {}) {
  const config = loadConfig(env);

  const dripvid =
    createDripVidAdapter({
      config,
      fetchImpl
    });

  const mcp =
    createMcpAdapter({
      config,
      fetchImpl
    });

  const primary =
    createOpenAiAdapter({
      config,
      fetchImpl
    });

  const fallback =
    config.fallbackBaseUrl &&
    config.fallbackApiKey
      ? createOpenAiAdapter({
          config: {
            ...config,
            openAiBaseUrl:
              config.fallbackBaseUrl,
            openAiApiKey:
              config.fallbackApiKey,
            openAiModel:
              config.fallbackModel,
            requestTimeoutMs:
              config.requestTimeoutMs,
            chatTimeoutMs:
              config.chatTimeoutMs
          },
          fetchImpl
        })
      : null;

  const model =
    createModelRouter({
      primary,
      fallback,
      cooldownMs:
        config.modelFallbackCooldownMs,
      now
    });

  const brain =
    createBrain({ config });

  const jarvis =
    createJarvis({
      config,
      dripvid,
      mcp,
      brain,
      model,
      now
    });

  return {
    config,
    jarvis
  };
}

function createApp(options = {}) {
  const runtime =
    options.runtime ||
    createRuntime(options);

  const jarvis =
    options.jarvis ||
    runtime.jarvis;

  return http.createServer(
    async (req, res) => {
      try {
        if (
          req.method === 'GET' &&
          req.url === '/api/health'
        ) {
          sendJson(
            res,
            200,
            await jarvis.health()
          );
          return;
        }

        if (
          req.method === 'GET' &&
          req.url === '/api/tools'
        ) {
          sendJson(
            res,
            200,
            {
              tools:
                await jarvis.tools()
            }
          );
          return;
        }

        if (
          req.method === 'GET' &&
          req.url ===
            '/api/confirmations'
        ) {
          sendJson(
            res,
            200,
            {
              confirmations:
                jarvis
                  .pendingConfirmations()
            }
          );
          return;
        }

        if (
          req.method === 'POST' &&
          req.url ===
            '/api/conversation'
        ) {
          const body =
            await readJson(req);

          sendJson(
            res,
            200,
            await jarvis.conversation(
              body
            )
          );
          return;
        }

        if (
          req.method === 'POST' &&
          req.url ===
            '/api/confirm'
        ) {
          const body =
            await readJson(req);

          try {
            const result =
              await jarvis.confirm(
                body.id
              );

            sendJson(
              res,
              200,
              result
            );
          } catch (error) {
            sendJson(
              res,
              400,
              {
                error:
                  error.message
              }
            );
          }

          return;
        }

        if (
          req.method === 'GET' &&
          serveStatic(req, res)
        ) {
          return;
        }

        sendJson(
          res,
          404,
          {
            error: 'Not found'
          }
        );
      } catch (error) {
        const malformed =
          error.message ===
          'Malformed JSON';

        sendJson(
          res,
          malformed ? 400 : 500,
          {
            error:
              error.message ||
              'Internal server error'
          }
        );
      }
    }
  );
}

function start(env = process.env) {
  const runtime =
    createRuntime({ env });

  const server =
    createApp({ runtime });

  server.listen(
    runtime.config.port,
    runtime.config.host,
    () => {
      console.log(
        `DripVid JARVIS listening on http://${runtime.config.host}:${runtime.config.port}`
      );
    }
  );

  return server;
}

if (require.main === module) {
  start();
}

module.exports = {
  createApp,
  createRuntime,
  start
};
