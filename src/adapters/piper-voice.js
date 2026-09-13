'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  execFileSync
} = require('node:child_process');

function defaultCommandExists(command) {
  if (!command) {
    return false;
  }

  if (
    command.includes('/') ||
    command.includes('\\')
  ) {
    return fs.existsSync(command);
  }

  const checker =
    process.platform === 'win32'
      ? 'where'
      : 'which';

  try {
    execFileSync(checker, [command], {
      stdio: 'ignore'
    });
    return true;
  } catch {
    return false;
  }
}

function createPiperVoiceAdapter({
  config,
  execFileSyncImpl = execFileSync,
  commandExists = defaultCommandExists
}) {
  function validate() {
    if (!config.piperModel) {
      return 'Piper voice model is not configured';
    }

    if (!fs.existsSync(config.piperModel)) {
      return 'Piper voice model is missing';
    }

    if (!commandExists(config.piperBin)) {
      return 'Piper binary is missing';
    }

    return null;
  }

  async function health() {
    const startedAt = Date.now();
    const error = validate();

    return {
      name: 'voice',
      status: error ? 'offline' : 'online',
      provider: 'piper',
      mode: 'offline',
      voiceId:
        config.piperVoiceId ||
        path.basename(config.piperModel || ''),
      error,
      latencyMs: Date.now() - startedAt
    };
  }

  async function speak(text) {
    const content =
      String(text || '').trim();

    if (!content) {
      throw new Error(
        'Cannot synthesize empty text'
      );
    }

    const validationError = validate();

    if (validationError) {
      throw new Error(validationError);
    }

    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'jarvis-piper-')
    );
    const outputFile =
      path.join(tempDir, 'speech.wav');

    try {
      execFileSyncImpl(
        config.piperBin || 'piper',
        [
          '--model',
          config.piperModel,
          '--output_file',
          outputFile
        ],
        {
          input: content,
          timeout:
            Math.max(
              1000,
              Number(config.requestTimeoutMs) ||
                3000
            ) * 4,
          maxBuffer:
            8 * 1024 * 1024
        }
      );

      return {
        contentType: 'audio/wav',
        audio: fs.readFileSync(outputFile)
      };
    } finally {
      fs.rmSync(tempDir, {
        recursive: true,
        force: true
      });
    }
  }

  return {
    health,
    speak
  };
}

module.exports = {
  createPiperVoiceAdapter
};
