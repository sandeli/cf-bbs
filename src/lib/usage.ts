import type { Env } from '../env';
import { all, first } from './db';

/** 站点上线日（Asia/Shanghai）。建站天数以此为第 1 天起算，改站龄只需改这一处。 */
export const SITE_LAUNCH_DATE = '2026-11-09';

export interface SiteUsage {
  /** 数据库物理大小（字节）；D1 不开放 page_count 等 pragma，取不到时为 null */
  dbBytes: number | null;
  /** 退路口径：全库业务表行数之和（排除 sqlite 内部表与 FTS 影子表）；取不到为 null */
  dbRows: number | null;
}

/** 给定时刻在 Asia/Shanghai 的日历日（YYYY-MM-DD） */
export function shanghaiDay(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 本站已运行天数：上线当天算第 1 天（按 Asia/Shanghai 日历日差 + 1） */
export function siteRunningDays(now: Date = new Date()): number {
  const today = shanghaiDay(now);
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${SITE_LAUNCH_DATE}T00:00:00Z`);
  return Math.max(1, Math.floor(ms / 86_400_000) + 1);
}

/** 页脚用量：数据库物理大小。任一查询失败由调用方兜底为 null。 */
export async function getSiteUsage(env: Env): Promise<SiteUsage> {
  // 数据库大小首选 pragma 物理页数；但 D1 的授权器封了 page_count/page_size/dbstat
  // （本地 miniflare 实测同为 SQLITE_AUTH），实际走退路：业务表行数之和。
  let dbBytes: number | null = null;
  try {
    const row = await first<{ bytes: number }>(
      env,
      'SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()',
    );
    if (row && typeof row.bytes === 'number' && row.bytes >= 0) dbBytes = row.bytes;
  } catch {
    dbBytes = null;
  }
  let dbRows: number | null = null;
  if (dbBytes == null) {
    try {
      // 排除：sqlite 内部表、D1 内部表（_cf_ 前缀，部分还读不了）、
      // FTS5 虚拟表本体及其影子表（<名>_data/_idx/_content/_docsize/_config，避免重复计数）
      const masters = await all<{ name: string; sql: string | null }>(
        env,
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'",
      );
      const ftsNames = new Set(masters.filter((t) => /using\s+fts5/i.test(t.sql ?? '')).map((t) => t.name));
      let total = 0;
      for (const { name } of masters) {
        if (ftsNames.has(name)) continue;
        if ([...ftsNames].some((f) => name.startsWith(`${f}_`))) continue;
        try {
          const row = await first<{ n: number }>(env, `SELECT COUNT(*) AS n FROM "${name.replaceAll('"', '""')}"`);
          total += row?.n ?? 0;
        } catch {
          // 单表读不了（个别 D1 内部表会 SQLITE_AUTH）就跳过，不拖垮整项
        }
      }
      dbRows = total;
    } catch {
      dbRows = null;
    }
  }
  return {
    dbBytes,
    dbRows,
  };
}
