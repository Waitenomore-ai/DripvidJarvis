'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const {
  execFileSync
} = require('node:child_process');

const os = require('node:os');

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
  createElevenLabsAdapter
} = require('./adapters/elevenlabs');

const {
  createBrain
} = require('./brain');

const {
  createVault
} = require('./vault');

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
    'application/json; charset=utf-8',
  '.svg':
    'image/svg+xml; charset=utf-8',
  '.png':
    'image/png'
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

function readNetworkCounters() {
  try {
    if (
      process.platform === 'linux'
    ) {
      const raw =
        fs.readFileSync(
          '/proc/net/dev',
          'utf8'
        );

      let rxBytes = 0;
      let txBytes = 0;

      for (const line of
        raw.split('\n').slice(2)) {
        const sep = line.indexOf(':');

        if (sep === -1) {
          continue;
        }

        const iface =
          line.slice(0, sep).trim();

        if (iface === 'lo') {
          continue;
        }

        const fields =
          line
            .slice(sep + 1)
            .trim()
            .split(/\s+/);

        rxBytes +=
          Number(fields[0] || 0);
        txBytes +=
          Number(fields[8] || 0);
      }

      return {
        rxBytes,
        txBytes,
        ts: Date.now()
      };
    }

    if (
      process.platform === 'win32'
    ) {
      const out =
        execFileSync(
          'netstat',
          ['-e'],
          { encoding: 'utf8' }
        );

      const match =
        out.match(
          /Bytes\s+([\d,]+)\s+([\d,]+)/
        );

      if (match) {
        const un =
          (s) =>
            Number(s.replaceAll(',', ''));

        return {
          rxBytes: un(match[1]),
          txBytes: un(match[2]),
          ts: Date.now()
        };
      }
    }

    if (
      process.platform === 'darwin'
    ) {
      const out =
        execFileSync(
          'netstat',
          ['-ib'],
          { encoding: 'utf8' }
        );

      let rxBytes = 0;
      let txBytes = 0;

      for (const line of
        out.split('\n')) {
        const parts =
          line.trim().split(/\s+/);

        if (
          parts.length >= 10 &&
          parts[0].match(
            /^(en|eth|wlan|br|bond)\d/
          )
        ) {
          rxBytes +=
            Number(
              parts[6] || 0
            );
          txBytes +=
            Number(
              parts[9] || 0
            );
        }
      }

      return {
        rxBytes,
        txBytes,
        ts: Date.now()
      };
    }
  } catch {
    // counters unavailable
  }

  return null;
}

function gatherServerMetrics() {
  const cpuInfo = os.cpus();

  const rootPath =
    os.platform() === 'win32'
      ? 'C:\\'
      : '/';

  let storage = null;

  try {
    const stat =
      fs.statfsSync(rootPath);

    storage = {
      path: rootPath,
      total:
        stat.blocks * stat.bsize,
      free:
        stat.bfree * stat.bsize,
      avail:
        stat.bavail * stat.bsize
    };
  } catch {
    // storage stays null
  }

  return {
    hostname: os.hostname(),
    platform: `${os.platform()}-${os.arch()}`,
    osType: os.type(),
    osRelease: os.release(),
    uptimeSec:
      Math.floor(os.uptime()),
    cpu: {
      cores: cpuInfo.length,
      model:
        (cpuInfo[0] || {}).model ||
        null,
      loadAvg: os.loadavg()
    },
    memory: {
      total: os.totalmem(),
      free: os.freemem()
    },
    storage,
    network:
      readNetworkCounters()
  };
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

  const tts =
    createElevenLabsAdapter({
      config,
      fetchImpl
    });

  const brain =
    createBrain({ config });

  const vault =
    createVault({ config });

  const jarvis =
    createJarvis({
      config,
      dripvid,
      mcp,
      brain,
      vault,
      model,
      now
    });

  return {
    config,
    jarvis,
    vault,
    tts
  };
}

function createApp(options = {}) {
  const runtime =
    options.runtime ||
    createRuntime(options);

  const jarvis =
    options.jarvis ||
    runtime.jarvis;

  const tts =
    options.tts ||
    runtime.tts ||
    null;

  return http.createServer(
    async (req, res) => {
      try {
        if (
          req.method === 'GET' &&
          req.url === '/api/health'
        ) {
          const health =
            await jarvis.health();

          if (tts) {
            health.dependencies = {
              ...(health.dependencies || {}),
              tts: await tts.health()
            };
          }

          sendJson(res, 200, health);
          return;
        }

        if (
          req.method === 'GET' &&
          req.url === '/api/metrics'
        ) {
          sendJson(
            res,
            200,
            gatherServerMetrics()
          );
          return;
        }

        if (
          req.method === 'GET' &&
          req.url === '/api/vault'
        ) {
          if (!runtime.vault) {
            sendJson(res, 501, {
              status: 'enabled',
              error: 'vault not enabled'
            });
            return;
          }

          sendJson(
            res,
            200,
            runtime.vault.stats()
          );
          return;
        }

        if (
          req.method === 'POST' &&
          req.url === '/api/vault/reindex'
        ) {
          if (!runtime.vault) {
            sendJson(res, 501, {
              error: 'vault not enabled'
            });
            return;
          }

          const result =
            await runtime.vault.reindex();
          sendJson(res, 200, result);
          return;
        }

        if (
          req.method === 'GET' &&
          req.url === '/api/verify'
        ) {
          const verifyResult = {
            status: 'unknown',
            enabled: true,
            reset: null
          };

          try {
            const raw =
              fs.readFileSync(
                runtime
                  .config
                  .verifyResultPath,
                'utf8'
              );

            const parsed =
              JSON.parse(raw);

            if (
              parsed &&
              typeof parsed ===
                'object'
            ) {
              verifyResult.status =
                typeof parsed.status ===
                  'string' &&
                parsed.status.length
                  ? parsed.status
                  : 'unknown';
              verifyResult.attempts =
                Number.isInteger(
                  parsed.attempts
                )
                  ? parsed.attempts
                  : null;
              verifyResult.steps =
                parsed.steps &&
                typeof parsed.steps ===
                  'object'
                  ? parsed.steps
                  : null;
              verifyResult.updatedAt =
                typeof parsed.updatedAt ===
                  'string'
                  ? parsed.updatedAt
                  : null;
            }
          } catch {
            // left as 'unknown'
          }

          sendJson(
            res,
            200,
            verifyResult
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
          req.method === 'POST' &&
          req.url === '/api/tts'
        ) {
          if (!tts) {
            sendJson(
              res,
              501,
              {
                error:
                  'Voice is not configured'
              }
            );
            return;
          }

          const body =
            await readJson(req);

          try {
            const audio =
              await tts.speak(
                body.text
              );

            res.statusCode = 200;
            res.setHeader(
              'content-type',
              audio.contentType ||
                'audio/mpeg'
            );
            res.setHeader(
              'cache-control',
              'no-store'
            );
            res.end(audio.audio);
          } catch (error) {
            sendJson(
              res,
              400,
              {
                error:
                  error.message ||
                  'Cannot synthesize speech'
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
