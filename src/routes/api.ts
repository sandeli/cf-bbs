import { get, post } from '../router';
import { toggleBookmark, toggleLike, getTopic, prepareContent } from '../lib/db';
import type { ContentFormat } from '../lib/db';
import { imgbedConfig, uploadToImgbed } from '../lib/imgbed';
import { clusterRateLimit, rateLimit } from '../lib/utils';
import { errorPage } from '../views/pages';

function wantsJson(ctx: { req: Request }): boolean {
  return (ctx.req.headers.get('accept') || '').includes('application/json');
}

get('/api/health', (ctx) => ctx.json({ ok: true, ts: Date.now() }));

post('/api/like', async (ctx) => {
  if (!ctx.user) {
    return wantsJson(ctx) ? ctx.json({ ok: false, error: 'unauthorized' }, 401) : ctx.redirect('/login');
  }
  const type = String(ctx.form?.get('type') || '');
  const id = Number.parseInt(String(ctx.form?.get('id') || ''), 10);
  if ((type !== 'post' && type !== 'topic') || !Number.isFinite(id) || id <= 0) {
    return ctx.json({ ok: false, error: 'bad_request' }, 400);
  }

  const result = await toggleLike(ctx.env, ctx.user.id, type, id);
  if (wantsJson(ctx)) return ctx.json({ ok: true, ...result });

  const back = ctx.req.headers.get('referer') || '/';
  try {
    const url = new URL(back);
    return ctx.redirect(url.pathname + url.search + (url.hash || ''));
  } catch {
    return ctx.redirect('/');
  }
});

post('/api/bookmark', async (ctx) => {
  if (!ctx.user) {
    return wantsJson(ctx) ? ctx.json({ ok: false, error: 'unauthorized' }, 401) : ctx.redirect('/login');
  }
  const topicId = Number.parseInt(String(ctx.form?.get('id') || ''), 10);
  if (!Number.isFinite(topicId) || topicId <= 0) return ctx.json({ ok: false, error: 'bad_request' }, 400);

  const result = await toggleBookmark(ctx.env, ctx.user.id, topicId);
  if (wantsJson(ctx)) return ctx.json({ ok: true, ...result });
  return ctx.redirect(`/t/${topicId}`);
});

post('/api/preview', async (ctx) => {
  // 兼容端点：md 走 Markdown 渲染，html 走 sanitize + 提及链接化（与正式入库管线一致）
  const format: ContentFormat = String(ctx.form?.get('format') || '') === 'html' ? 'html' : 'md';
  const content = String(ctx.form?.get('content') || '').slice(0, format === 'html' ? 60000 : 20000);
  return ctx.json({ ok: true, html: prepareContent(content, format).html });
});

/**
 * 图片上传：浏览器 → 本 Worker → 外部图床（认证码不出服务端）
 * 返回 { ok, url, markdown, html }：旧 textarea 用 markdown，新版富文本编辑器用 html 插入光标处。
 */
post('/api/upload', async (ctx) => {
  if (!ctx.user) return ctx.json({ ok: false, error: 'unauthorized' }, 401);

  const config = imgbedConfig(ctx.env);
  if (!config) return ctx.json({ ok: false, error: 'not_configured' }, 503);

  const entry = ctx.form?.get('file');
  const file = entry && typeof entry === 'object' && 'arrayBuffer' in entry ? (entry as File) : null;
  if (!file || typeof file.size !== 'number' || file.size === 0) {
    return ctx.json({ ok: false, error: 'no_file' }, 400);
  }
  if (file.size > config.maxBytes) {
    return ctx.json({ ok: false, error: 'too_large', maxMb: config.maxMb }, 413);
  }
  if (!/^image\/(png|jpe?g|gif|webp|avif|svg\+xml|bmp|heic|heif)$/i.test(file.type || '')) {
    return ctx.json({ ok: false, error: 'bad_type' }, 415);
  }

  // 每人 30 张 / 10 分钟（图床额度有限，防止被当成公共图床刷）
  const key = `upload:${ctx.user.id}`;
  let verdict: { ok: boolean; retryAfter: number };
  try {
    verdict = await clusterRateLimit(key, 30, 600);
  } catch {
    verdict = rateLimit(key, 30, 600_000);
  }
  if (!verdict.ok) {
    return ctx.json({ ok: false, error: 'rate_limited', retryAfter: verdict.retryAfter }, 429);
  }

  const result = await uploadToImgbed(config, file);
  if (!result.ok) {
    return ctx.json({ ok: false, error: result.error }, result.status || 502);
  }

  const alt = (file.name || 'image').replace(/[[\]]/g, '').slice(0, 60);
  const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return ctx.json({
    ok: true,
    url: result.url,
    markdown: `![${alt}](${result.url})`,
    html: `<img src="${attr(result.url)}" alt="${attr(alt)}" loading="lazy" decoding="async" />`,
  });
});

post('/api/report', async (ctx) => {
  if (!ctx.user) return ctx.redirect('/login');
  const targetType = String(ctx.form?.get('target_type') || 'post');
  const targetId = Number.parseInt(String(ctx.form?.get('target_id') || ''), 10);
  const reason = String(ctx.form?.get('reason') || 'other').slice(0, 40);
  const detail = String(ctx.form?.get('detail') || '').trim().slice(0, 300);
  const back = String(ctx.form?.get('back') || '/');

  if (!['post', 'topic', 'user'].includes(targetType) || !Number.isFinite(targetId)) {
    return ctx.html(errorPage(ctx, 400, ctx.t('error.badRequest')), 400);
  }

  const exists = await ctx.env.DB.prepare(
    "SELECT id FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'pending'",
  )
    .bind(ctx.user.id, targetType, targetId)
    .first();
  if (!exists) {
    await ctx.env.DB.prepare(
      'INSERT INTO reports (reporter_id, target_type, target_id, reason, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(ctx.user.id, targetType, targetId, reason, detail || null, Date.now())
      .run();
  }

  return ctx.redirect(back.startsWith('/') ? back : '/', 'report.success');
});

get('/api/topic/:id', async (ctx) => {
  const id = Number.parseInt(ctx.params.id, 10);
  const topic = await getTopic(ctx.env, id);
  if (!topic) return ctx.json({ ok: false, error: 'not_found' }, 404);
  return ctx.json({
    ok: true,
    topic: {
      id: topic.id,
      title: topic.title,
      replies: topic.reply_count,
      views: topic.views,
      likes: topic.like_count,
      locked: !!topic.is_locked,
    },
  });
});
