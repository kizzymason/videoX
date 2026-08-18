import pino from 'pino';
import { env } from '@videox/api/config/env';

export const logger = pino({
  level: env.isProd ? 'info' : 'debug',
  base: { service: 'worker' },
  transport: env.isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
      },
});
