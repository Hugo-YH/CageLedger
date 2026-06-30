import { type FormEvent, useEffect, useRef, useState } from "react";

import { ApiError } from "../../api/client";
import { useLogin } from "../../api/session";
import { APP_VERSION } from "../../version";

export function LoginView() {
  const login = useLogin();
  const [message, setMessage] = useState("");
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      await login.mutateAsync({
        username: formValue(form, "username").trim(),
        password: formValue(form, "password"),
      });
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "无法连接后端服务");
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand login-brand">
          <div className="brand-mark">
            <img src="/cageledger-icon.svg" alt="" />
          </div>
          <div>
            <strong>CageLedger</strong>
            <span>实验动物笼位管理与计费系统</span>
          </div>
        </div>
        <form className="form" onSubmit={submit}>
          <label>
            用户名
            <input ref={usernameRef} name="username" autoComplete="username" placeholder="请输入用户名" required />
          </label>
          <label>
            密码
            <input name="password" type="password" autoComplete="current-password" placeholder="请输入密码" required />
          </label>
          <p className="login-error" role="alert">
            {message}
          </p>
          <button className="primary" type="submit" disabled={login.isPending}>
            {login.isPending ? "登录中..." : "登录"}
          </button>
        </form>
        <div className="version-meta login-version">
          <span>CageLedger v{APP_VERSION}</span>
          <small>中山大学中山眼科中心 · 实验动物中心</small>
          <small>© 2026 中山大学中山眼科中心 实验动物中心. Licensed under Apache-2.0.</small>
        </div>
      </section>
    </main>
  );
}

function formValue(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}
