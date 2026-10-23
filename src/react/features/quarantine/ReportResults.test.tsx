import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCallback, useState, type ComponentProps, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuarantineProject, QuarantineSample, QuarantineTest } from "../../../contracts/quarantine";
import { ReportResults } from "./ReportResults";

const tableRender = vi.hoisted(() => vi.fn());
vi.mock("antd", () => ({
  Input: (props: ComponentProps<"input">) => <input {...props} />,
  Select: ({
    value,
    onChange,
    options,
    mode,
    ...props
  }: {
    value: string | string[];
    onChange: (value: string | string[]) => void;
    options: Array<{ value: string; label: string }>;
    mode?: string;
  }) => (
    <select
      {...props}
      multiple={mode === "multiple"}
      value={value}
      onChange={(event) =>
        onChange(
          mode === "multiple" ? Array.from(event.target.selectedOptions, (option) => option.value) : event.target.value,
        )
      }
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Table: ({
    columns,
    dataSource,
  }: {
    columns: Array<{
      dataIndex?: keyof QuarantineSample;
      render?: (value: unknown, sample: QuarantineSample) => ReactNode;
    }>;
    dataSource: QuarantineSample[];
  }) => {
    tableRender();
    return (
      <div>
        {dataSource.map((sample) => (
          <div key={sample.id}>
            {columns.map((column, index) => (
              <span key={index}>
                {column.render ? column.render(undefined, sample) : String(sample[column.dataIndex!] ?? "")}
              </span>
            ))}
          </div>
        ))}
      </div>
    );
  },
  Typography: {
    Title: ({ children }: { children: ReactNode }) => <h3>{children}</h3>,
    Paragraph: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  },
}));

function draft(method: QuarantineTest["method"] = "elisa_mouse"): QuarantineTest {
  return {
    id: "test",
    batchId: "batch",
    method,
    samplingDate: "2026-10-01",
    testDate: "2026-10-02",
    conclusion: "",
    notes: "",
    state: "draft",
    updatedAt: "version",
    retestOf: "",
    correctionOf: "",
    samples: ["s1", "s2"].map((id, index) => ({
      id,
      number: String(index + 1),
      material: "血清",
      sourceIds: [],
      poolCount: 1,
      portionCount: 1,
    })),
    projects: ["甲", "乙"].map((name, index) => ({
      id: `p${index}`,
      name,
      kit: "试剂",
      lot: "批号",
      sampleIds: ["s1", "s2"],
      results: { s1: "negative", s2: "positive" },
      wells: { s1: "A1" },
      nc: "negative",
      pc: "positive",
    })),
  };
}
function Editor({ initial = draft() }: { initial?: QuarantineTest }) {
  const [test, setTest] = useState(initial);
  const change = useCallback((id: string, update: (current: QuarantineProject) => QuarantineProject) => {
    setTest((current) => ({
      ...current,
      projects: current.projects.map((project) => (project.id === id ? update(project) : project)),
    }));
  }, []);
  return (
    <>
      <ReportResults test={test} onProjectChange={change} sectionNumber={3} />
      <output data-testid="saved-shape">{JSON.stringify(test)}</output>
      <button
        onClick={() =>
          setTest((current) => ({
            ...current,
            samples: current.samples.map((sample) => ({ ...sample, number: `新${sample.number}` })),
          }))
        }
      >
        更新样本编号
      </button>
    </>
  );
}

describe("quarantine result editing", () => {
  beforeEach(() => tableRender.mockClear());
  afterEach(cleanup);
  it("renders only the edited project and merges back-to-back edits against the latest project", () => {
    render(<Editor />);
    expect(tableRender).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByRole("textbox", { name: "甲 1 板孔号" }), { target: { value: "B1" } });
    expect(tableRender).toHaveBeenCalledTimes(3);
    act(() => {
      fireEvent.change(screen.getByRole("textbox", { name: "甲 1 板孔号" }), { target: { value: "C1" } });
      fireEvent.change(screen.getByRole("textbox", { name: "甲 2 板孔号" }), { target: { value: "C2" } });
      fireEvent.change(screen.getByRole("combobox", { name: "乙 1 判定" }), { target: { value: "suspect" } });
    });
    const saved = JSON.parse(screen.getByTestId("saved-shape").textContent);
    expect(saved.projects[0].wells).toEqual({ s1: "C1", s2: "C2" });
    expect(saved.projects[1].results).toEqual({ s1: "suspect", s2: "positive" });
    expect(saved.projects[1].wells).toEqual({ s1: "A1" });
    expect(saved.updatedAt).toBe("version");
    fireEvent.click(screen.getByRole("button", { name: "更新样本编号" }));
    expect(screen.getByRole("textbox", { name: "甲 新1 板孔号" })).toHaveValue("C1");
    expect(screen.getByRole("textbox", { name: "乙 新1 板孔号" })).toHaveValue("A1");
  });
  it("keeps the legacy whole-test callback and PCR sample filtering", () => {
    const initial = draft("pcr");
    const onChange = vi.fn();
    render(<ReportResults test={initial} onChange={onChange} sectionNumber={3} />);
    const samplePicker = screen.getByRole("listbox", { name: "适用样本 1" });
    for (const option of Array.from(samplePicker.querySelectorAll("option"))) option.selected = option.value === "s2";
    fireEvent.change(samplePicker);
    expect(onChange).toHaveBeenCalledOnce();
    const updated: QuarantineTest = onChange.mock.calls[0][0];
    expect(updated.projects[0].sampleIds).toEqual(["s2"]);
    expect(updated.projects[0].results).toEqual({ s2: "positive" });
    expect(updated.projects[0].wells).toEqual(initial.projects[0].wells);
    expect(updated.projects[1]).toBe(initial.projects[1]);
  });
  it("retains read-only results and legacy not-tested options", () => {
    const initial = draft();
    initial.projects[0].results.s1 = "not_tested";
    const view = render(<ReportResults test={initial} sectionNumber={3} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    view.rerender(<ReportResults test={initial} sectionNumber={3} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "甲 1 判定" })).toHaveValue("not_tested");
    expect(screen.getByRole("combobox", { name: "甲 NC 判定" })).toHaveValue("negative");
  });
});
