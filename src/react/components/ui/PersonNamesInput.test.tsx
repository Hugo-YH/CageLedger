import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { PersonNamesInput } from "./PersonNamesInput";

it("shows formatted names without changing the raw value on focus or blur", () => {
  const onChange = vi.fn();
  const { rerender } = render(<PersonNamesInput aria-label="负责人" value="陈晓卿；李壮" onChange={onChange} />);
  const input = screen.getByRole("textbox", { name: "负责人" });
  expect(input).toHaveValue("陈晓卿、李壮");
  fireEvent.focus(input);
  expect(input).toHaveValue("陈晓卿；李壮");
  fireEvent.blur(input);
  expect(input).toHaveValue("陈晓卿、李壮");
  expect(onChange).not.toHaveBeenCalled();
  rerender(<PersonNamesInput aria-label="负责人" value="Mary Jane；Mary Jane" onChange={onChange} />);
  expect(input).toHaveValue("Mary Jane");
  cleanup();
});

it("retains the raw text entered by the user", () => {
  let saved = "";
  function Form() {
    const [value, setValue] = useState("陈晓卿");
    return (
      <PersonNamesInput
        aria-label="负责人"
        value={value}
        onChange={(next) => {
          saved = next;
          setValue(next);
        }}
      />
    );
  }
  render(<Form />);
  const input = screen.getByRole("textbox", { name: "负责人" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "陈晓卿；李壮" } });
  fireEvent.blur(input);
  expect(saved).toBe("陈晓卿；李壮");
  expect(input).toHaveValue("陈晓卿、李壮");
});
