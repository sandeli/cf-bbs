import { escapeHtml } from './utils';

/**
 * 富文本（WYSIWYG）正文的服务端处理管线，安全优先、零依赖。
 *
 * 存储约定（与 Markdown 管线并行，靠 posts.content_format / messages.body_format 区分）：
 *   content      = sanitizeHtml(编辑器提交的 HTML)          —— 可回编辑器再编辑的源
 *   content_html = linkifyMentions(content)                  —— 展示版（提及变链接）
 *
 * sanitizeHtml 策略：分词 → 白名单重建。只保留编辑器能产生的元素与属性，
 * 危险容器（script/style/iframe…）连内容一并丢弃，未知标签剥标签留文本，
 * 文本与属性值一律转义输出，畸形嵌套由栈式重建自动补齐。绝不透传原始 HTML。
 */

const ALLOWED = new Set([
  'p', 'br', 'hr',
  'h2', 'h3', 'h4', 'h5',
  'strong', 'b', 'em', 'i', 'del', 's',
  'blockquote', 'ul', 'ol', 'li',
  'pre', 'code', 'a', 'img',
  // span 仅作为文字颜色载体存活：buildAttrs 只放行受控的 style="color:…"
  'span',
]);

/* ------------------------------------------------------------------ 文字颜色
 * 颜色是 style 属性里唯一开的口子，边界如下：
 * - 只有 <span>（及被映射成 span 的 <font color>）能承载颜色，其余元素 style 全剥；
 * - style 里只提取 color 一条声明，position/background/url()/expression 等一律丢弃；
 * - 颜色值只接受 #rgb / #rrggbb、rgb()/rgba()（三通道 0–255，丢弃 alpha）、
 *   以及下方命名色表，全部归一化输出为 #rrggbb 小写形式；
 * - 校验靠锚定正则逐项匹配，不做黑名单过滤，任何变形（十六进制实体、注释、
 *   空白夹杂）匹配不上即视为无颜色。
 */
const NAMED_COLORS: Record<string, string> = {
  black: '#000000', silver: '#c0c0c0', gray: '#808080', grey: '#808080',
  white: '#ffffff', maroon: '#800000', red: '#ff0000', purple: '#800080',
  fuchsia: '#ff00ff', green: '#008000', lime: '#00ff00', olive: '#808000',
  yellow: '#ffff00', navy: '#000080', blue: '#0000ff', teal: '#008080',
  aqua: '#00ffff', orange: '#ffa500',
};

const toHex2 = (n: number) => n.toString(16).padStart(2, '0');

/** 把任意颜色写法校验并归一化为 #rrggbb；不合法返回 '' */
export function safeColor(raw: string): string {
  const v = decodeEntities(raw).trim().toLowerCase().replace(/!important\s*$/, '').trim();
  const hex = v.match(/^#([0-9a-f]{6})$/);
  if (hex) return `#${hex[1]}`;
  const hex3 = v.match(/^#([0-9a-f]{3})$/);
  if (hex3) return `#${[...hex3[1]].map((c) => c + c).join('')}`;
  if (NAMED_COLORS[v]) return NAMED_COLORS[v];
  const rgb = v.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/);
  if (rgb) {
    const parts = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    if (parts.every((n) => n >= 0 && n <= 255)) return `#${parts.map(toHex2).join('')}`;
  }
  return '';
}

/** 从 style 属性里只提取 color 声明并校验归一化；无合法颜色返回 '' */
export function styleColorOf(style: string): string {
  let found = '';
  for (const decl of decodeEntities(style).split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    if (decl.slice(0, idx).trim().toLowerCase() !== 'color') continue;
    const color = safeColor(decl.slice(idx + 1));
    if (color) found = color; // 多条 color 时后者生效，与 CSS 一致
  }
  return found;
}

/** 这些元素连同内部内容一起丢弃（留文本会泄露脚本/样式源码或产生交互面） */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'textarea', 'select',
  'button', 'input', 'svg', 'math', 'title', 'noscript', 'template', 'link',
  'meta', 'base', 'audio', 'video', 'source', 'track', 'canvas', 'frame',
  'frameset', 'applet', 'xmp', 'noembed', 'noframes', 'plaintext',
]);

const VOID = new Set(['br', 'hr', 'img']);

/** 与 markdown.ts 的 safeUrl 同一策略：仅 http(s) 与站内路径 */
export function safeRichUrl(raw: string): string {
  const url = decodeEntities(raw).replace(/[\s"'<>`\u0000-\u0020]/g, '');
  if (/^https?:\/\//i.test(url) || (url.startsWith('/') && !url.startsWith('//'))) return url;
  return '#';
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

/** 解码常见命名/数字实体（清洗前先解码，避免 &amp; 被二次转义成 &amp;amp;） */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return m;
        }
      }
      return m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

interface TagToken {
  kind: 'start' | 'end';
  name: string;
  attrs: Map<string, string>;
  selfClosing: boolean;
}

function parseTag(raw: string): TagToken | null {
  const end = raw.startsWith('/');
  const body = end ? raw.slice(1) : raw;
  const nameMatch = body.match(/^\s*([a-zA-Z][a-zA-Z0-9-]*)/);
  if (!nameMatch) return null;
  const name = nameMatch[1].toLowerCase();
  const attrs = new Map<string, string>();
  if (!end) {
    const rest = body.slice(nameMatch[0].length);
    const attrRe = /([a-zA-Z][a-zA-Z0-9-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(rest))) {
      const key = m[1].toLowerCase();
      if (!attrs.has(key)) attrs.set(key, m[2] ?? m[3] ?? m[4] ?? '');
    }
  }
  return { kind: end ? 'end' : 'start', name, attrs, selfClosing: /\/\s*$/.test(body) };
}

/** 把输入切成文本段与标签段（注释 / doctype / 处理指令直接丢弃） */
function* tokenize(input: string): Generator<{ text: string } | { tag: TagToken }> {
  let i = 0;
  const n = input.length;
  while (i < n) {
    const lt = input.indexOf('<', i);
    if (lt === -1) {
      yield { text: input.slice(i) };
      return;
    }
    if (lt > i) yield { text: input.slice(i, lt) };

    if (input.startsWith('<!--', lt)) {
      const close = input.indexOf('-->', lt + 4);
      i = close === -1 ? n : close + 3;
      continue;
    }
    if (input.startsWith('<!', lt) || input.startsWith('<?', lt)) {
      const close = input.indexOf('>', lt + 2);
      i = close === -1 ? n : close + 1;
      continue;
    }
    const gt = input.indexOf('>', lt + 1);
    if (gt === -1) {
      yield { text: input.slice(lt) };
      return;
    }
    const tag = parseTag(input.slice(lt + 1, gt));
    if (tag) yield { tag };
    else yield { text: input.slice(lt, gt + 1) };
    i = gt + 1;
  }
}

function buildAttrs(tag: TagToken): string | null {
  const { name, attrs } = tag;
  if (name === 'a') {
    const href = safeRichUrl(attrs.get('href') ?? '');
    if (href === '#') return null; // 链接不可信 → 剥掉锚点留文本
    const cls = (attrs.get('class') ?? '').trim();
    if (cls === 'mention' && /^\/u\/[\p{L}\p{N}_-]{1,40}$/u.test(href)) {
      return ` href="${escapeHtml(href)}" class="mention"`;
    }
    if (/^https?:\/\//i.test(href)) {
      return ` href="${escapeHtml(href)}" target="_blank" rel="nofollow noopener noreferrer"`;
    }
    return ` href="${escapeHtml(href)}"`;
  }
  if (name === 'img') {
    const src = safeRichUrl(attrs.get('src') ?? '');
    if (src === '#') return null; // 图片源不可信 → 整图丢弃
    const alt = decodeEntities(attrs.get('alt') ?? '').slice(0, 200);
    return ` src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async"`;
  }
  if (name === 'pre') {
    let out = '';
    if ((attrs.get('class') ?? '').trim() === 'code-block') out += ' class="code-block"';
    const lang = (attrs.get('data-lang') ?? '').trim();
    if (/^[a-zA-Z0-9+#._-]{1,24}$/.test(lang)) out += ` data-lang="${escapeHtml(lang)}"`;
    return out;
  }
  if (name === 'code') {
    return (attrs.get('class') ?? '').trim() === 'inline-code' ? ' class="inline-code"' : '';
  }
  if (name === 'span') {
    const color = styleColorOf(attrs.get('style') ?? '');
    // 无合法颜色 → null：调用方剥掉 span 标签、只留内部文本
    return color ? ` style="color:${color}"` : null;
  }
  return '';
}

export function sanitizeHtml(input: string): string {
  if (!input) return '';
  const source = String(input).replace(/\u0000/g, '').slice(0, 60000);
  const out: string[] = [];
  const stack: string[] = [];
  let dropDepth: { name: string; depth: number } | null = null;
  // 被剥掉的无色 span / 无色 font 计数：让它们的结束标签不去误关外层合法 span
  let ignoredSpans = 0;
  let ignoredFonts = 0;
  let fontAsSpan = 0; // 以 span 形式入栈的 font 个数

  const closeTo = (name: string) => {
    const idx = stack.lastIndexOf(name);
    if (idx === -1) return;
    while (stack.length > idx) out.push(`</${stack.pop()}>`);
  };

  for (const token of tokenize(source)) {
    if ('text' in token) {
      if (!dropDepth) out.push(escapeHtml(decodeEntities(token.text)));
      continue;
    }
    const { tag } = token;

    if (dropDepth) {
      if (tag.name === dropDepth.name) {
        if (tag.kind === 'start' && !tag.selfClosing) dropDepth.depth++;
        else if (tag.kind === 'end' && --dropDepth.depth === 0) dropDepth = null;
      }
      continue;
    }

    if (tag.kind === 'start') {
      if (DROP_WITH_CONTENT.has(tag.name)) {
        if (!tag.selfClosing) dropDepth = { name: tag.name, depth: 1 };
        continue;
      }
      if (tag.name === 'font') {
        // 粘贴来源常见的 <font color>：带合法颜色时映射成受控 span 存活，否则剥标签留文本
        const color = safeColor(tag.attrs.get('color') ?? '') || styleColorOf(tag.attrs.get('style') ?? '');
        if (!color) {
          ignoredFonts++;
          continue;
        }
        out.push(`<span style="color:${color}">`);
        if (tag.selfClosing) out.push('</span>');
        else {
          stack.push('span');
          fontAsSpan++;
        }
        continue;
      }
      if (!ALLOWED.has(tag.name)) continue; // 未知标签：剥标签，文本保留
      const attrStr = buildAttrs(tag);
      if (attrStr === null) {
        if (tag.name === 'span') ignoredSpans++; // 无色 span：剥标签留文本
        continue; // a/img 校验不过：剥标签（img 本就无文本）
      }
      if (VOID.has(tag.name)) {
        out.push(`<${tag.name}${attrStr} />`);
        continue;
      }
      // 块级元素开始前先关掉未闭合的 <p>，避免 <p><h3> 这类畸形嵌套
      if (['p', 'h2', 'h3', 'h4', 'h5', 'blockquote', 'ul', 'ol', 'pre', 'hr'].includes(tag.name)) {
        if (stack[stack.length - 1] === 'p') {
          stack.pop();
          out.push('</p>');
        }
      }
      out.push(`<${tag.name}${attrStr}>`);
      if (tag.selfClosing) out.push(`</${tag.name}>`);
      else stack.push(tag.name);
    } else {
      if (tag.name === 'font') {
        if (fontAsSpan > 0) {
          closeTo('span');
          fontAsSpan--;
        } else if (ignoredFonts > 0) ignoredFonts--;
        continue;
      }
      if (tag.name === 'span' && ignoredSpans > 0) {
        ignoredSpans--;
        continue;
      }
      if (!ALLOWED.has(tag.name) || VOID.has(tag.name)) continue;
      closeTo(tag.name);
    }
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join('');
}

/** HTML → 纯文本（摘要 / 提及提取 / 字数校验共用） */
export function htmlToText(html: string): string {
  if (!html) return '';
  const withBreaks = String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h2|h3|h4|h5|li|blockquote|pre|ul|ol|hr)>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n');
  return decodeEntities(withBreaks.replace(/<[^>]*>/g, ''))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function excerptFromHtml(html: string, length = 180): string {
  const plain = htmlToText(html).replace(/\s+/g, ' ').trim();
  return plain.length > length ? plain.slice(0, length) + '…' : plain;
}

/** 提及链接化：只处理不在 <a>/<code>/<pre> 内的文本段，规则与 Markdown 渲染器一致 */
export function linkifyMentions(html: string): string {
  if (!html) return '';
  const parts = html.split(/(<[^>]*>)/g);
  let guard = 0; // >0 表示处于 a/code/pre 内部
  const mentionRe = /(^|[\s(（,，])@([\p{L}\p{N}_]{2,20})/gu;
  return parts
    .map((part) => {
      if (part.startsWith('<')) {
        const m = part.match(/^<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/);
        const name = m?.[1]?.toLowerCase() ?? '';
        if (name === 'a' || name === 'code' || name === 'pre') {
          guard = part.startsWith('</') ? Math.max(0, guard - 1) : guard + 1;
        }
        return part;
      }
      if (guard > 0 || !part.includes('@')) return part;
      return part.replace(
        mentionRe,
        (_m, pre: string, name: string) => `${pre}<a class="mention" href="/u/${name}">@${name}</a>`,
      );
    })
    .join('');
}
