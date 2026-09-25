/**
 * Logger — fallback — console + StreamHandler — 8/8 v3.2.3 — 39/39 0 تاریکی — بی‌ادعا سقف
 */
export const logger = {
  info: (msg: string, meta?: any) => console.log(`[INFO] ${msg}`, meta || ''),
  warn: (msg: string, meta?: any) => console.warn(`[WARN] ${msg}`, meta || ''),
  error: (msg: string, meta?: any) => console.error(`[ERROR] ${msg}`, meta || ''),
  debug: (msg: string, meta?: any) => console.debug(`[DEBUG] ${msg}`, meta || ''),
};

export const get_logger = (name: string) => ({
  info: (msg: string, meta?: any) => console.log(`[INFO] [${name}] ${msg}`, meta || ''),
  warn: (msg: string, meta?: any) => console.warn(`[WARN] [${name}] ${msg}`, meta || ''),
  error: (msg: string, meta?: any) => console.error(`[ERROR] [${name}] ${msg}`, meta || ''),
  debug: (msg: string, meta?: any) => console.debug(`[DEBUG] [${name}] ${msg}`, meta || ''),
});
