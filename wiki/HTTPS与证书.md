# HTTPS 与证书

CageLedger 通过群晖反向代理提供 HTTPS。浏览器在安全连接下开放剪贴板、摄像头等能力。受控客户端需要安装 CageLedger 内网根证书，并使用证书覆盖的地址访问系统。

## 下载与核验

- <a href="/docs/cageledger.crt" download="cageledger.crt">下载 CageLedger 根证书</a>
- 证书文件名：`cageledger.crt`
- 适用地址：`https://10.100.47.47`
- 有效期：2026 年 8 月 11 日至 2036 年 8 月 8 日
- 证书 SHA-256 指纹：`A4:6A:89:6F:68:17:C4:A5:45:55:77:5F:1B:F7:8B:A4:75:D7:82:68:5D:3B:92:60:A4:B7:1F:BE:BE:8C:B2:2E`
- 下载文件 SHA-256：`ea32fb1d30dc7111956e6ce763e1e486caf4e7b5176edbc5b350f3fed2a18ab6`

安装前核对指纹。证书的 Subject Alternative Name 仅包含 `10.100.47.47`，客户端应使用这个地址访问。域名或其他 IP 地址需要签发包含对应名称的新证书。

## Windows 10 和 Windows 11

1. 下载 `cageledger.crt`，双击打开证书。
2. 点击“安装证书”，管理员维护的公用电脑选择“本地计算机”，个人电脑可选择“当前用户”。
3. 选择“将所有的证书都放入下列存储”，证书存储选择“受信任的根证书颁发机构”。
4. 完成导入并确认安全提示，重新启动 Chrome 或 Edge。
5. 打开 `https://10.100.47.47`，确认地址栏显示安全连接。

Firefox 使用独立证书库时，进入“设置 → 隐私与安全 → 证书 → 查看证书 → 证书颁发机构”，导入证书并允许其标识网站。

## macOS

1. 下载证书，打开“钥匙串访问”。
2. 选择“系统”钥匙串，将 `cageledger.crt` 拖入证书列表，或使用“文件 → 导入项目”。
3. 双击导入后的证书，展开“信任”，将“使用此证书时”设为“始终信任”。
4. 输入管理员密码保存设置，重新启动 Safari、Chrome 或 Edge。
5. 打开 `https://10.100.47.47`，确认地址栏显示安全连接。

## iPhone 和 iPad

1. 使用 Safari 下载 `cageledger.crt`，允许设备下载描述文件。
2. 打开“设置”，进入“已下载描述文件”；部分系统版本位于“通用 → VPN 与设备管理”。
3. 选择 CageLedger 证书并完成安装。
4. 进入“设置 → 通用 → 关于本机 → 证书信任设置”，为 CageLedger 证书开启完全信任。
5. 关闭并重新打开 Safari，然后访问 `https://10.100.47.47`。

单位通过 MDM 管理设备时，可将同一证书作为受信任根证书配置下发。

## Android

不同厂商的菜单名称略有差异，常见路径为“设置 → 安全与隐私 → 更多安全设置 → 从设备存储安装 → CA 证书”。

1. 下载 `cageledger.crt`。
2. 选择安装“CA 证书”或“VPN 和应用用户证书”，用途选择网站或 Wi-Fi/应用认证。
3. 按系统要求确认锁屏密码，并为证书命名为 `CageLedger`。
4. 重新启动浏览器，访问 `https://10.100.47.47`。

受单位策略管理的 Android 设备可通过 MDM 的受信任凭据配置下发。部分业务应用只接受系统证书；Chrome 等浏览器可使用用户安装的根证书。

## Linux

Ubuntu 或 Debian：

```bash
sudo cp cageledger.crt /usr/local/share/ca-certificates/cageledger.crt
sudo update-ca-certificates
```

RHEL、Rocky Linux 或 Fedora：

```bash
sudo cp cageledger.crt /etc/pki/ca-trust/source/anchors/cageledger.crt
sudo update-ca-trust
```

重新启动浏览器后访问 `https://10.100.47.47`。Firefox 使用独立证书库时，按 Windows 章节中的 Firefox 流程导入。

## 群晖反向代理

1. 在 DSM“控制面板 → 安全性 → 证书”中导入服务器证书和对应私钥。
2. 在证书设置中，将该证书分配给 CageLedger 使用的反向代理服务。
3. 反向代理来源使用 HTTPS，目标指向 CageLedger 容器的 HTTP 地址和端口 `5173`。
4. 保留 WebSocket 与常用代理请求头，确认来源地址为 `https://10.100.47.47`。
5. 用已安装根证书的客户端验证登录、复制到剪贴板和摄像头扫码。

公开下载目录只存放 `cageledger.crt`。对应私钥保留在 DSM，纳入群晖配置备份和访问控制范围。

## 更新与移除

证书地址、私钥或有效期发生变化时，需要发布新证书并重新安装。旧证书可在各系统的受信任根证书列表中删除；设备退役或离开受控网络时应同步移除。

## 相关页面

- [[部署与运行]]
- [[系统配置]]
- [[故障排查]]
