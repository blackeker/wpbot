import pino from 'pino';
import fs from 'fs';
import path from 'path';

const logDir = process.env.LOG_DIR || './logs';
const logFile = path.join(logDir, 'app.log');

// Ensure log directory exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Single shared file stream with error listener to prevent Windows file locking collisions
const fileStream = fs.createWriteStream(logFile, { flags: 'a' });
fileStream.on('error', (err) => {
  console.error('[LOGGER STREAM ERROR]:', err?.message || err);
});

const streams = [
  { stream: process.stdout },
  { stream: fileStream }
];

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err
  }
}, pino.multistream(streams));

export const fileLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err
  }
}, fileStream);

export function getModuleLogger(moduleName) {
  return logger.child({ module: moduleName });
}

export default logger;
