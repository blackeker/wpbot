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
  timestamp: pino.stdTimeFunctions.isoTime
}, pino.multidest(streams));

export const fileLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime
}, fs.createWriteStream(logFile, { flags: 'a' }));

export default logger;
