export type DivisionKey = "resource" | "academic" | "development" | "planning";

export type DivisionFormSlug =
  | "vehicle_request"
  | "official_travel"
  | "overload_teaching"
  | "internship_supervision"
  | "home_visit"
  | "project_summary"
  | "single_plan_summary";

export type DivisionExternalLinkKey =
  | "repair_system_url"
  | "short_course_url"
  | "student_screening_url"
  | "project_system_url"
  | "evaluation_system_url";

export interface DivisionDocItem {
  id: string;
  label: string;
  subtitle: string;
  kind: "existing" | "form" | "external";
  href?: string;
  formSlug?: DivisionFormSlug;
  externalKey?: DivisionExternalLinkKey;
}

export interface DivisionGroupDef {
  key: DivisionKey;
  code: string;
  label: string;
  shortLabel: string;
  description: string;
  items: DivisionDocItem[];
}

export const DIVISION_GROUPS: DivisionGroupDef[] = [
  {
    key: "resource",
    code: "ฝบ.",
    label: "ฝ่ายบริหารทรัพยากร",
    shortLabel: "ฝ่ายบริหารทรัพย์",
    description: "งานสารบรรณ พัสดุ ยานพาหนะ อาคารสถานที่ และการฝึกอบรมระยะสั้น",
    items: [
      { id: "memo_ext", label: "บันทึกข้อความ / หนังสือภายนอก", subtitle: "ร่างเอกสารราชการและหนังสือส่งภายนอก", kind: "existing", href: "/draft" },
      { id: "vehicle_request", label: "ขอใช้รถ", subtitle: "แบบขออนุญาตใช้รถยนต์ราชการและผู้ร่วมเดินทาง", kind: "form", href: "/forms/vehicle_request", formSlug: "vehicle_request" },
      { id: "sp_bundle", label: "ชุดจัดซื้อ", subtitle: "สผ.1 · แผนฝึก · TOR · ใบสั่งซื้อชั่วคราว", kind: "existing", href: "/procurement" },
      { id: "official_travel", label: "ขอไปราชการ", subtitle: "ขออนุญาตไปราชการและประมาณการค่าใช้จ่าย", kind: "form", href: "/forms/official_travel", formSlug: "official_travel" },
      { id: "repair_system", label: "แจ้งซ่อม", subtitle: "เชื่อมโยงระบบแจ้งซ่อมบำรุงอาคาร/ครุภัณฑ์", kind: "external", externalKey: "repair_system_url" },
      { id: "short_course", label: "ระบบสมัครระยะสั้น", subtitle: "เชื่อมโยงระบบรับสมัครหลักสูตรวิชาชีพระยะสั้น", kind: "external", externalKey: "short_course_url" },
    ],
  },
  {
    key: "academic",
    code: "ฝว.",
    label: "ฝ่ายวิชาการ",
    shortLabel: "ฝ่ายวิชาการ",
    description: "งานหลักสูตร การสอน การเบิกค่าสอน และการนิเทศฝึกงาน",
    items: [
      { id: "course_syllabus", label: "กำหนดการสอน", subtitle: "โครงการสอน 18 สัปดาห์ และแผนรายหน่วย", kind: "existing", href: "/teaching" },
      { id: "post_teaching", label: "บันทึกหลังสอน / รายงานสอนออนไลน์", subtitle: "รายงานหลังสอน 4 สัปดาห์ และสอนออนไลน์", kind: "existing", href: "/teaching?tab=normal_post" },
      { id: "overload_teaching", label: "ขอเบิกค่าสอนเกินภาระงาน", subtitle: "ตารางคาบสอนเกินและคำนวณยอดเงินขอเบิก", kind: "form", href: "/forms/overload_teaching", formSlug: "overload_teaching" },
      { id: "internship_supervision", label: "รายงานการนิเทศฝึกงาน", subtitle: "บันทึกการนิเทศนักศึกษาฝึกงานในสถานประกอบการ", kind: "form", href: "/forms/internship_supervision", formSlug: "internship_supervision" },
    ],
  },
  {
    key: "development",
    code: "ฝก.",
    label: "ฝ่ายพัฒนากิจการนักเรียน นักศึกษา",
    shortLabel: "ฝ่ายพัฒนา",
    description: "งานครูที่ปรึกษา งานแนะแนว เยี่ยมบ้าน และการดูแลคัดกรองผู้เรียน",
    items: [
      { id: "home_visit", label: "รายงานเยี่ยมบ้าน", subtitle: "แบบรายงานการเยี่ยมบ้านนักเรียน นักศึกษา", kind: "form", href: "/forms/home_visit", formSlug: "home_visit" },
      { id: "student_screening", label: "ระบบคัดกรองนักเรียน", subtitle: "เชื่อมโยงระบบคัดกรองและดูแลช่วยเหลือนักเรียน", kind: "external", externalKey: "student_screening_url" },
    ],
  },
  {
    key: "planning",
    code: "ฝย.",
    label: "ฝ่ายยุทธศาสตร์และแผนงาน",
    shortLabel: "ฝ่ายแผน",
    description: "งานโครงการ สรุปผลแผนงาน งบประมาณ และการประเมินผล",
    items: [
      { id: "project_system", label: "ระบบโครงการ", subtitle: "เชื่อมโยงระบบบริหารจัดการโครงการ (CRIC Plan)", kind: "external", externalKey: "project_system_url" },
      { id: "project_summary", label: "สรุปโครงการ", subtitle: "รายงานสรุปผลดำเนินงาน งบประมาณ และ KPI โครงการ", kind: "form", href: "/forms/project_summary", formSlug: "project_summary" },
      { id: "single_plan_summary", label: "สรุปแผนเดี่ยว", subtitle: "รายงานสรุปผลการดำเนินงานแผนปฏิบัติการรายบุคคล", kind: "form", href: "/forms/single_plan_summary", formSlug: "single_plan_summary" },
      { id: "evaluation_system", label: "ระบบประเมิน", subtitle: "เชื่อมโยงระบบติดตามและประเมินผลสถานศึกษา", kind: "external", externalKey: "evaluation_system_url" },
    ],
  },
];

export const DIVISION_FORM_META: Record<
  DivisionFormSlug,
  {
    title: string;
    divisionCode: string;
    divisionName: string;
    description: string;
  }
> = {
  vehicle_request: {
    title: "ขออนุญาตใช้รถยนต์ราชการ",
    divisionCode: "ฝบ.",
    divisionName: "ฝ่ายบริหารทรัพยากร",
    description: "สร้างแบบขออนุญาตใช้รถยนต์ราชการ เส้นทาง วัน-เวลา และรายชื่อผู้ร่วมเดินทาง",
  },
  official_travel: {
    title: "ขออนุญาตไปราชการ",
    divisionCode: "ฝบ.",
    divisionName: "ฝ่ายบริหารทรัพยากร",
    description: "สร้างแบบขออนุญาตเดินทางไปราชการ รายชื่อผู้เดินทาง และประมาณการค่าใช้จ่าย",
  },
  overload_teaching: {
    title: "ขอเบิกค่าสอนเกินภาระงาน",
    divisionCode: "ฝว.",
    divisionName: "ฝ่ายวิชาการ",
    description: "คำนวณคาบสอนเกินภาระงานและยอดเงินขอเบิกเป็นไฟล์ .DOCX พร้อมส่งตรวจลงนาม",
  },
  internship_supervision: {
    title: "รายงานการนิเทศฝึกงาน",
    divisionCode: "ฝว.",
    divisionName: "ฝ่ายวิชาการ",
    description: "บันทึกผลการนิเทศนักศึกษาฝึกงาน ณ สถานประกอบการ และข้อเสนอแนะ",
  },
  home_visit: {
    title: "รายงานการเยี่ยมบ้านนักเรียน นักศึกษา",
    divisionCode: "ฝก.",
    divisionName: "ฝ่ายพัฒนากิจการนักเรียน นักศึกษา",
    description: "บันทึกข้อมูลสภาพความเป็นอยู่ พฤติกรรม และแนวทางช่วยเหลือนักเรียนรายบุคคล",
  },
  project_summary: {
    title: "สรุปโครงการ",
    divisionCode: "ฝย.",
    divisionName: "ฝ่ายยุทธศาสตร์และแผนงาน",
    description: "สรุปผลดำเนินงานโครงการ การใช้งบประมาณ และตัวชี้วัดความสำเร็จ (KPI)",
  },
  single_plan_summary: {
    title: "สรุปแผนเดี่ยว",
    divisionCode: "ฝย.",
    divisionName: "ฝ่ายยุทธศาสตร์และแผนงาน",
    description: "สรุปผลการดำเนินงานตามแผนปฏิบัติการรายบุคคลและร้อยละความสำเร็จ",
  },
};
