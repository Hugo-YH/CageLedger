import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, Button, ConfigProvider, Input, Select, Space, Tag, Upload } from "antd";
import zhCN from "antd/locale/zh_CN";
import "antd/dist/reset.css";
import "./style.css";

const key = "cageledger-elisa-report-prototype-v1";
let serial = Date.now();
const uid = () => String(++serial);
const resultSymbols = { 阴性: "-", 阳性: "＋", 可疑: "±", "": "/" };
const options = Object.entries(resultSymbols).map(([value, label]) => ({ value, label, title: value || "空白" }));
const origins = [
  { id: "a", supplier: "江苏集萃", staff: "课题组甲／张同学", strain: "C57BL/6J" },
  { id: "b", supplier: "江苏集萃", staff: "课题组乙／李同学", strain: "BALB/c" },
  { id: "c", supplier: "广东药康", staff: "课题组丙／陈同学", strain: "C57BL/6J" },
  { id: "d", supplier: "广东药康", staff: "课题组丁／周同学", strain: "ICR" },
];
const blank = () => ({
  sampling: "2026-09-09",
  experiment: "2026-09-10",
  material: "血清",
  condition: "液体",
  samples: [
    { id: "s1", number: "1", sources: ["a", "b"] },
    { id: "s2", number: "2", sources: ["c"] },
    { id: "s3", number: "3", sources: ["d"] },
  ],
  projects: [
    { id: "p1", name: "小鼠肺炎病毒抗体（PVM）", kit: "小鼠肺炎病毒抗体 ELISA 试剂盒", lot: "" },
    { id: "p2", name: "小鼠肝炎病毒抗体（MHV）", kit: "小鼠肝炎病毒抗体 ELISA 试剂盒", lot: "" },
    { id: "p3", name: "小鼠仙台病毒抗体（SV）", kit: "小鼠仙台病毒抗体 ELISA 试剂盒", lot: "" },
  ],
  pictures: [],
  results: {},
});
function initial() {
  try {
    const data = JSON.parse(localStorage.getItem(key));
    return data?.samples && data?.projects ? data : blank();
  } catch {
    return blank();
  }
}
function Record() {
  const [data, setData] = useState(initial);
  const [preview, setPreview] = useState(false);
  const [saved, setSaved] = useState(false);
  const { message, modal } = App.useApp();
  const patch = (update) => {
    setData((d) => ({ ...d, ...(typeof update === "function" ? update(d) : update) }));
    setSaved(false);
  };
  const count = data.samples.reduce((n, s) => n + new Set(s.sources).size, 0);
  const sampleChange = (id, update) =>
    patch((d) => ({ samples: d.samples.map((s) => (s.id === id ? { ...s, ...update } : s)) }));
  const projectChange = (id, update) =>
    patch((d) => ({ projects: d.projects.map((p) => (p.id === id ? { ...p, ...update } : p)) }));
  const pictureChange = (id, update) =>
    patch((d) => ({ pictures: d.pictures.map((p) => (p.id === id ? { ...p, ...update } : p)) }));
  function removeSample(sample) {
    modal.confirm({
      title: `删除样本 ${sample.number || "未编号"}？`,
      content: "该样本对应的结果列也会移除，其他样本的结果不受影响。",
      okText: "删除样本",
      cancelText: "保留",
      onOk: () =>
        patch((d) => ({
          samples: d.samples.filter((s) => s.id !== sample.id),
          results: Object.fromEntries(Object.entries(d.results).filter(([k]) => !k.endsWith(":" + sample.id))),
        })),
    });
  }
  function removeProject(project) {
    modal.confirm({
      title: `删除 ${project.name || "此检测项目"}？`,
      content: "对应结果表和图片上的项目关联会一同移除；图片仍保留。",
      okText: "删除项目",
      cancelText: "保留",
      onOk: () =>
        patch((d) => ({
          projects: d.projects.filter((p) => p.id !== project.id),
          pictures: d.pictures.map((p) => ({ ...p, projects: p.projects.filter((id) => id !== project.id) })),
          results: Object.fromEntries(Object.entries(d.results).filter(([k]) => !k.startsWith(project.id + ":"))),
        })),
    });
  }
  function save() {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      setSaved(true);
      message.success("演示草稿已保存在本浏览器");
    } catch {
      message.error("本地空间不足，请减少图片后重试；当前填写内容仍在页面中。 ");
    }
  }
  function upload(file) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      message.error("请选择 PNG、JPEG 或 WebP 图片");
      return false;
    }
    if (file.size > 8 * 1024 * 1024) {
      message.error("原型单张图片上限 8MB");
      return false;
    }
    const reader = new FileReader();
    reader.onload = () =>
      patch((d) => ({
        pictures: [...d.pictures, { id: uid(), src: reader.result, name: file.name, caption: "", projects: [] }],
      }));
    reader.readAsDataURL(file);
    return false;
  }
  function movePicture(index, delta) {
    patch((d) => {
      const pictures = [...d.pictures];
      [pictures[index], pictures[index + delta]] = [pictures[index + delta], pictures[index]];
      return { pictures };
    });
  }
  function field(label, value, change, type = "text") {
    return preview ? (
      <span className="value">{value || "____________"}</span>
    ) : (
      <Input aria-label={label} type={type} value={value} onChange={(e) => change(e.target.value)} />
    );
  }
  function result(project, sample) {
    const id = project.id + ":" + sample;
    return preview ? (
      <span className={data.results[id] === "阳性" ? "positive" : ""}>
        {resultSymbols[data.results[id] || ""] || "/"}
      </span>
    ) : (
      <Select
        aria-label={`${project.name} 样本 ${sample.startsWith("s") ? data.samples.find((s) => s.id === sample)?.number : sample} 结果`}
        value={data.results[id] || ""}
        allowClear
        options={options}
        onChange={(value) => patch((d) => ({ results: { ...d.results, [id]: value || "" } }))}
      />
    );
  }
  const completed = data.projects.reduce(
    (n, p) => n + [...data.samples.map((s) => s.id), "NC", "PC"].filter((s) => data.results[p.id + ":" + s]).length,
    0,
  );
  const total = data.projects.length * (data.samples.length + 2);
  return (
    <>
      <header className="topbar">
        <div>
          <strong>CageLedger</strong>
          <span>检疫管理 / ELISA 检测记录</span>
        </div>
        <Tag color="blue">交互原型 · 演示数据</Tag>
      </header>
      <div className="workbar">
        <div>
          <b>{preview ? "报告预览" : "填写检测记录"}</b>
          <small aria-live="polite">{saved ? "已保存至本浏览器" : "原型内容不写入系统数据库"}</small>
        </div>
        <Space wrap>
          <Button onClick={() => setPreview(!preview)}>{preview ? "继续填写" : "查看报告预览"}</Button>
          <Button type="primary" onClick={save}>
            保存演示草稿
          </Button>
        </Space>
      </div>
      <div className="workspace">
        <aside>
          <p className="aside-label">本份记录</p>
          <h2>ELISA · 小鼠</h2>
          <nav aria-label="报告章节">
            {["采样实验信息", "试剂盒与批号", "样本统计表", "原始记录", "检测结果"].map((s, i) => (
              <a key={s} href={`#part-${i + 1}`}>
                <span>{i + 1}</span>
                {s}
              </a>
            ))}
          </nav>
          <div className="coverage">
            <b>所属检疫批次</b>
            <p>2026-09-09 到货检疫</p>
            <small>覆盖 4 个到货来源，抽检样本见第三部分。这里均为演示来源。</small>
          </div>
          <div className="progress">
            <b>
              {completed} / {total}
            </b>
            <span>结果已填写</span>
          </div>
          <p className="aside-note">先填试剂盒与样本，再填写结果。新增项目和样本会自动出现在结果表。</p>
        </aside>
        <main className={preview ? "paper preview" : "paper"}>
          <div className="letterhead">
            中山眼科中心眼科学实验动物中心 <span>填写体验原型</span>
          </div>
          <h1>
            ELISA 检测记录表<span>（小鼠）</span>
          </h1>
          <section id="part-1">
            <h2>1、采样实验信息</h2>
            <div className="metadata">
              <label>采样日期{field("采样日期", data.sampling, (v) => patch({ sampling: v }), "date")}</label>
              <label>实验日期{field("实验日期", data.experiment, (v) => patch({ experiment: v }), "date")}</label>
              <label>样品名称{field("样品名称", data.material, (v) => patch({ material: v }))}</label>
              <label>样品状态{field("样品状态", data.condition, (v) => patch({ condition: v }))}</label>
            </div>
            <div className="quantity">
              样品数量：
              <strong data-testid="quantity">
                {data.samples.length}样（{count}份{data.material}）
              </strong>
              {!preview && <small>按实验组数与组内来源数量自动汇总</small>}
            </div>
          </section>
          <section id="part-2">
            <div className="section-title">
              <h2>2、试剂盒名称及批号</h2>
              {!preview && (
                <Button
                  size="small"
                  onClick={() =>
                    patch((d) => ({ projects: [...d.projects, { id: uid(), name: "", kit: "", lot: "" }] }))
                  }
                >
                  ＋ 添加检测项目
                </Button>
              )}
            </div>
            <div className="table-scroll">
              <table className="kits">
                <thead>
                  <tr>
                    <th>检测项目</th>
                    <th>试剂盒名称</th>
                    <th>批号</th>
                    {!preview && <th className="action-column">操作</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.projects.map((p, i) => (
                    <tr key={p.id}>
                      <td>{field(`检测项目 ${i + 1}`, p.name, (v) => projectChange(p.id, { name: v }))}</td>
                      <td>{field(`试剂盒名称 ${i + 1}`, p.kit, (v) => projectChange(p.id, { kit: v }))}</td>
                      <td>{field(`试剂盒批号 ${i + 1}`, p.lot, (v) => projectChange(p.id, { lot: v }))}</td>
                      {!preview && (
                        <td>
                          <Button
                            type="text"
                            danger
                            size="small"
                            aria-label={`删除检测项目 ${i + 1}`}
                            onClick={() => removeProject(p)}
                          >
                            删除
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!preview && <p className="hint">这里的检测项目将同步到图片区和结果表。修改名称不会清空已填结果。</p>}
          </section>
          <section id="part-3">
            <div className="section-title">
              <h2>3、样本统计表</h2>
              {!preview && (
                <Button
                  size="small"
                  onClick={() =>
                    patch((d) => ({
                      samples: [...d.samples, { id: "s" + uid(), number: String(d.samples.length + 1), sources: [] }],
                    }))
                  }
                >
                  ＋ 添加样本
                </Button>
              )}
            </div>
            <div className="table-scroll">
              <table className="samples">
                <tbody>
                  <tr>
                    <th scope="row">样本编号</th>
                    {data.samples.map((s, i) => (
                      <td key={s.id}>
                        {field(`样本编号 ${i + 1}`, s.number, (v) => sampleChange(s.id, { number: v }))}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">供应商</th>
                    {data.samples.map((s) => (
                      <td key={s.id}>
                        {[...new Set(origins.filter((o) => s.sources.includes(o.id)).map((o) => o.supplier))].join(
                          "、",
                        ) || "选择来源后带入"}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">课题组／实验人员</th>
                    {data.samples.map((s) => (
                      <td key={s.id}>
                        {preview ? (
                          origins.filter((o) => s.sources.includes(o.id)).map((o) => <div key={o.id}>{o.staff}</div>)
                        ) : (
                          <Select
                            mode="multiple"
                            aria-label={`样本 ${s.number} 来源`}
                            value={s.sources}
                            placeholder="从本批覆盖来源选择"
                            options={origins.map((o) => ({ value: o.id, label: o.staff }))}
                            onChange={(v) => sampleChange(s.id, { sources: v })}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                  {!preview && (
                    <tr>
                      <th scope="row">操作</th>
                      {data.samples.map((s) => (
                        <td key={s.id}>
                          <Button
                            type="text"
                            danger
                            size="small"
                            aria-label={`删除样本 ${s.number}`}
                            onClick={() => removeSample(s)}
                          >
                            删除样本
                          </Button>
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {!preview && (
              <p className="hint">
                每个编号代表一个实验组，每选一个来源计一份原始样本，通常同供应商混样。此表只登记实际抽样，不改变整批检疫覆盖范围。
              </p>
            )}
          </section>
          <section id="part-4">
            <div className="section-title">
              <h2>4、原始记录</h2>
              {!preview && (
                <Upload accept="image/png,image/jpeg,image/webp" multiple showUploadList={false} beforeUpload={upload}>
                  <Button size="small">＋ 上传图片</Button>
                </Upload>
              )}
            </div>
            {data.pictures.length === 0 ? (
              <div className="picture-empty">
                <span>原始检测图片</span>
                <p>{preview ? "尚未上传图片" : "上传后自动排列，每张图片可关联多个检测项目。"}</p>
              </div>
            ) : (
              <div className="pictures">
                {data.pictures.map((p, i) => (
                  <figure key={p.id}>
                    <img src={p.src} alt={p.caption || `原始记录 ${i + 1}`} />
                    <figcaption>
                      <b>图 {i + 1}</b>
                      {preview ? (
                        <p>
                          {p.projects
                            .map((id) => data.projects.find((x) => x.id === id)?.name)
                            .filter(Boolean)
                            .join("、") || "未关联项目"}
                        </p>
                      ) : (
                        <Select
                          mode="multiple"
                          aria-label={`图 ${i + 1} 检测项目`}
                          placeholder="选择图中包含的项目（可多选）"
                          value={p.projects}
                          options={data.projects.map((p, index) => ({
                            value: p.id,
                            label: p.name || `未命名项目 ${index + 1}`,
                          }))}
                          onChange={(v) => pictureChange(p.id, { projects: v })}
                        />
                      )}{" "}
                      {field(`图 ${i + 1} 说明`, p.caption, (v) => pictureChange(p.id, { caption: v }))}
                    </figcaption>
                    {!preview && (
                      <Space wrap>
                        <Button size="small" disabled={!i} onClick={() => movePicture(i, -1)}>
                          上移
                        </Button>
                        <Button
                          size="small"
                          disabled={i === data.pictures.length - 1}
                          onClick={() => movePicture(i, 1)}
                        >
                          下移
                        </Button>
                        <Button
                          size="small"
                          danger
                          onClick={() =>
                            modal.confirm({
                              title: "删除这张原始记录图片？",
                              okText: "删除",
                              cancelText: "保留",
                              onOk: () => patch((d) => ({ pictures: d.pictures.filter((x) => x.id !== p.id) })),
                            })
                          }
                        >
                          删除图片
                        </Button>
                      </Space>
                    )}
                  </figure>
                ))}
              </div>
            )}
          </section>
          <section id="part-5">
            <h2>5、实验结果统计表</h2>
            {!preview && (
              <p className="hint">按项目填写每个样本及 NC、PC 的结果。空白表示尚未填写，不会自动判为阴性。</p>
            )}
            {data.projects.map((p, i) => (
              <div className="result-block" key={p.id}>
                <h3>
                  5-{i + 1}　{p.name || "待填写检测项目"}
                </h3>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>样本编号</th>
                        {data.samples.map((s) => (
                          <th key={s.id}>{s.number || "未编号"}</th>
                        ))}
                        <th>NC</th>
                        <th>PC</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th scope="row">检测结果</th>
                        {[...data.samples.map((s) => s.id), "NC", "PC"].map((s) => (
                          <td key={s}>{result(p, s)}</td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            <p className="hint">注：“-”代表阴性，“＋”代表阳性，“±”代表可疑，“/”代表空白。</p>
          </section>
          <footer className="signatures">
            <span>检测人：____________</span>
            <span>复核人：____________</span>
            <span>日期：____________</span>
          </footer>
          <p className="paper-note">签名栏固定留空，供导出后手写签名。</p>
        </main>
      </div>
      <div className="prototype-foot">
        交互原型 · 数据仅保存在此浏览器 · 报告预览用于确认填写体验，正式 Word 仍按原模板导出
      </div>
    </>
  );
}
createRoot(document.getElementById("root")).render(
  <ConfigProvider
    locale={zhCN}
    theme={{ token: { colorPrimary: "#1677ff", borderRadius: 6, fontSize: 14, controlHeight: 32 } }}
  >
    <App>
      <Record />
    </App>
  </ConfigProvider>,
);
