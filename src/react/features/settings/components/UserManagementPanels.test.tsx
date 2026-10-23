import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { Profiler, type ChangeEvent, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CageRoom, ManagedUser } from "../../../api/contracts";
import { UserCreateForm, UserList, UserSaveProvider } from "./UserManagementPanels";
import { useUserSaveAction } from "./UserSaveContext";

const api = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock("../../../api/administration", () => ({ useSaveUser: () => api }));
vi.mock("../../../components/ui", () => ({
  CommandBar: ({ title }: { title: string }) => <h2>{title}</h2>,
}));
vi.mock("antd", () => {
  const Input = ({
    value,
    onChange,
    ...props
  }: {
    value?: string;
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  }) => <input {...props} value={value} onChange={onChange} />;
  Input.Password = Input;
  return {
    Alert: ({ title }: { title: ReactNode }) => <div role="alert">{title}</div>,
    Button: ({
      children,
      disabled,
      loading,
      onClick,
      ...props
    }: {
      children: ReactNode;
      disabled?: boolean;
      loading?: boolean;
      onClick?: () => void;
    }) => (
      <button {...props} type="button" disabled={disabled} data-loading={loading ? "true" : "false"} onClick={onClick}>
        {children}
      </button>
    ),
    Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
    Checkbox: Object.assign(({ children }: { children?: ReactNode }) => <label>{children}</label>, {
      Group: () => null,
    }),
    Collapse: ({ items }: { items: Array<{ key: string; children: ReactNode }> }) => (
      <div>
        {items.map((item) => (
          <section aria-label={`账号 ${item.key}`} key={item.key}>
            {item.children}
          </section>
        ))}
      </div>
    ),
    Form: Object.assign(({ children }: { children: ReactNode }) => <div>{children}</div>, {
      Item: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    }),
    Input,
    Select: () => <select />,
    Space: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Tag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    Typography: { Text: ({ children }: { children: ReactNode }) => <span>{children}</span> },
  };
});

const rooms: CageRoom[] = [{ id: "room-1", name: "8014" }];
const users: ManagedUser[] = [
  {
    id: "alpha",
    username: "alpha",
    displayName: "甲",
    phone: "100",
    role: "room_admin",
    roomIds: ["room-1"],
    billingLockAllowed: false,
    active: true,
    updatedAt: "version-alpha",
  },
  {
    id: "beta",
    username: "beta",
    displayName: "乙",
    phone: "200",
    role: "room_admin",
    roomIds: ["room-1"],
    billingLockAllowed: false,
    active: true,
    updatedAt: "version-beta",
  },
];

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function view() {
  return (
    <UserSaveProvider>
      <UserList currentUserId="none" items={users} rooms={rooms} onDelete={vi.fn()} />
      <UserCreateForm rooms={rooms} />
    </UserSaveProvider>
  );
}

describe("user management save boundaries", () => {
  beforeEach(() => api.mutateAsync.mockReset());
  afterEach(cleanup);

  it("coalesces a double save, retains another account draft, and preserves expectedUpdatedAt", async () => {
    const pending = deferred();
    api.mutateAsync.mockReturnValue(pending.promise);
    render(view());
    const alpha = screen.getByLabelText("账号 alpha");
    const beta = screen.getByLabelText("账号 beta");
    fireEvent.change(within(beta).getByDisplayValue("200"), { target: { value: "beta-draft" } });

    const alphaSave = within(alpha).getByRole("button", { name: "保存账号" });
    fireEvent.click(alphaSave);
    fireEvent.click(alphaSave);
    await waitFor(() => expect(api.mutateAsync).toHaveBeenCalledOnce());
    expect(api.mutateAsync).toHaveBeenCalledWith({
      id: "alpha",
      user: {
        username: "alpha",
        displayName: "甲",
        phone: "100",
        password: "",
        role: "room_admin",
        roomIds: ["room-1"],
        billingLockAllowed: false,
      },
      expectedUpdatedAt: "version-alpha",
    });
    expect(alphaSave).toHaveAttribute("data-loading", "true");
    expect(within(beta).getByRole("button", { name: "保存账号" })).toBeDisabled();
    expect(within(beta).getByDisplayValue("beta-draft")).toBeInTheDocument();

    await act(async () => {
      pending.resolve({ user: users[0] });
      await pending.promise;
    });
  });

  it("keeps the edited account draft after a failed save", async () => {
    api.mutateAsync.mockRejectedValueOnce(new Error("账号已被其他管理员更新"));
    render(view());
    const alpha = screen.getByLabelText("账号 alpha");
    const phone = within(alpha).getByDisplayValue("100");
    fireEvent.change(phone, { target: { value: "alpha-draft" } });
    fireEvent.click(within(alpha).getByRole("button", { name: "保存账号" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("账号已被其他管理员更新"));
    expect(within(alpha).getByDisplayValue("alpha-draft")).toBeInTheDocument();
    expect(api.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: "alpha", expectedUpdatedAt: "version-alpha" }),
    );
  });

  it("keeps the account list out of a create-draft update", () => {
    const listRenders = vi.fn();
    render(
      <UserSaveProvider>
        <Profiler id="user-list" onRender={listRenders}>
          <UserList currentUserId="none" items={users} rooms={rooms} onDelete={vi.fn()} />
        </Profiler>
        <UserCreateForm rooms={rooms} />
      </UserSaveProvider>,
    );
    const rendersBeforeDraft = listRenders.mock.calls.length;
    const createUsername = screen.getAllByRole("textbox")[8];
    fireEvent.change(createUsername, { target: { value: "new-account" } });
    expect(listRenders).toHaveBeenCalledTimes(rendersBeforeDraft);
  });

  it("rejects a different payload while a shared save is running", async () => {
    const pending = deferred();
    api.mutateAsync.mockReturnValue(pending.promise);
    const { result } = renderHook(useUserSaveAction, { wrapper: UserSaveProvider });
    let first: Promise<void> | undefined;
    await act(async () => {
      first = result.current("alpha", { id: "alpha", user: { phone: "100" }, expectedUpdatedAt: "version-alpha" });
      await Promise.resolve();
    });
    await expect(
      result.current("beta", { id: "beta", user: { phone: "200" }, expectedUpdatedAt: "version-beta" }),
    ).rejects.toThrow("另一个账号正在保存，请等待完成后再试。");
    expect(api.mutateAsync).toHaveBeenCalledExactlyOnceWith({
      id: "alpha",
      user: { phone: "100" },
      expectedUpdatedAt: "version-alpha",
    });
    await act(async () => {
      pending.resolve({ user: users[0] });
      await first;
    });
  });
});
