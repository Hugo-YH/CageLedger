import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { createElement, memo, useMemo } from "react";
import type { ReactNode } from "react";

const parser = new MarkdownIt({ html: false, breaks: true, linkify: false });
const tags = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "strong",
  "em",
  "s",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
]);

function safeLink(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (["http:", "https:", "mailto:"].includes(url.protocol) && !url.username && !url.password) return value;
  } catch {
    // Relative and unsupported URLs remain readable without becoming navigable.
  }
  return undefined;
}

/** Render only known Markdown tokens as React nodes; never inject HTML or remote images. */
function renderTokens(tokens: Token[], prefix = "markdown"): ReactNode[] {
  let position = 0;
  function read(): ReactNode[] {
    const nodes: ReactNode[] = [];
    while (position < tokens.length) {
      const token = tokens[position++];
      const key = `${prefix}-${position}`;
      if (token.nesting === -1) break;
      if (token.nesting === 1) {
        const children = read();
        if (token.hidden) nodes.push(...children);
        else if (token.tag === "a") {
          const href = safeLink(token.attrGet("href"));
          nodes.push(
            href ? (
              <a key={key} href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span key={key}>{children}</span>
            ),
          );
        } else if (tags.has(token.tag)) {
          const start = token.tag === "ol" ? Number(token.attrGet("start") || 1) : undefined;
          const alignment = ["th", "td"].includes(token.tag)
            ? /^text-align:(left|center|right)$/.exec(token.attrGet("style") || "")?.[1]
            : undefined;
          const node = createElement(
            token.tag,
            { key, ...(start ? { start } : {}), ...(alignment ? { style: { textAlign: alignment } } : {}) },
            children,
          );
          nodes.push(
            token.tag === "table" ? (
              <div key={key} className="feedback-markdown-table" role="region" aria-label="反馈表格" tabIndex={0}>
                {node}
              </div>
            ) : (
              node
            ),
          );
        } else nodes.push(...children);
      } else if (token.type === "inline") nodes.push(...renderTokens(token.children || [], key));
      else if (token.type === "code_inline") nodes.push(<code key={key}>{token.content}</code>);
      else if (token.type === "fence" || token.type === "code_block") {
        nodes.push(
          <pre key={key} role="region" tabIndex={0} aria-label="代码块">
            <code>{token.content}</code>
          </pre>,
        );
      } else if (token.type === "softbreak" || token.type === "hardbreak") nodes.push(<br key={key} />);
      else if (token.type === "hr") nodes.push(<hr key={key} />);
      else if (token.type === "image") {
        nodes.push(
          <span key={key} className="feedback-markdown-image">
            [图片{token.content ? `：${token.content}` : ""}，请查看附件区]
          </span>,
        );
      } else nodes.push(token.content);
    }
    return nodes;
  }
  return read();
}

export const FeedbackMarkdown = memo(function FeedbackMarkdown({ children }: { children: string }) {
  const content = useMemo(() => renderTokens(parser.parse(children, {})), [children]);
  return <div className="feedback-markdown">{content}</div>;
});
