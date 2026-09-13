'use strict';

const path = require('node:path');

const {
  createApp,
  createRuntime
} = require('./app');

const {
  createSocialManager
} = require('./social-manager');

const {
  createSocialServer
} = require('./social-http');

function createSocialManagerPath(env) {
  return env.JARVIS_SOCIAL_MANAGER_PATH ||
    path.resolve(
      __dirname,
      '..',
      'data',
      'social-manager.json'
    );
}

function createJarvisServer({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now
} = {}) {
  const runtime = createRuntime({
    env,
    fetchImpl,
    now
  });

  const baseServer = createApp({ runtime });
  const fallbackHandler =
    baseServer.listeners('request')[0];

  const socialManager =
    createSocialManager({
      config: {
        socialManagerPath:
          createSocialManagerPath(env)
      },
      now
    });

  const server = createSocialServer({
    socialManager,
    fallbackHandler
  });

  return {
    runtime,
    socialManager,
    server
  };
}

function start(env = process.env) {
  const {
    runtime,
    server
  } = createJarvisServer({ env });

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
  createJarvisServer,
  createSocialManagerPath,
  start
};
