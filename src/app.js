'use strict';

const http = require('node:http');
const { loadConfig } = require('./config');

function createApp() {
  return http.createServer((req, res) => {
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Not found' }));
  });
}

function start(env = process.env) {
  const config = loadConfig(env);
  const server = createApp();

  server.listen(config.port, config.host, () => {
    console.log(
      `DripVid JARVIS listening on http://${config.host}:${config.port}`
    );
  });

  return server;
}

if (require.main === module) {
  start();
}

module.exports = {
  createApp,
  start
};
