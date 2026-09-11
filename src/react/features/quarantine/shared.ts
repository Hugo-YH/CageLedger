import { createClientId } from "../../../domain/id";
import { speciesLabel } from "../../../domain/intake";
import type {
  QuarantineMethod,
  QuarantineResult,
  QuarantineSource,
  QuarantineTest,
} from "../../../contracts/quarantine";
export const methodLabels: Record<QuarantineMethod, string> = {
  parasite: "寄生虫检测",
  elisa_mouse: "ELISA检测（小鼠）",
  elisa_rat: "ELISA检测（大鼠）",
  pcr: "PCR检测",
};
export const resultOptions: { value: QuarantineResult; label: string }[] = [
  { value: "", label: "/" },
  { value: "negative", label: "-" },
  { value: "positive", label: "＋" },
  { value: "suspect", label: "±" },
  { value: "not_tested", label: "未检测" },
];
export function id() {
  return createClientId();
}
export function sourceLabel(s: QuarantineSource) {
  return [
    s.supplier,
    s.pi,
    s.owner,
    speciesLabel(s.species),
    s.strainStandard || s.strainRaw,
    s.intakeDate,
    s.manual ? "手工来源" : "",
  ]
    .filter(Boolean)
    .join(" / ");
}
export function emptyTest(batchId: string, method: QuarantineMethod, names: string[]): QuarantineTest {
  return {
    id: id(),
    reportFormVersion: 2,
    reportMaterial: method.startsWith("elisa") ? "血清" : method === "parasite" ? "皮毛、肠内容物" : "粪便",
    reportSpecimenState: method.startsWith("elisa") ? "液体" : "固体",
    batchId,
    method,
    samplingDate: "",
    testDate: "",
    conclusion: "",
    notes: "",
    samples: [],
    projects: names.map((name) => ({
      id: id(),
      name,
      kit: "",
      lot: "",
      sampleIds: [],
      results: {},
      wells: {},
      nc: "",
      pc: "",
    })),
    state: "draft",
    updatedAt: "",
    retestOf: "",
    correctionOf: "",
  };
}

export const reportResultOptions = resultOptions.filter((o) => o.value !== "not_tested");
export const resultLegend = "注：“-”代表阴性，“＋”代表阳性，“±”代表可疑，“/”代表空白。";
export function resultSymbol(value: QuarantineResult) {
  return resultOptions.find((o) => o.value === value)?.label ?? "/";
}

export function reportSections(method: QuarantineTest["method"]) {
  const sample = method === "parasite" ? 2 : method === "pcr" ? 4 : 3;
  return { sample, pictures: sample + 1, results: sample + 2 };
}
