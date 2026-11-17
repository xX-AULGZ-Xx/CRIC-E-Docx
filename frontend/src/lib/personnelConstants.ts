export type PersonnelType = "TEACHER" | "STAFF";

export const TEACHER_POSITIONS = [
  "ครู",
  "ครูผู้ช่วย",
  "ครูชำนาญการ",
  "ครูชำนาญการพิเศษ",
  "ครูเชี่ยวชาญ",
  "ครูอัตราจ้าง",
  "ครูพิเศษสอน",
];

export const STAFF_POSITIONS = [
  "เจ้าหน้าที่",
  "เจ้าหน้าที่ธุรการ",
  "เจ้าหน้าที่การเงิน",
  "เจ้าหน้าที่พัสดุ",
  "เจ้าหน้าที่งานวางแผนและงบประมาณ",
  "เจ้าหน้าที่งานวิจัยและนวัตกรรม",
  "เจ้าหน้าที่งานทะเบียน",
  "เจ้าหน้าที่งานบุคลากร",
  "เจ้าหน้าที่งานอาคารสถานที่",
  "เจ้าหน้าที่ประชาสัมพันธ์",
  "เจ้าหน้าที่เทคโนโลยีสารสนเทศ",
  "หัวหน้างานบริหารงานทั่วไป",
  "พนักงานขับรถยนต์",
  "นักการภารโรง",
];

export const ROLE_CONFIG: Record<
  string,
  { label: string; shortLabel: string; bg: string; text: string; border: string }
> = {
  drafter: {
    label: "ผู้ร่างเอกสาร / ครู",
    shortLabel: "ผู้ร่างเอกสาร",
    bg: "bg-emerald-50",
    text: "text-emerald-800",
    border: "border-emerald-200",
  },
  unit_head: {
    label: "หัวหน้าแผนก / หัวหน้างาน",
    shortLabel: "หัวหน้างาน",
    bg: "bg-blue-50",
    text: "text-blue-800",
    border: "border-blue-200",
  },
  deputy_director: {
    label: "รองผู้อำนวยการ",
    shortLabel: "รองผู้อำนวยการ",
    bg: "bg-purple-50",
    text: "text-purple-800",
    border: "border-purple-200",
  },
  director: {
    label: "ผู้อำนวยการ",
    shortLabel: "ผู้อำนวยการ",
    bg: "bg-rose-50",
    text: "text-rose-800",
    border: "border-rose-200",
  },
  saraban_admin: {
    label: "เจ้าหน้าที่สารบรรณกลาง / ผู้ดูแลระบบ",
    shortLabel: "งานสารบรรณกลาง",
    bg: "bg-slate-900",
    text: "text-amber-300",
    border: "border-slate-800",
  },
};

export function inferPersonnelType(positionTitle?: string | null, savedType?: string | null): PersonnelType {
  if (savedType === "TEACHER" || savedType === "STAFF") return savedType;
  const pos = (positionTitle || "").trim();
  if (pos.startsWith("ครู") || pos.startsWith("อาจารย์")) return "TEACHER";
  return "STAFF";
}
