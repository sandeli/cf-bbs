-- 正文格式标记：区分存量 Markdown 与新版富文本（WYSIWYG）正文。
-- 存量行默认 'md'，继续走 renderMarkdown 管线；新编辑器提交的行写 'html'，
-- content 存 sanitize 后的 HTML、content_html 存提及链接化后的展示版。
ALTER TABLE posts ADD COLUMN content_format TEXT NOT NULL DEFAULT 'md';
ALTER TABLE messages ADD COLUMN body_format TEXT NOT NULL DEFAULT 'md';
