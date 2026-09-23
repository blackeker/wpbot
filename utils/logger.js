import pino from 'pino';
import fs from 'fs';
import path from 'path';

const sessionPath = process.env.SESSION_PATH || './auth_info_session';
const logFile = path.join(sessionPath, 'app.log');

// Ensure directory exists
if (!fs.existsSync(sessionPath)) {
  fs.mkdirSync(sessionPath, { recursive: true });
}

const streams = [
  { stream: process.stdout },
  { stream: fs.createWriteStream(logFile, { flags: 'a' }) }
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
}, fs.createWriteStream(logFile, { flags: 'a' }));

export function getModuleLogger(moduleName) {
  return logger.child({ module: moduleName });
}

export default logger;
