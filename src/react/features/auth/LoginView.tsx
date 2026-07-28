import { Alert, Button, Form, Input, type InputRef } from "antd";
import { useEffect, useRef, useState } from "react";

import { ApiError } from "../../api/client";
import { useLogin } from "../../api/session";
import { APP_VERSION } from "../../version";

export function LoginView() {
  const login = useLogin();
  const [message, setMessage] = useState("");
  const usernameRef = useRef<InputRef>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  async function submit(values: { username: string; password: string }) {
    setMessage("");
    try {
      await login.mutateAsync({
        username: values.username.trim(),
        password: values.password,
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
        <Form className="form" layout="vertical" onFinish={submit} requiredMark="optional">
          <Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名" }]}>
            <Input ref={usernameRef} autoComplete="username" placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password autoComplete="current-password" placeholder="请输入密码" />
          </Form.Item>
          {message ? <Alert className="login-error" showIcon title={message} type="error" /> : null}
          <Button aria-label="登录" block htmlType="submit" loading={login.isPending} type="primary">
            登录
          </Button>
        </Form>
        <div className="version-meta login-version">
          <span>CageLedger v{APP_VERSION}</span>
          <small>中山大学中山眼科中心 · 实验动物中心</small>
          <small>© 2026 中山大学中山眼科中心 实验动物中心. Licensed under Apache-2.0.</small>
        </div>
      </section>
    </main>
  );
}
