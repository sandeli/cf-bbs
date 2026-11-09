/* cf-bbs — progressive enhancement (no dependencies) */
(function () {
  'use strict';

  var root = document.documentElement;

  /* ---------------------------------------------------------------- utils */

  function csrf() {
    var m = document.cookie.match(/(?:^|;\s*)bbs_csrf=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function toast(message, type) {
    if (!message) return;
    var el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' toast-error' : '');
    el.textContent = message;
    document.body.appendChild(el);
    requestAnimationFrame(function () {
      el.classList.add('is-visible');
    });
    setTimeout(function () {
      el.classList.remove('is-visible');
      setTimeout(function () {
        el.remove();
      }, 220);
    }, 2200);
  }

  function postForm(form, extraHeaders) {
    var body = new FormData(form);
    var headers = Object.assign(
      { accept: 'application/json', 'x-csrf-token': csrf() },
      extraHeaders || {},
    );
    return fetch(form.action, { method: 'POST', body: body, headers: headers, credentials: 'same-origin' });
  }

  /* ---------------------------------------------------------------- theme */

  function applyTheme(mode) {
    if (mode === 'light' || mode === 'dark') {
      root.setAttribute('data-theme', mode);
    } else {
      root.removeAttribute('data-theme');
    }
    var meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (meta) {
      var dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      meta.setAttribute('content', dark ? '#090c12' : '#ffffff');
    }
  }

  function currentTheme() {
    try {
      var v = localStorage.getItem('cfbbs-theme');
      return v === 'light' || v === 'dark' ? v : 'system';
    } catch (e) {
      return 'system';
    }
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-theme-toggle]');
    if (!btn) return;
    e.preventDefault();
    var order = ['system', 'light', 'dark'];
    var next = order[(order.indexOf(currentTheme()) + 1) % order.length];
    try {
      if (next === 'system') localStorage.removeItem('cfbbs-theme');
      else localStorage.setItem('cfbbs-theme', next);
    } catch (err) {}
    applyTheme(next);
    toast(next === 'system' ? '跟随系统 / System' : next === 'light' ? '浅色模式' : '深色模式');
  });

  /* ---------------------------------------------------------------- mobile nav */

  document.addEventListener('click', function (e) {
    var toggle = e.target.closest('[data-nav-toggle]');
    if (!toggle) return;
    var menu = document.getElementById('mobileMenu');
    if (!menu) return;
    var open = menu.hasAttribute('hidden');
    if (open) menu.removeAttribute('hidden');
    else menu.setAttribute('hidden', '');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  /* ---------------------------------------------------------------- dropdowns */

  document.addEventListener('click', function (e) {
    document.querySelectorAll('details.dropdown[open], details.report-menu[open]').forEach(function (d) {
      if (!d.contains(e.target)) d.removeAttribute('open');
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('details[open]').forEach(function (d) {
        d.removeAttribute('open');
      });
    }
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) {
      var input = document.querySelector('.header-search input, .mobile-search input, .search-big input');
      if (input) {
        e.preventDefault();
        input.focus();
      }
    }
  });

  /* ---------------------------------------------------------------- likes */

  document.addEventListener('submit', function (e) {
    var form = e.target.closest('form.like-form');
    if (!form || !window.fetch) return;
    e.preventDefault();
    postForm(form)
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.ok) {
          if (data.error === 'unauthorized') location.href = '/login';
          return;
        }
        form.classList.toggle('is-liked', data.liked);
        var count = form.querySelector('.like-count');
        if (count) count.textContent = data.count;
      })
      .catch(function () {});
  });

  /* ---------------------------------------------------------------- bookmark */

  document.addEventListener('submit', function (e) {
    var form = e.target.closest('form[data-bookmark]');
    if (!form || !window.fetch) return;
    e.preventDefault();
    postForm(form)
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.ok) return;
        form.classList.toggle('is-active', data.bookmarked);
        var label = form.querySelector('.bookmark-label');
        if (label) {
          label.textContent = data.bookmarked
            ? label.getAttribute('data-on') || '已收藏'
            : label.getAttribute('data-off') || '收藏';
        }
      })
      .catch(function () {});
  });

  /* ---------------------------------------------------------------- confirm */

  document.addEventListener('submit', function (e) {
    var form = e.target.closest('form[data-confirm]');
    if (!form) return;
    if (!window.confirm(form.getAttribute('data-confirm'))) e.preventDefault();
  });

  /* ---------------------------------------------------------------- share */

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-share]');
    if (!btn) return;
    var url = btn.getAttribute('data-share');
    if (navigator.share) {
      navigator.share({ url: url }).catch(function () {});
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(
        function () {
          toast('链接已复制 / Link copied');
        },
        function () {},
      );
    }
  });

  /* ---------------------------------------------------------------- rich editor (WYSIWYG) */

  // 与服务端 src/lib/sanitize.ts 同一白名单口径。前端清洗只为粘贴/插入时
  // 即时呈现干净，所见即所得；入库前服务端会再清洗一遍，前端过滤不是安全防线。
  var RICH_ALLOWED = {
    P: 1, BR: 1, HR: 1, H2: 1, H3: 1, H4: 1, H5: 1, STRONG: 1, B: 1, EM: 1, I: 1,
    DEL: 1, S: 1, BLOCKQUOTE: 1, UL: 1, OL: 1, LI: 1, PRE: 1, CODE: 1, A: 1, IMG: 1,
    SPAN: 1, // 仅作文字颜色载体：只保留校验过的 style="color:#rrggbb"
  };

  // 与服务端 sanitize.ts 的 safeColor 同一口径：#hex / rgb(a) / 命名色 → #rrggbb
  var RICH_NAMED_COLORS = {
    black: '#000000', silver: '#c0c0c0', gray: '#808080', grey: '#808080',
    white: '#ffffff', maroon: '#800000', red: '#ff0000', purple: '#800080',
    fuchsia: '#ff00ff', green: '#008000', lime: '#00ff00', olive: '#808000',
    yellow: '#ffff00', navy: '#000080', blue: '#0000ff', teal: '#008080',
    aqua: '#00ffff', orange: '#ffa500',
  };
  function richSafeColor(raw) {
    var v = String(raw == null ? '' : raw).trim().toLowerCase().replace(/!important\s*$/, '').trim();
    var m = v.match(/^#([0-9a-f]{6})$/);
    if (m) return '#' + m[1];
    m = v.match(/^#([0-9a-f]{3})$/);
    if (m) return '#' + m[1].split('').map(function (c) { return c + c; }).join('');
    if (RICH_NAMED_COLORS[v]) return RICH_NAMED_COLORS[v];
    m = v.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/);
    if (m) {
      var parts = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (parts.every(function (n) { return n >= 0 && n <= 255; })) {
        return '#' + parts.map(function (n) { return ('0' + n.toString(16)).slice(-2); }).join('');
      }
    }
    return '';
  }
  function richStyleColor(style) {
    var found = '';
    String(style || '').split(';').forEach(function (decl) {
      var idx = decl.indexOf(':');
      if (idx === -1) return;
      if (decl.slice(0, idx).trim().toLowerCase() !== 'color') return;
      var color = richSafeColor(decl.slice(idx + 1));
      if (color) found = color;
    });
    return found;
  }
  var RICH_DROP = {
    SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, FORM: 1, TEXTAREA: 1,
    SELECT: 1, BUTTON: 1, INPUT: 1, SVG: 1, MATH: 1, TITLE: 1, NOSCRIPT: 1,
    TEMPLATE: 1, LINK: 1, META: 1, BASE: 1, AUDIO: 1, VIDEO: 1, SOURCE: 1,
    TRACK: 1, CANVAS: 1, FRAME: 1, FRAMESET: 1, APPLET: 1, XMP: 1,
  };

  function escText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escAttr(s) {
    return escText(s).replace(/"/g, '&quot;');
  }

  function richSafeUrl(raw, forImage) {
    var url = String(raw == null ? '' : raw).replace(/[\s"'<>`\u0000-\u0020]/g, '');
    if (/^https?:\/\//i.test(url)) return url;
    if (!forImage && url.charAt(0) === '/' && url.charAt(1) !== '/') return url;
    return '';
  }

  function cleanRichNode(node) {
    var child = node.firstChild;
    while (child) {
      var next = child.nextSibling;
      if (child.nodeType === 1) {
        var tag = child.tagName;
        if (RICH_DROP[tag]) {
          node.removeChild(child);
          child = next;
          continue;
        }
        cleanRichNode(child);
        if (tag === 'FONT') {
          // <font color> 映射成受控颜色 span；无合法颜色则剥标签留内容
          var fcolor = richSafeColor(child.getAttribute('color') || '') || richStyleColor(child.getAttribute('style'));
          if (fcolor) {
            var nspan = document.createElement('span');
            nspan.setAttribute('style', 'color:' + fcolor);
            while (child.firstChild) nspan.appendChild(child.firstChild);
            node.replaceChild(nspan, child);
          } else {
            while (child.firstChild) node.insertBefore(child.firstChild, child);
            node.removeChild(child);
          }
          child = next;
          continue;
        }
        if (!RICH_ALLOWED[tag]) {
          // 未知标签：剥标签，保留内部内容
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          node.removeChild(child);
          child = next;
          continue;
        }
        var keep = {};
        if (tag === 'A') {
          var href = richSafeUrl(child.getAttribute('href'), false);
          if (href) {
            keep.href = href;
            keep.target = '_blank';
            keep.rel = 'nofollow noopener noreferrer';
          }
        } else if (tag === 'IMG') {
          var src = richSafeUrl(child.getAttribute('src'), true);
          if (!src) {
            node.removeChild(child);
            child = next;
            continue;
          }
          keep.src = src;
          var alt = child.getAttribute('alt');
          if (alt) keep.alt = alt;
          keep.loading = 'lazy';
        } else if (tag === 'PRE') {
          if (child.getAttribute('class') === 'code-block') keep['class'] = 'code-block';
          var lang = child.getAttribute('data-lang');
          if (lang && /^[a-z0-9+#-]{1,20}$/i.test(lang)) keep['data-lang'] = lang;
        } else if (tag === 'CODE') {
          if (child.getAttribute('class') === 'inline-code') keep['class'] = 'inline-code';
        } else if (tag === 'SPAN') {
          var scolor = richStyleColor(child.getAttribute('style'));
          if (scolor) keep.style = 'color:' + scolor;
        }
        Array.prototype.slice.call(child.attributes || []).forEach(function (a) {
          if (!(a.name in keep)) child.removeAttribute(a.name);
        });
        Object.keys(keep).forEach(function (k) {
          child.setAttribute(k, keep[k]);
        });
        if (tag === 'SPAN' && !keep.style) {
          // 无合法颜色的 span 没有存在意义：剥标签留内容
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          node.removeChild(child);
          child = next;
          continue;
        }
      } else if (child.nodeType !== 3) {
        node.removeChild(child);
      }
      child = next;
    }
  }

  function cleanRichHtml(html) {
    var box = document.createElement('div');
    box.innerHTML = html || '';
    cleanRichNode(box);
    return box.innerHTML;
  }

  /* ------------------------------------------------------------ editor registry */

  var richEditors = [];

  function editorByWrap(wrap) {
    for (var i = 0; i < richEditors.length; i++) if (richEditors[i].wrap === wrap) return richEditors[i];
    return null;
  }
  function editorByHiddenId(id) {
    for (var i = 0; i < richEditors.length; i++) if (richEditors[i].hidden.id === id) return richEditors[i];
    return null;
  }

  function richTextLength(body) {
    var t = body.innerText || body.textContent || '';
    return t.replace(/\n+$/, '').length;
  }

  function syncRichEditor(ed) {
    ed.hidden.value = ed.body.innerHTML;
    var target = document.querySelector('[data-counter-for="' + ed.hidden.id + '"]');
    if (target) target.textContent = richTextLength(ed.body) + ' / ' + ed.max;
    var empty = !(ed.body.textContent || '').trim() && !ed.body.querySelector('img, pre, hr');
    ed.body.classList.toggle('is-empty', empty);
  }

  function saveRange(ed) {
    var sel = window.getSelection();
    if (sel && sel.rangeCount && ed.body.contains(sel.anchorNode)) {
      ed.range = sel.getRangeAt(0).cloneRange();
    }
  }
  function restoreRange(ed) {
    ed.body.focus();
    if (!ed.range) return;
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(ed.range);
  }
  function currentRange(ed) {
    var sel = window.getSelection();
    if (sel && sel.rangeCount && ed.body.contains(sel.anchorNode)) return sel.getRangeAt(0);
    return null;
  }
  function insertHtmlAtCaret(ed, html) {
    restoreRange(ed);
    document.execCommand('insertHTML', false, html);
    saveRange(ed);
    syncRichEditor(ed);
  }

  function blockAncestor(ed, tags) {
    var sel = window.getSelection();
    var node = sel && sel.rangeCount ? sel.anchorNode : null;
    if (!node || !ed.body.contains(node)) node = ed.range ? ed.range.startContainer : null;
    while (node && node !== ed.body) {
      if (node.nodeType === 1 && tags.indexOf(node.tagName) !== -1) return node;
      node = node.parentNode;
    }
    return null;
  }

  function refreshToolbar(ed) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || !ed.body.contains(sel.anchorNode)) return;
    ed.wrap.querySelectorAll('[data-cmd]').forEach(function (btn) {
      var cmd = btn.getAttribute('data-cmd');
      var active = false;
      try {
        if (cmd === 'bold') active = document.queryCommandState('bold');
        else if (cmd === 'italic') active = document.queryCommandState('italic');
        else if (cmd === 'strike') active = document.queryCommandState('strikeThrough');
        else if (cmd === 'ul') active = document.queryCommandState('insertUnorderedList');
        else if (cmd === 'ol') active = document.queryCommandState('insertOrderedList');
        else if (cmd === 'heading') active = !!blockAncestor(ed, ['H2', 'H3', 'H4', 'H5']);
        else if (cmd === 'quote') active = !!blockAncestor(ed, ['BLOCKQUOTE']);
        else if (cmd === 'codeblock') active = !!blockAncestor(ed, ['PRE']);
        else if (cmd === 'inlinecode') active = !!blockAncestor(ed, ['CODE']) && !blockAncestor(ed, ['PRE']);
      } catch (err) {}
      btn.classList.toggle('is-active', !!active);
    });
  }

  /* ------------------------------------------------------------ commands */

  function toggleInlineCode(ed) {
    restoreRange(ed);
    var codeEl = blockAncestor(ed, ['CODE']);
    if (codeEl && !blockAncestor(ed, ['PRE'])) {
      var parent = codeEl.parentNode;
      while (codeEl.firstChild) parent.insertBefore(codeEl.firstChild, codeEl);
      parent.removeChild(codeEl);
      syncRichEditor(ed);
      return;
    }
    var range = currentRange(ed);
    if (!range) return;
    if (range.collapsed) {
      insertHtmlAtCaret(ed, '<code class="inline-code">code</code>');
      return;
    }
    var code = document.createElement('code');
    code.className = 'inline-code';
    try {
      code.appendChild(range.extractContents());
    } catch (err) {
      return;
    }
    range.insertNode(code);
    var after = document.createRange();
    after.setStartAfter(code);
    after.collapse(true);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(after);
    saveRange(ed);
    syncRichEditor(ed);
  }

  function toggleCodeBlock(ed) {
    restoreRange(ed);
    var pre = blockAncestor(ed, ['PRE']);
    if (pre) {
      var p = document.createElement('p');
      p.textContent = pre.textContent;
      pre.parentNode.replaceChild(p, pre);
      syncRichEditor(ed);
      return;
    }
    var range = currentRange(ed);
    if (!range) return;
    var text = range.collapsed ? 'code' : range.toString();
    var block = document.createElement('pre');
    block.className = 'code-block';
    var inner = document.createElement('code');
    inner.textContent = text;
    block.appendChild(inner);
    range.deleteContents();
    range.insertNode(block);
    saveRange(ed);
    syncRichEditor(ed);
  }

  function doLink(ed) {
    var url = window.prompt('链接地址 / Link URL', 'https://');
    if (url == null) return;
    var safe = richSafeUrl(url, false);
    if (!safe) {
      toast('链接无效 / Invalid link', 'error');
      return;
    }
    restoreRange(ed);
    var range = currentRange(ed);
    if (!range || range.collapsed) {
      insertHtmlAtCaret(
        ed,
        '<a href="' + escAttr(safe) + '" target="_blank" rel="nofollow noopener noreferrer">' + escText(safe) + '</a>',
      );
      return;
    }
    document.execCommand('createLink', false, safe);
    var anchor = blockAncestor(ed, ['A']);
    if (anchor) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'nofollow noopener noreferrer');
    }
    saveRange(ed);
    syncRichEditor(ed);
  }

  function runRichCommand(ed, cmd, btn) {
    ed.body.focus();
    if (cmd === 'bold') document.execCommand('bold');
    else if (cmd === 'italic') document.execCommand('italic');
    else if (cmd === 'strike') document.execCommand('strikeThrough');
    else if (cmd === 'ul') document.execCommand('insertUnorderedList');
    else if (cmd === 'ol') document.execCommand('insertOrderedList');
    else if (cmd === 'heading') document.execCommand('formatBlock', false, blockAncestor(ed, ['H2', 'H3', 'H4', 'H5']) ? 'P' : 'H3');
    else if (cmd === 'quote') document.execCommand('formatBlock', false, blockAncestor(ed, ['BLOCKQUOTE']) ? 'P' : 'BLOCKQUOTE');
    else if (cmd === 'inlinecode') toggleInlineCode(ed);
    else if (cmd === 'codeblock') toggleCodeBlock(ed);
    else if (cmd === 'link') doLink(ed);
    else if (cmd === 'image') {
      if (btn.getAttribute('data-imgbed')) {
        pickImages(ed, btn);
      } else {
        var url = window.prompt('图片地址 / Image URL', 'https://');
        if (url == null) return;
        var safe = richSafeUrl(url, true);
        if (!safe) {
          toast('图片地址无效 / Invalid image URL', 'error');
          return;
        }
        insertHtmlAtCaret(ed, '<img src="' + escAttr(safe) + '" alt="" loading="lazy">');
      }
      return;
    } else {
      return;
    }
    saveRange(ed);
    syncRichEditor(ed);
    refreshToolbar(ed);
  }

  // 工具栏按下时不让编辑区丢选区
  document.addEventListener('mousedown', function (e) {
    if (e.target.closest('[data-cmd], [data-color-btn], [data-color]')) e.preventDefault();
  });

  /* ------------------------------------------------------------ text color */

  function unwrapEl(el) {
    var p = el.parentNode;
    if (!p) return;
    while (el.firstChild) p.insertBefore(el.firstChild, el);
    p.removeChild(el);
  }

  function colorSpanAncestor(ed) {
    var sel = window.getSelection();
    var node = sel && sel.rangeCount ? sel.anchorNode : null;
    if (!node || !ed.body.contains(node)) node = ed.range ? ed.range.startContainer : null;
    while (node && node !== ed.body) {
      if (node.nodeType === 1 && node.tagName === 'SPAN' && node.style && node.style.color) return node;
      node = node.parentNode;
    }
    return null;
  }

  function applyTextColor(ed, color) {
    restoreRange(ed);
    if (!color) {
      // 「默认」：拆掉选区所在的颜色 span（只去颜色，不动加粗等其他格式）
      var existing = colorSpanAncestor(ed);
      if (existing) unwrapEl(existing);
      saveRange(ed);
      syncRichEditor(ed);
      return;
    }
    var range = currentRange(ed);
    if (!range) return;
    var span = document.createElement('span');
    span.setAttribute('style', 'color:' + color);
    var sel = window.getSelection();
    if (range.collapsed) {
      // 无选区：在光标处放一个带颜色的零宽占位，后续输入即为该颜色
      span.appendChild(document.createTextNode('​'));
      range.insertNode(span);
      var inside = document.createRange();
      inside.setStart(span.firstChild, 1);
      inside.collapse(true);
      sel.removeAllRanges();
      sel.addRange(inside);
    } else {
      try {
        span.appendChild(range.extractContents());
      } catch (err) {
        return;
      }
      range.insertNode(span);
      var after = document.createRange();
      after.setStartAfter(span);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
    }
    saveRange(ed);
    syncRichEditor(ed);
  }

  function closeColorPops(except) {
    document.querySelectorAll('[data-color-pop]').forEach(function (p) {
      if (p !== except) p.setAttribute('hidden', '');
    });
  }

  document.addEventListener('click', function (e) {
    var toggle = e.target.closest('[data-color-btn]');
    if (toggle) {
      var wrap = toggle.closest('[data-rich-editor]');
      var pop = wrap ? wrap.querySelector('[data-color-pop]') : null;
      if (pop) {
        var willOpen = pop.hasAttribute('hidden');
        closeColorPops(pop);
        if (willOpen) pop.removeAttribute('hidden');
        else pop.setAttribute('hidden', '');
      }
      return;
    }
    var sw = e.target.closest('[data-color]');
    if (sw) {
      var swWrap = sw.closest('[data-rich-editor]');
      var swEd = swWrap ? editorByWrap(swWrap) : null;
      var swPop = sw.closest('[data-color-pop]');
      if (swPop) swPop.setAttribute('hidden', '');
      if (swEd) applyTextColor(swEd, sw.getAttribute('data-color') || '');
      return;
    }
    if (!e.target.closest('.tool-color')) closeColorPops(null);
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-cmd]');
    if (!btn) return;
    var wrap = btn.closest('[data-rich-editor]');
    var ed = wrap ? editorByWrap(wrap) : null;
    if (!ed) return;
    e.preventDefault();
    runRichCommand(ed, btn.getAttribute('data-cmd'), btn);
  });

  /* ------------------------------------------------------------ image upload */

  // 服务端上限见 IMGBED_MAX_MB，这里只做提前提示
  var IMG_MAX_MB = 8;

  function uploadErrorText(data) {
    var map = {
      unauthorized: '请先登录 / Please sign in',
      not_configured: '图床未配置 / Image host not configured',
      no_file: '没有选择文件 / No file selected',
      too_large: '图片超过 ' + (data.maxMb || IMG_MAX_MB) + 'MB / Image too large',
      bad_type: '仅支持图片 / Images only',
      auth: '图床认证失败，请检查认证码 / Image host auth failed',
      timeout: '上传超时，请重试 / Upload timed out',
      rate_limited: '上传太频繁，请稍后再试 / Too many uploads',
      upstream: '图床返回异常 / Image host error',
    };
    return map[data.error] || '上传失败 / Upload failed';
  }

  function uploadOne(file, ed) {
    if (!/^image\//.test(file.type || '')) {
      toast('仅支持图片 / Images only', 'error');
      return Promise.resolve();
    }
    if (file.size > IMG_MAX_MB * 1024 * 1024) {
      toast('图片超过 ' + IMG_MAX_MB + 'MB / Image too large', 'error');
      return Promise.resolve();
    }
    var fd = new FormData();
    fd.append('file', file);
    return fetch('/api/upload', {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      headers: { accept: 'application/json', 'x-csrf-token': csrf() },
    })
      .then(function (r) {
        return r.json().catch(function () {
          return { ok: false, error: 'upstream' };
        });
      })
      .then(function (data) {
        if (!data.ok) {
          toast(uploadErrorText(data), 'error');
          return;
        }
        // /api/upload 返回 html 字段（已按白名单拼好的 <img>）；兜底用 url 自拼
        var html = data.html || '<img src="' + escAttr(data.url || '') + '" alt="" loading="lazy">';
        insertHtmlAtCaret(ed, html);
        toast('已插入图片 / Image inserted');
      })
      .catch(function () {
        toast('上传失败，请检查网络 / Upload failed', 'error');
      });
  }

  function uploadImages(files, ed, btn) {
    var list = [];
    for (var i = 0; i < files.length; i++) {
      if (files[i] && /^image\//.test(files[i].type || '')) list.push(files[i]);
    }
    if (!list.length) {
      toast('仅支持图片 / Images only', 'error');
      return;
    }
    if (btn) btn.disabled = true;
    toast(list.length > 1 ? '正在上传 ' + list.length + ' 张… / Uploading' : '正在上传… / Uploading');
    // 串行上传，保证插入顺序与选择顺序一致
    var chain = Promise.resolve();
    list.forEach(function (file) {
      chain = chain.then(function () {
        return uploadOne(file, ed);
      });
    });
    chain.then(function () {
      if (btn) btn.disabled = false;
    });
  }

  function pickImages(ed, btn) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      uploadImages(input.files || [], ed, btn);
      input.remove();
    });
    input.click();
  }

  /* ------------------------------------------------------------ init */

  document.querySelectorAll('[data-rich-editor]').forEach(function (wrap) {
    var body = wrap.querySelector('.rich-editor-body');
    var hidden = wrap.querySelector('textarea');
    if (!body || !hidden) return;
    var counter = document.querySelector('[data-counter-for="' + hidden.id + '"]');
    var max = '20000';
    if (counter) {
      var m = counter.textContent.match(/\/\s*(\d+)/);
      if (m) max = m[1];
    }
    var ed = { wrap: wrap, body: body, hidden: hidden, range: null, max: max };
    richEditors.push(ed);

    body.addEventListener('input', function () {
      syncRichEditor(ed);
      saveRange(ed);
    });
    body.addEventListener('keyup', function () {
      saveRange(ed);
      refreshToolbar(ed);
    });
    body.addEventListener('mouseup', function () {
      saveRange(ed);
      refreshToolbar(ed);
    });

    body.addEventListener('paste', function (ev) {
      var data = ev.clipboardData;
      if (!data) return;
      var files = [];
      for (var i = 0; i < data.items.length; i++) {
        var item = data.items[i];
        if (item.kind === 'file') {
          var f = item.getAsFile();
          if (f && /^image\//.test(f.type || '')) files.push(f);
        }
      }
      if (files.length && wrap.querySelector('[data-imgbed]')) {
        ev.preventDefault();
        uploadImages(files, ed, null);
        return;
      }
      var html = '';
      try {
        html = data.getData('text/html');
      } catch (err) {}
      if (html) {
        // 带格式粘贴：按服务端同一白名单就地清洗后再插入（服务端入库仍会再清洗）
        ev.preventDefault();
        insertHtmlAtCaret(ed, cleanRichHtml(html));
      }
      // 纯文本粘贴走浏览器默认行为（自动转义、安全）
    });

    body.addEventListener('dragover', function (ev) {
      if (!ev.dataTransfer) return;
      ev.preventDefault();
      body.classList.add('is-drop');
    });
    body.addEventListener('dragleave', function () {
      body.classList.remove('is-drop');
    });
    body.addEventListener('drop', function (ev) {
      if (!ev.dataTransfer) return;
      body.classList.remove('is-drop');
      var files = ev.dataTransfer.files;
      if (files && files.length && wrap.querySelector('[data-imgbed]')) {
        ev.preventDefault();
        uploadImages(files, ed, null);
      }
    });

    syncRichEditor(ed);
  });

  document.addEventListener('selectionchange', function () {
    richEditors.forEach(function (ed) {
      saveRange(ed);
      refreshToolbar(ed);
    });
  });

  // 提交前兜底同步（input 事件已保持同步，这里防程序化改动漏网）
  document.addEventListener(
    'submit',
    function (e) {
      richEditors.forEach(function (ed) {
        if (e.target.contains(ed.wrap)) syncRichEditor(ed);
      });
    },
    true,
  );

  /* ------------------------------------------------------------ plain textarea counters */

  // 非富文本的 textarea（如后台/资料表单）仍用字符计数
  function updateCounter(el) {
    var target = document.querySelector('[data-counter-for="' + el.id + '"]');
    if (!target) return;
    var max = el.getAttribute('maxlength') || '20000';
    target.textContent = el.value.length + ' / ' + max;
  }

  document.querySelectorAll('textarea[maxlength]').forEach(function (el) {
    if (el.closest('[data-rich-editor]')) return;
    updateCounter(el);
    el.addEventListener('input', function () {
      updateCounter(el);
    });
  });

  /* ------------------------------------------------------------ quote reply */

  var replyEd = editorByHiddenId('replyContent');
  var replyToInput = document.getElementById('replyToInput');

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-quote-post]');
    if (!btn || !replyEd) return;
    e.preventDefault();
    var user = btn.getAttribute('data-quote-user');
    if (replyToInput) replyToInput.value = btn.getAttribute('data-quote-post');
    // 引用以 blockquote 插入回帖编辑器开头，所见即所得；@提及由服务端从正文提取
    replyEd.body.focus();
    var range = document.createRange();
    range.selectNodeContents(replyEd.body);
    range.collapse(true);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    replyEd.range = range.cloneRange();
    insertHtmlAtCaret(replyEd, '<blockquote><p>@' + escText(user) + '</p></blockquote><p><br></p>');
    var form = document.getElementById('replyForm');
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  if (replyEd) {
    replyEd.body.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        var form = document.getElementById('replyForm');
        if (form) form.requestSubmit();
      }
    });
  }

  /* ---------------------------------------------------------------- 草稿自动保存 */

  // 规则：/new 页的标题+正文、主题回复框、私信输入框，按路径维度存 localStorage
  // 富文本草稿存编辑器 innerHTML（恢复时经同一白名单清洗），标题存纯文本
  function bindTextDraft(el, key) {
    try {
      var saved = localStorage.getItem(key);
      if (saved && !el.value) el.value = saved;
    } catch (e) {}
    var timer = null;
    el.addEventListener('input', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        try {
          if (el.value.trim()) localStorage.setItem(key, el.value);
          else localStorage.removeItem(key);
        } catch (e) {}
      }, 600);
    });
    if (el.form) {
      el.form.addEventListener('submit', function () {
        try {
          localStorage.removeItem(key);
        } catch (e) {}
      });
    }
  }

  function bindEditorDraft(ed, key) {
    try {
      var saved = localStorage.getItem(key);
      if (saved && !(ed.body.textContent || '').trim() && !ed.body.querySelector('img')) {
        ed.body.innerHTML = cleanRichHtml(saved);
        syncRichEditor(ed);
      }
    } catch (e) {}
    var timer = null;
    ed.body.addEventListener('input', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        try {
          if ((ed.body.textContent || '').trim()) localStorage.setItem(key, ed.body.innerHTML);
          else localStorage.removeItem(key);
        } catch (e) {}
      }, 600);
    });
    var form = ed.wrap.closest('form');
    if (form) {
      form.addEventListener('submit', function () {
        try {
          localStorage.removeItem(key);
        } catch (e) {}
      });
    }
  }

  var newTitle = document.getElementById('title');
  var newEd = editorByHiddenId('content');
  if (newEd && newTitle) {
    bindTextDraft(newTitle, 'cfbbs-draft:new:title');
    bindEditorDraft(newEd, 'cfbbs-draft:new:content');
  }
  var topicMatch = location.pathname.match(/^\/t\/(\d+)/);
  if (replyEd && topicMatch) bindEditorDraft(replyEd, 'cfbbs-draft:reply:' + topicMatch[1]);
  var dmWrap = document.querySelector('form.dm-compose [data-rich-editor]');
  if (dmWrap) {
    var dmEd = editorByWrap(dmWrap);
    if (dmEd) bindEditorDraft(dmEd, 'cfbbs-draft:dm:' + location.pathname);
  }


  /* ---------------------------------------------------------------- auto-grow */

  document.querySelectorAll('textarea.auto-grow').forEach(function (el) {
    var resize = function () {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 420) + 'px';
    };
    el.addEventListener('input', resize);
    resize();
  });
})();
