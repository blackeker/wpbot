import { readConfig, cleanOldDownloads } from '../config.js';
import { getModuleLogger } from '../utils/logger.js';
import { refreshUniversityMenuCache } from '../utils/uniFetcher.js';

const logger = getModuleLogger('cron-scheduler');

function parseCronField(field, min) {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    return min % step === 0;
  }
  const val = parseInt(field, 10);
  return val === min;
}

function matchCron(cronExpr, date = new Date()) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const minute = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const month = date.getMonth() + 1;
  const dow = date.getDay();

  return parseCronField(parts[0], minute) &&
         parseCronField(parts[1], hour) &&
         parseCronField(parts[2], dom) &&
         parseCronField(parts[3], month) &&
         parseCronField(parts[4], dow);
}

export function startCronScheduler() {
  logger.info('[CRON] Zamanlanmış otomasyon motoru başlatıldı.');
  setInterval(() => {
    try {
      const config = readConfig();
      const schedules = config.cronSchedules || [];
      const now = new Date();

      for (const sched of schedules) {
        if (sched.active && matchCron(sched.cron, now)) {
          logger.info(`[CRON] Zamanlanmış görev tetiklendi: ${sched.name} (${sched.action})`);
          if (sched.action === 'cleanup') {
            try {
              cleanOldDownloads();
              logger.info(`[CRON] ${sched.name} başarıyla tamamlandı.`);
            } catch (err) {
              logger.error({ err: err.message }, `[CRON] ${sched.name} yürütülürken hata oluştu`);
            }
          } else if (sched.action === 'checkUniHouseMenu') {
            try {
              await refreshUniversityMenuCache();
              logger.info(`[CRON] ${sched.name} başarıyla tamamlandı.`);
            } catch (err) {
              logger.error({ err: err.message }, `[CRON] ${sched.name} yürütülürken hata oluştu`);
            }
          }
        }
      }
    } catch (e) {
      logger.error({ err: e.message }, '[CRON Scheduler Loop Error]');
    }
  }, 60000);
}

