import type { IntakeBatch } from "../../../contracts/intake";
import type { ResearcherContact } from "../../../contracts/researchers";
import { splitPersonNames } from "../../../domain/personNames";
import { resolveResearcherContacts } from "../../api/researchers";

/** Resolve once per print, never store derived phones in a batch or use the receiver's phone. */
export async function prepareIntakePrintContacts(batches: IntakeBatch[]) {
  const names = [...new Set(batches.flatMap((batch) => splitPersonNames(batch.owner)))];
  const resolved = new Map<string, ResearcherContact>();
  for (let offset = 0; offset < names.length; offset += 200) {
    const response = await resolveResearcherContacts(names.slice(offset, offset + 200));
    for (const contact of response.items) resolved.set(contact.name, contact);
  }
  const contactPhones: Record<string, string> = {};
  const unresolved = new Set<string>();
  for (const batch of batches) {
    const owners = splitPersonNames(batch.owner);
    const contacts = owners.map((name) => resolved.get(name));
    owners.forEach((name, index) => {
      if (contacts[index]?.status !== "matched" || !contacts[index]?.phone) unresolved.add(name);
    });
    // Keep the whole row blank if a person is unresolved, rather than pairing a phone with the wrong name.
    contactPhones[batch.id] = contacts.every((item) => item?.status === "matched" && item.phone)
      ? contacts.map((item) => item!.phone).join(" / ")
      : "";
    if (!owners.length) unresolved.add("未填写实验负责人/助手的批次");
  }
  const missing = [...unresolved];
  const warning = missing.length
    ? `以下人员未唯一匹配到电话，相关笼卡联系电话留空：${missing.slice(0, 6).join("、")}${missing.length > 6 ? `等${missing.length}项` : ""}。请在实验人员信息中核对姓名、重名和联系方式后重新打印。`
    : "";
  return { contactPhones, warning };
}
