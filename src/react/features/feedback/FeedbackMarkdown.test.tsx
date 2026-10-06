import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { FeedbackMarkdown } from "./FeedbackMarkdown";

afterEach(cleanup);

it("renders historical issue headings, nested lists, emphasis and ordinary line breaks", () => {
  const { container } = render(
    <FeedbackMarkdown>
      {
        "## 反馈信息\n\n- 提出人：张三\n- 类型：**功能建议**\n  - 补充说明\n\n## 问题与需求\n\n3. 第一项\n4. *第二项*\n\n第一行\n第二行\n\n> 处理记录\n\n~~旧方案~~"
      }
    </FeedbackMarkdown>,
  );
  expect(screen.getByRole("heading", { name: "反馈信息", level: 2 })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "问题与需求", level: 2 })).toBeInTheDocument();
  expect(container.querySelector("ul ul li")).toHaveTextContent("补充说明");
  expect(container.querySelector("strong")).toHaveTextContent("功能建议");
  expect(container.querySelector("ol")).toHaveAttribute("start", "3");
  expect(container.querySelector("em")).toHaveTextContent("第二项");
  expect(container.querySelector("blockquote")).toHaveTextContent("处理记录");
  expect(container.querySelector("s")).toHaveTextContent("旧方案");
  expect(container.querySelector("p br")).toBeInTheDocument();
});

it("renders tables and code in named, keyboard reachable scroll containers", () => {
  const { container } = render(
    <FeedbackMarkdown>
      {
        "| 项目 | 结果 |\n| --- | ---: |\n| 保存 | 失败 |\n\n```html\n<script>alert(1)</script>\n```\n\n`x < y`\n\n    缩进代码"
      }
    </FeedbackMarkdown>,
  );
  expect(screen.getByRole("region", { name: "反馈表格" })).toHaveAttribute("tabindex", "0");
  expect(screen.getByRole("columnheader", { name: "项目" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "失败" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "失败" })).toHaveStyle({ textAlign: "right" });
  expect(screen.getAllByLabelText("代码块")).toHaveLength(2);
  expect(screen.getAllByLabelText("代码块")[0]).toHaveTextContent("<script>alert(1)</script>");
  expect(container.querySelector("script")).toBeNull();
  expect(screen.getByText("x < y").tagName).toBe("CODE");
});

it("never injects raw HTML, loads Markdown images or enables unsafe links", () => {
  const { container } = render(
    <FeedbackMarkdown>
      {
        '<img src=x onerror=alert(1)> 原始反馈\n\n<iframe src="https://example.com"></iframe>\n\n![截图](https://example.com/private.png)\n\n[脚本](javascript:alert%281%29) [数据](data:text/html,evil) [相对地址](/attachments/private) [凭据](https://user:password@example.com) [官网](https://example.com/docs)'
      }
    </FeedbackMarkdown>,
  );
  expect(screen.getByText(/<img src=x onerror=alert\(1\)> 原始反馈/)).toBeInTheDocument();
  expect(container.querySelector("img, iframe, script")).toBeNull();
  expect(screen.getByText("[图片：截图，请查看附件区]")).toBeInTheDocument();
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByRole("link", { name: "官网" })).toHaveAttribute("href", "https://example.com/docs");
  expect(screen.getByRole("link", { name: "官网" })).toHaveAttribute("rel", "noopener noreferrer");
});

it("keeps plain text readable and updates content when a different detail is selected", () => {
  const view = render(<FeedbackMarkdown>{"普通反馈\n保留换行"}</FeedbackMarkdown>);
  expect(screen.getByText(/普通反馈/)).toHaveTextContent("普通反馈保留换行");
  view.rerender(<FeedbackMarkdown>{"## 新的反馈\n\n新的正文"}</FeedbackMarkdown>);
  expect(screen.queryByText(/普通反馈/)).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "新的反馈" })).toBeInTheDocument();
});
