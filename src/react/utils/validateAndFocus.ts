import type { FormInstance } from "antd";

/** Manual submissions need the same first-error navigation as Ant's onFinish. */
export async function validateAndFocus<T>(form: FormInstance<T>): Promise<T> {
  try {
    return await form.validateFields();
  } catch (error) {
    const failure = error as { errorFields?: Array<{ name: Parameters<FormInstance["scrollToField"]>[0] }> };
    const first = failure?.errorFields?.[0];
    if (first) {
      // Submission temporarily disables the form. Focus after its finally block
      // has restored the controls, rather than trying to focus a disabled input.
      requestAnimationFrame(() => form.scrollToField(first.name, { focus: true, block: "center" }));
    }
    throw error;
  }
}
