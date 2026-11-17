"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  FileCheck2,
  FileText,
  ImagePlus,
  PenTool,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { DocumentPreviewPanel } from "@/components/DocumentPreviewPanel";
import { ResponsivePreviewModal } from "@/components/ResponsivePreviewModal";
import { api, API_BASE, BundleRenderResult, CourseRecord, CourseWeeklyItem, DocType, UserProfile } from "@/lib/api";
import { confirmDanger, toastError, toastInfo, toastSuccess } from "@/lib/swal";

type TeachingTab = "syllabus" | "lesson_plan" | "normal_post" | "online_post";

interface EquipmentItem {
  category: string;
  item: string;
  purpose: string;
}

interface AssessmentItem {
  domain: string;
  weight: string;
  method: string;
  criteria: string;
}

interface RubricItem {
  dimension: string;
  level4: string;
  level3: string;
  level2: string;
  level1: string;
}

interface NormalSubjectEntry {
  course_code: string;
  course_name: string;
  unit_title: string;
  student_group: string;
  total_students: number;
  passed_students: number;
  weekly_attendance: string;
  evaluation_summary: string;
  problems: string;
  solutions: string;
  content_completed: boolean;
  content_note: string;
  time_sufficient: boolean;
  time_note: string;
  media_suitable: boolean;
  media_note: string;
  activities_suitable: boolean;
  activities_note: string;
  assessment_suitable: boolean;
  assessment_note: string;
  other_note: string;
  attitude_ratings: number[];
  attitude_other_label: string;
}

const ATTITUDE_CRITERIA = [
  "1. ความสนใจใฝ่รู้",
  "2. มนุษยสัมพันธ์",
  "3. มีวินัย",
  "4. ความขยัน",
  "5. ความรับผิดชอบ",
  "6. ความคิดสร้างสรรค์",
  "7. ปรัชญาของเศรษฐกิจพอเพียง",
  "8. อื่นๆ",
] as const;

const ATTITUDE_LEVELS = [
  { value: 5, label: "มากที่สุด" },
  { value: 4, label: "มาก" },
  { value: 3, label: "ปานกลาง" },
  { value: 2, label: "น้อย" },
  { value: 1, label: "ปรับปรุง" },
] as const;

interface OnlineSessionEntry {
  date_text: string;
  course_label: string;
  time_text: string;
  class_level: string;
  major_name: string;
  total_students: number;
  present_students: number;
}

interface OnlineSectionEntry {
  course_code: string;
  course_name: string;
  department_name: string;
  level_type: "ปวช." | "ปวส.";
  system_type: "ปกติ" | "ทวิภาคี";
  student_group: string;
  major_name: string;
  total_students: number;
  present_students: number;
  absent_names: string;
  topics_text: string;
  tools: string[];
  other_tool: string;
  assignment: string;
  outcomes_text: string;
  problems: string;
  solutions: string;
  photo_filenames: string[];
}

const EMPTY_COURSE: CourseRecord = {
  course_code: "",
  course_name: "",
  curriculum_level: "ปวช.",
  credits: "1-3-2 (2 หน่วยกิต 4 ชั่วโมง)",
  semester: "2/2569",
  schedule_text: "",
  prerequisite: "วิชาชีพ",
  reference_text: "Internet และเอกสารประกอบการสอน",
  department_name: "",
  division_name: "ฝ่ายวิชาการ",
  objectives: [],
  standards: [],
  description: "",
  knowledge: [],
  skills: [],
  weekly_plan: [],
  instructor_name: "",
  instructor_phone: "",
};

const ONLINE_TOOLS = ["Google Classroom", "Meet", "Zoom", "Facebook", "Line"];

function emptyNormalSubject(): NormalSubjectEntry {
  return {
    course_code: "",
    course_name: "",
    unit_title: "",
    student_group: "",
    total_students: 0,
    passed_students: 0,
    weekly_attendance: "",
    evaluation_summary: "ผู้เรียนผ่านเกณฑ์การประเมินตามจุดประสงค์เชิงพฤติกรรม",
    problems: "-",
    solutions: "-",
    content_completed: true,
    content_note: "",
    time_sufficient: true,
    time_note: "",
    media_suitable: true,
    media_note: "",
    activities_suitable: true,
    activities_note: "",
    assessment_suitable: true,
    assessment_note: "",
    other_note: "",
    attitude_ratings: [0, 0, 0, 0, 0, 0, 0, 0],
    attitude_other_label: "",
  };
}

function emptyOnlineSection(defaultDept = ""): OnlineSectionEntry {
  return {
    course_code: "",
    course_name: "",
    department_name: defaultDept,
    level_type: "ปวช.",
    system_type: "ทวิภาคี",
    student_group: "",
    major_name: "",
    total_students: 0,
    present_students: 0,
    absent_names: "-",
    topics_text: "",
    tools: ["Google Classroom", "Meet", "Line"],
    other_tool: "",
    assignment: "",
    outcomes_text: "",
    problems: "-",
    solutions: "-",
    photo_filenames: [],
  };
}

function SignerComboField({
  label,
  value,
  onChange,
  users,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  users: UserProfile[];
  placeholder: string;
}) {
  return (
    <div className="min-w-0">
      <label className="mb-1 block font-semibold text-[#475569]">{label}</label>
      <div className="flex min-w-0 flex-col gap-1">
        <select
          value={users.some((u) => u.full_name === value) ? value : ""}
          onChange={(e) => {
            if (e.target.value) onChange(e.target.value);
          }}
          className="ledger-input w-full min-w-0 max-w-full py-1 text-[11px]"
        >
          <option value="">-- เลือกจากรายชื่อบุคลากร หรือพิมพ์ด้านล่าง --</option>
          {users.map((u) => (
            <option key={u.id || u.email || u.full_name} value={u.full_name}>
              {u.full_name} ({u.position_title})
            </option>
          ))}
        </select>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="ledger-input py-1 text-xs"
        />
      </div>
    </div>
  );
}

export default function TeachingStudioPage() {
  const [tab, setTab] = useState<TeachingTab>("syllabus");
  const [courses, setCourses] = useState<CourseRecord[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");

  // Course Master (shared by Tab 1 & Tab 2)
  const [courseForm, setCourseForm] = useState<CourseRecord>({ ...EMPTY_COURSE });
  const [objectivesText, setObjectivesText] = useState("");
  const [standardsText, setStandardsText] = useState("");
  const [knowledgeText, setKnowledgeText] = useState("");
  const [skillsText, setSkillsText] = useState("");
  const [moralsText, setMoralsText] = useState("");
  const [indicatorsText, setIndicatorsText] = useState("");
  const [evaluationCriteriaText, setEvaluationCriteriaText] = useState("");
  const [equipmentList, setEquipmentList] = useState<EquipmentItem[]>([]);
  const [assessmentList, setAssessmentList] = useState<AssessmentItem[]>([]);
  const [rubricList, setRubricList] = useState<RubricItem[]>([]);
  const [weeklyPlan, setWeeklyPlan] = useState<CourseWeeklyItem[]>([]);
  const [showAdvancedCourse, setShowAdvancedCourse] = useState(false);

  // Shared Metadata & 4 Signers (Auto-filled from Profile + Users Registry)
  const [normDept, setNormDept] = useState("");
  const [normDivision, setNormDivision] = useState("ฝ่ายวิชาการ");
  const [docNumber, setDocNumber] = useState("ฝว............/2569");
  const [normInstructor, setNormInstructor] = useState("");
  const [normTitle, setNormTitle] = useState("ครู");
  const [normSemester, setNormSemester] = useState("2/2569");
  const [deptHeadName, setDeptHeadName] = useState("");
  const [curriculumHeadName, setCurriculumHeadName] = useState("");
  const [deputyAcademicName, setDeputyAcademicName] = useState("");
  const [showSignersPanel, setShowSignersPanel] = useState(false);
  const [meHasSignature, setMeHasSignature] = useState(false);
  const [includeInstructorSig, setIncludeInstructorSig] = useState(true);

  // Normal 4-Week Post-Teaching (Tab 3)
  const [normDocDate, setNormDocDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [normWeekStart, setNormWeekStart] = useState(1);
  const [normWeekEnd, setNormWeekEnd] = useState(4);
  const [normSubjects, setNormSubjects] = useState<NormalSubjectEntry[]>([emptyNormalSubject()]);

  // Online Weekly Teaching Report (Tab 4)
  const [onlWeekNo, setOnlWeekNo] = useState(1);
  const [onlDateRange, setOnlDateRange] = useState("");
  const [onlDocDate, setOnlDocDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [onlSessions, setOnlSessions] = useState<OnlineSessionEntry[]>([
    { date_text: "", course_label: "", time_text: "", class_level: "", major_name: "", total_students: 0, present_students: 0 },
  ]);
  const [onlSections, setOnlSections] = useState<OnlineSectionEntry[]>([emptyOnlineSection()]);

  // Workflow & Preview
  const previewKeyRef = useRef("");
  const [renderResult, setRenderResult] = useState<BundleRenderResult | null>(null);
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const [previewVersion, setPreviewVersion] = useState(1);
  const [savedDocId, setSavedDocId] = useState<string | null>(null);
  const [reviewerEmail, setReviewerEmail] = useState("orawan@cric.ac.th");
  const [approverEmail, setApproverEmail] = useState("director@cric.ac.th");
  const [busy, setBusy] = useState(false);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiCopilotEnabled, setAiCopilotEnabled] = useState(true);
  const [msg, setMsg] = useState("");

  async function loadCourses() {
    try {
      const res = await api.listCourses(false);
      setCourses(res.courses);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!previewKeyRef.current) {
      previewKeyRef.current = `teach_${Math.random().toString(36).slice(2, 10)}`;
    }
    loadCourses();

    let orgDivisions: Record<string, { name: string; deputy_title?: string }> = {};
    api
      .getPublicSettings()
      .then((pub) => {
        if (typeof pub.ai_copilot_enabled === "boolean") setAiCopilotEnabled(pub.ai_copilot_enabled);
        orgDivisions = pub.org_profile?.divisions || {};
      })
      .catch(() => {});

    api
      .listUsers()
      .then((r) => {
        setUsers(r.users);
        const depAcad = r.users.find(
          (u) => u.is_active && u.role === "deputy_director" && (u.division_code === "ฝว." || u.position_title.includes("วิชาการ"))
        );
        if (depAcad) setDeputyAcademicName((p) => p || depAcad.full_name);
        const currHead = r.users.find(
          (u) => u.is_active && (u.position_title.includes("หลักสูตร") || (u.head_units || []).some((h) => h.includes("หลักสูตร")))
        );
        if (currHead) setCurriculumHeadName((p) => p || currHead.full_name);
      })
      .catch(() => {});

    const applyMyProfile = () => {
      api
        .me()
        .then(({ user }) => {
          if (!user) return;
          const primaryUnit = user.unit_name || user.units?.[0] || "";
          const divCode = user.division_code || user.division_codes?.[0] || "ฝว.";
          const divName = orgDivisions[divCode]?.name || "ฝ่ายวิชาการ";
          setCourseForm((prev) => ({
            ...prev,
            instructor_name: user.full_name || prev.instructor_name,
            instructor_phone: user.phone || prev.instructor_phone,
            instructor_email: user.email || prev.instructor_email || "",
            department_name: primaryUnit || prev.department_name,
            division_name: divName,
          }));
          if (user.full_name) setNormInstructor(user.full_name);
          if (user.position_title) setNormTitle(user.position_title);
          if (primaryUnit) setNormDept((prev) => prev || primaryUnit);
          setNormDivision(divName);
          if (user.default_reviewer_email) setReviewerEmail(user.default_reviewer_email);
          setMeHasSignature(Boolean(user.signature_storage_path));
        })
        .catch(() => {});
    };
    applyMyProfile();
    window.addEventListener("cric-user-changed", applyMyProfile);
    window.addEventListener("cric-profile-updated", applyMyProfile);
    return () => {
      window.removeEventListener("cric-user-changed", applyMyProfile);
      window.removeEventListener("cric-profile-updated", applyMyProfile);
    };
  }, []);

  // Auto-match Department Head whenever normDept or users updates
  useEffect(() => {
    if (!normDept || !users.length) return;
    const headUser = users.find((u) => u.is_active && (u.head_units || []).includes(normDept));
    if (headUser) {
      setDeptHeadName((prev) => prev || headUser.full_name);
    }
  }, [normDept, users]);

  function applyCourseToForm(c: CourseRecord) {
    setSelectedCourseId(c.id || "");
    setCourseForm(c);
    setObjectivesText((c.objectives_json || c.objectives || []).join("\n"));
    setStandardsText((c.standards_json || c.standards || []).join("\n"));
    setKnowledgeText((c.knowledge_json || c.knowledge || []).join("\n"));
    setSkillsText((c.skills_json || c.skills || []).join("\n"));
    setMoralsText((c.morals || []).join("\n"));
    setIndicatorsText((c.indicators || []).join("\n"));
    setEvaluationCriteriaText((c.evaluation_criteria || []).join("\n"));
    setEquipmentList(c.equipment_json || c.equipment || []);
    setAssessmentList(c.assessment_json || c.assessment || []);
    setRubricList(c.rubric_json || c.rubric || []);
    setWeeklyPlan(c.weekly_plan_json || c.weekly_plan || []);
  }

  function currentCoursePayload(): CourseRecord {
    return {
      ...courseForm,
      id: selectedCourseId || undefined,
      objectives: objectivesText.split("\n").map((s) => s.trim()).filter(Boolean),
      standards: standardsText.split("\n").map((s) => s.trim()).filter(Boolean),
      knowledge: knowledgeText.split("\n").map((s) => s.trim()).filter(Boolean),
      skills: skillsText.split("\n").map((s) => s.trim()).filter(Boolean),
      morals: moralsText.split("\n").map((s) => s.trim()).filter(Boolean),
      indicators: indicatorsText.split("\n").map((s) => s.trim()).filter(Boolean),
      evaluation_criteria: evaluationCriteriaText.split("\n").map((s) => s.trim()).filter(Boolean),
      equipment: equipmentList,
      assessment: assessmentList,
      rubric: rubricList,
      weekly_plan: weeklyPlan,
    };
  }

  async function handleSaveCourse() {
    if (!courseForm.course_code.trim() || !courseForm.course_name.trim()) {
      const m = "กรุณาระบุรหัสวิชาและชื่อวิชา";
      setMsg(m);
      toastInfo("ข้อมูลไม่ครบถ้วน", m);
      return;
    }
    setBusy(true);
    try {
      const res = await api.saveCourse(currentCoursePayload());
      await loadCourses();
      applyCourseToForm(res.course);
      const m = `บันทึกรายวิชา "${res.course.course_code} ${res.course.course_name}" ลงคลังรายวิชาแล้ว`;
      setMsg(m);
      toastSuccess("บันทึกรายวิชาสำเร็จ", `${res.course.course_code} ${res.course.course_name}`);
    } catch (err) {
      const m = err instanceof Error ? err.message : "บันทึกรายวิชาไม่สำเร็จ";
      setMsg(m);
      toastError("บันทึกรายวิชาไม่สำเร็จ", m);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteCourse(courseId: string) {
    if (!courseId) return;
    const ok = await confirmDanger({
      title: `ลบรายวิชา "${courseForm.course_code} ${courseForm.course_name}"?`,
      text: "รายวิชาและแผนการสอน 18 สัปดาห์ที่บันทึกไว้ในคลังจะถูกลบออกอย่างถาวร",
      confirmText: "ลบรายวิชา",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.deleteCourse(courseId);
      setSelectedCourseId("");
      setCourseForm({ ...EMPTY_COURSE });
      setObjectivesText("");
      setStandardsText("");
      setKnowledgeText("");
      setSkillsText("");
      setMoralsText("");
      setIndicatorsText("");
      setEvaluationCriteriaText("");
      setEquipmentList([]);
      setAssessmentList([]);
      setRubricList([]);
      setWeeklyPlan([]);
      await loadCourses();
      setMsg("ลบรายวิชาออกจากคลังเรียบร้อยแล้ว");
      toastSuccess("ลบรายวิชาเรียบร้อยแล้ว");
    } catch (err) {
      const m = err instanceof Error ? err.message : "ลบรายวิชาไม่สำเร็จ";
      setMsg(m);
      toastError("ลบรายวิชาไม่สำเร็จ", m);
    } finally {
      setBusy(false);
    }
  }

  async function handleAiDraftCourse() {
    if (!courseForm.course_name.trim() && !courseForm.course_code.trim()) {
      const m = "กรุณาใส่รหัสวิชา หรือชื่อวิชาก่อนให้ AI ช่วยร่าง";
      setMsg(m);
      toastInfo("กรุณาระบุข้อมูลวิชา", m);
      return;
    }
    setAiLoading(true);
    setMsg("");
    try {
      const res = await api.aiDraftTeaching({
        mode: "course_plan",
        course_code: courseForm.course_code,
        course_name: courseForm.course_name,
        curriculum_level: courseForm.curriculum_level,
        description: courseForm.description,
      });
      if (Array.isArray(res.objectives)) setObjectivesText((res.objectives as string[]).join("\n"));
      if (Array.isArray(res.standards)) setStandardsText((res.standards as string[]).join("\n"));
      if (typeof res.description === "string") setCourseForm((p) => ({ ...p, description: res.description as string }));
      if (Array.isArray(res.knowledge)) setKnowledgeText((res.knowledge as string[]).join("\n"));
      if (Array.isArray(res.skills)) setSkillsText((res.skills as string[]).join("\n"));
      if (Array.isArray(res.morals)) setMoralsText((res.morals as string[]).join("\n"));
      if (Array.isArray(res.indicators)) setIndicatorsText((res.indicators as string[]).join("\n"));
      if (Array.isArray(res.evaluation_criteria)) setEvaluationCriteriaText((res.evaluation_criteria as string[]).join("\n"));
      if (Array.isArray(res.equipment)) setEquipmentList(res.equipment as EquipmentItem[]);
      if (Array.isArray(res.assessment)) setAssessmentList(res.assessment as AssessmentItem[]);
      if (Array.isArray(res.rubric)) setRubricList(res.rubric as RubricItem[]);
      if (Array.isArray(res.weekly_plan)) setWeeklyPlan(res.weekly_plan as CourseWeeklyItem[]);
      const modeLabel = String(res.mode || "template");
      setMsg(`AI (${modeLabel}) ร่างโครงสร้างรายวิชา สื่อ/รูบริค และตาราง 18 สัปดาห์ให้เรียบร้อยแล้ว`);
      toastSuccess("AI ร่างแผน 18 สัปดาห์สำเร็จ", `โหมด ${modeLabel}`);
    } catch (err) {
      const m = err instanceof Error ? err.message : "AI ร่างแผนไม่สำเร็จ";
      setMsg(m);
      toastError("AI ร่างแผนไม่สำเร็จ", m);
    } finally {
      setAiLoading(false);
    }
  }

  async function handleAiPostTeachingNormal(subIdx: number) {
    const sub = normSubjects[subIdx];
    if (!sub?.course_name.trim() && !sub?.course_code.trim()) {
      toastInfo("กรุณาระบุรหัสวิชาหรือชื่อวิชา", "กรอกชื่อวิชาก่อนกดให้ AI ช่วยเขียน");
      return;
    }
    setAiLoading(true);
    try {
      const res = await api.aiDraftTeaching({
        mode: "post_teaching",
        course_code: sub.course_code,
        course_name: sub.course_name,
        prompt: `สัปดาห์ที่ ${normWeekStart}-${normWeekEnd} กลุ่ม ${sub.student_group || "-"} หน่วย ${sub.unit_title || "-"}`,
      });
      setNormSubjects((prev) =>
        prev.map((x, i) =>
          i === subIdx
            ? {
                ...x,
                weekly_attendance: typeof res.weekly_attendance === "string" ? res.weekly_attendance : x.weekly_attendance,
                evaluation_summary: typeof res.evaluation_summary === "string" ? res.evaluation_summary : x.evaluation_summary,
                problems: typeof res.problems === "string" ? res.problems : x.problems,
                solutions: typeof res.solutions === "string" ? res.solutions : x.solutions,
              }
            : x
        )
      );
      toastSuccess("AI สรุปผลบันทึกหลังสอนให้แล้ว");
    } catch (err) {
      toastError("AI ไม่สามารถสรุปผลได้", err instanceof Error ? err.message : "ข้อผิดพลาด");
    } finally {
      setAiLoading(false);
    }
  }

  async function handleAiPostTeachingOnline(secIdx: number) {
    const sec = onlSections[secIdx];
    if (!sec?.course_name.trim() && !sec?.course_code.trim()) {
      toastInfo("กรุณาระบุรหัสวิชาหรือชื่อวิชา", "กรอกชื่อวิชาก่อนกดให้ AI ช่วยเขียน");
      return;
    }
    setAiLoading(true);
    try {
      const res = await api.aiDraftTeaching({
        mode: "post_teaching",
        course_code: sec.course_code,
        course_name: sec.course_name,
        prompt: `รายงานการสอนออนไลน์ สัปดาห์ที่ ${onlWeekNo} ระดับ ${sec.level_type} (${sec.system_type})`,
      });
      setOnlSections((prev) =>
        prev.map((x, i) =>
          i === secIdx
            ? {
                ...x,
                topics_text: Array.isArray(res.topics) ? (res.topics as string[]).join("\n") : x.topics_text,
                outcomes_text: Array.isArray(res.outcomes) ? (res.outcomes as string[]).join("\n") : x.outcomes_text,
                assignment: typeof res.assignment === "string" ? res.assignment : x.assignment,
                problems: typeof res.problems === "string" ? res.problems : x.problems,
                solutions: typeof res.solutions === "string" ? res.solutions : x.solutions,
              }
            : x
        )
      );
      toastSuccess("AI สรุปผลสอนออนไลน์ให้แล้ว");
    } catch (err) {
      toastError("AI ไม่สามารถสรุปผลได้", err instanceof Error ? err.message : "ข้อผิดพลาด");
    } finally {
      setAiLoading(false);
    }
  }

  async function handleUploadOnlinePhoto(secIdx: number, files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const uploadedNames: string[] = [];
      for (const file of Array.from(files)) {
        const res = await api.uploadTeachingPhoto(file);
        uploadedNames.push(res.filename);
      }
      setOnlSections((prev) =>
        prev.map((s, i) => (i === secIdx ? { ...s, photo_filenames: [...s.photo_filenames, ...uploadedNames] } : s))
      );
      const m = `อัปโหลดรูปภาพหลักฐานสำเร็จ ${uploadedNames.length} รูป`;
      setMsg(m);
      toastSuccess(m);
    } catch (err) {
      const m = err instanceof Error ? err.message : "อัปโหลดรูปไม่สำเร็จ";
      setMsg(m);
      toastError("อัปโหลดรูปไม่สำเร็จ", m);
    } finally {
      setBusy(false);
    }
  }

  function sharedSignerFields() {
    return {
      department_name: normDept || courseForm.department_name || "แผนกวิชา",
      division_name: normDivision || "ฝ่ายวิชาการ",
      doc_number: docNumber,
      instructor_name: normInstructor || courseForm.instructor_name,
      instructor_title: normTitle,
      semester: normSemester,
      dept_head_name: deptHeadName,
      curriculum_head_name: curriculumHeadName,
      deputy_academic_name: deputyAcademicName,
      include_instructor_signature: includeInstructorSig,
    };
  }

  function buildTeachingRequest(): { docType: DocType; payload: Record<string, unknown>; subject: string } {
    if (tab === "syllabus") {
      const c = currentCoursePayload();
      return {
        docType: "course_syllabus",
        payload: {
          ...c,
          ...sharedSignerFields(),
        } as unknown as Record<string, unknown>,
        subject: `กำหนดการสอน ${c.course_code} ${c.course_name}`.trim(),
      };
    }
    if (tab === "lesson_plan") {
      const c = currentCoursePayload();
      return {
        docType: "lesson_plan",
        payload: {
          ...c,
          ...sharedSignerFields(),
        } as unknown as Record<string, unknown>,
        subject: `แผนการจัดการเรียนรู้ ${c.course_code} ${c.course_name}`.trim(),
      };
    }
    if (tab === "normal_post") {
      return {
        docType: "post_teaching_normal",
        payload: {
          ...sharedSignerFields(),
          doc_date: normDocDate,
          week_start: normWeekStart,
          week_end: normWeekEnd,
          subjects: normSubjects,
        },
        subject: `รายงานบันทึกหลังการสอน สัปดาห์ที่ ${normWeekStart}-${normWeekEnd}`,
      };
    }
    return {
      docType: "post_teaching_online",
      payload: {
        ...sharedSignerFields(),
        doc_date: onlDocDate,
        week_number: onlWeekNo,
        date_range_text: onlDateRange,
        sessions: onlSessions,
        online_sections: onlSections.map((s) => ({
          ...s,
          topics: s.topics_text.split("\n").map((x) => x.trim()).filter(Boolean),
          outcomes: s.outcomes_text.split("\n").map((x) => x.trim()).filter(Boolean),
        })),
      },
      subject: `รายงานการสอนออนไลน์ สัปดาห์ที่ ${onlWeekNo}`,
    };
  }

  async function handleRender() {
    setBusy(true);
    setMsg("");
    try {
      const { docType, payload } = buildTeachingRequest();
      const res = await api.renderTeachingBundle(docType, payload, true, previewKeyRef.current);
      setRenderResult(res);
      setActiveFileIdx(0);
      setPreviewVersion((v) => v + 1);
      const m = `สร้างเอกสารเรียบร้อยแล้ว (${res.bundle_files.length} ไฟล์)`;
      setMsg(m);
      toastSuccess(m);
    } catch (err) {
      const m = err instanceof Error ? err.message : "สร้างเอกสารไม่สำเร็จ";
      setMsg(m);
      toastError("สร้างเอกสารไม่สำเร็จ", m);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveOrSubmit(submitAfterSave: boolean) {
    setBusy(true);
    setMsg("");
    try {
      const { docType, payload, subject } = buildTeachingRequest();
      const saveRes = await api.saveTeachingBundle(docType, payload, "ฝว.", subject, savedDocId || undefined);
      setSavedDocId(saveRes.document.id);
      setRenderResult(saveRes.render);
      setActiveFileIdx(0);
      setPreviewVersion((v) => v + 1);
      if (submitAfterSave) {
        await api.submitBundle(saveRes.document.id, reviewerEmail || null, approverEmail);
        setMsg(`ส่ง "${subject}" เข้าคิวตรวจลงนาม (/approvals) เรียบร้อยแล้ว`);
        toastSuccess("ส่งตรวจและลงนามเรียบร้อย", subject);
      } else {
        setMsg(`บันทึก "${subject}" ลงระบบเรียบร้อยแล้ว`);
        toastSuccess("บันทึกร่างเรียบร้อย", subject);
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : "บันทึก/ส่งไม่สำเร็จ";
      setMsg(m);
      toastError("บันทึกหรือส่งไม่สำเร็จ", m);
    } finally {
      setBusy(false);
    }
  }

  const activeFile = renderResult?.bundle_files?.[activeFileIdx] || null;

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
      {/* Mode Ledger Bar */}
      <div className="ledger-panel flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["syllabus", "1. กำหนดการสอน / รายวิชา"],
              ["lesson_plan", "2. แผน 18 สัปดาห์"],
              ["normal_post", "3. หลังสอนปกติ (4 สัปดาห์)"],
              ["online_post", "4. สอนออนไลน์และรูปถ่าย"],
            ] as Array<[TeachingTab, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                tab === id
                  ? "bg-[#1D4ED8] text-white"
                  : "bg-[#F8FAFC] text-[#334155] ring-1 ring-[#CBD5E1] hover:bg-slate-100 hover:text-[#0F172A]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-[#475569]">คลังรายวิชาและรายงานผลตามแบบฟอร์มวิทยาลัย</span>
      </div>

      {msg && (
        <div className="rounded-md border border-blue-300 bg-[#EFF6FF] px-4 py-2.5 text-sm font-medium text-[#1E3A8A]">
          {msg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* Left Form Column */}
        <div className="min-w-0 space-y-4 xl:col-span-6">
          {(tab === "syllabus" || tab === "lesson_plan") && (
            <section className="ledger-panel overflow-hidden text-xs">
              <div className="ledger-panel-header flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm font-bold text-[#0F172A]">
                  <BookOpen className="h-4 w-4 text-[#1D4ED8]" />
                  <span>คลังรายวิชา ({courses.length} วิชา)</span>
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCourseId("");
                      setCourseForm({ ...EMPTY_COURSE });
                      setObjectivesText("");
                      setStandardsText("");
                      setKnowledgeText("");
                      setSkillsText("");
                      setMoralsText("");
                      setIndicatorsText("");
                      setEvaluationCriteriaText("");
                      setEquipmentList([]);
                      setAssessmentList([]);
                      setRubricList([]);
                      setWeeklyPlan([]);
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1 font-semibold text-[#0F172A] hover:bg-slate-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    รายวิชาใหม่
                  </button>
                  {aiCopilotEnabled && (
                    <button
                      type="button"
                      disabled={aiLoading}
                      onClick={handleAiDraftCourse}
                      className="inline-flex items-center gap-1 rounded-md bg-[#1D4ED8] px-2.5 py-1 font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-50"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {aiLoading ? "AI กำลังร่าง..." : "AI ช่วยร่าง 18 สัปดาห์"}
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-3 p-4">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <select
                    value={selectedCourseId}
                    onChange={(e) => {
                      const found = courses.find((c) => c.id === e.target.value);
                      if (found) applyCourseToForm(found);
                    }}
                    className="ledger-input w-full min-w-0 flex-1 py-1.5 text-xs"
                  >
                    <option value="">-- เลือกรายวิชาที่บันทึกไว้ หรือสร้างวิชาใหม่ด้านล่าง --</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.course_code} : {c.course_name} ({c.curriculum_level})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleSaveCourse}
                    className="inline-flex items-center gap-1 rounded-md bg-[#0F172A] px-3 py-1.5 font-semibold text-white hover:bg-[#1E293B]"
                  >
                    <Save className="h-3.5 w-3.5" />
                    บันทึกเข้าคลังวิชา
                  </button>
                  {selectedCourseId && (
                    <button
                      type="button"
                      onClick={() => handleDeleteCourse(selectedCourseId)}
                      className="rounded-md border border-red-200 px-2.5 py-1.5 text-[#B91C1C] hover:bg-red-50"
                      title="ลบรายวิชานี้"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Course Fields */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">รหัสวิชา *</label>
                    <input type="text" placeholder="เช่น 21910-2013" value={courseForm.course_code} onChange={(e) => setCourseForm({ ...courseForm, course_code: e.target.value })} className="ledger-input tabular-nums-th py-1.5 text-xs" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block font-semibold text-[#475569]">ชื่อวิชา *</label>
                    <input type="text" placeholder="เช่น ระบบเครือข่ายคอมพิวเตอร์" value={courseForm.course_name} onChange={(e) => setCourseForm({ ...courseForm, course_name: e.target.value })} className="ledger-input py-1.5 text-xs" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">ระดับชั้น</label>
                    <input type="text" value={courseForm.curriculum_level} onChange={(e) => setCourseForm({ ...courseForm, curriculum_level: e.target.value })} className="ledger-input py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">ท-ป-น (หน่วยกิต)</label>
                    <input type="text" value={courseForm.credits} onChange={(e) => setCourseForm({ ...courseForm, credits: e.target.value })} className="ledger-input tabular-nums-th py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">ภาคเรียน</label>
                    <input type="text" value={courseForm.semester} onChange={(e) => setCourseForm({ ...courseForm, semester: e.target.value })} className="ledger-input tabular-nums-th py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">วัน–เวลาสอน</label>
                    <input type="text" value={courseForm.schedule_text} onChange={(e) => setCourseForm({ ...courseForm, schedule_text: e.target.value })} placeholder="เช่น จันทร์ 08.10-12.10" className="ledger-input py-1.5 text-xs" />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">ผู้สอน</label>
                    <input type="text" value={courseForm.instructor_name} onChange={(e) => setCourseForm({ ...courseForm, instructor_name: e.target.value })} className="ledger-input py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">โทรศัพท์</label>
                    <input type="text" value={courseForm.instructor_phone} onChange={(e) => setCourseForm({ ...courseForm, instructor_phone: e.target.value })} className="ledger-input tabular-nums-th py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">อีเมล</label>
                    <input type="text" value={courseForm.instructor_email || ""} onChange={(e) => setCourseForm({ ...courseForm, instructor_email: e.target.value })} className="ledger-input py-1.5 text-xs" />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">คำอธิบายรายวิชา</label>
                  <textarea rows={2} value={courseForm.description} onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })} className="ledger-input prose-saraban py-1.5 text-xs" />
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">จุดประสงค์รายวิชา (บรรทัดละข้อ)</label>
                    <textarea rows={3} value={objectivesText} onChange={(e) => setObjectivesText(e.target.value)} className="ledger-input prose-saraban py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">มาตรฐาน/สมรรถนะรายวิชา (บรรทัดละข้อ)</label>
                    <textarea rows={3} value={standardsText} onChange={(e) => setStandardsText(e.target.value)} className="ledger-input prose-saraban py-1.5 text-xs" />
                  </div>
                </div>

                {/* Collapsible Advanced Syllabus & Lesson Plan Tables (Knowledge/Skills/Morals/Indicators/Equipment/Rubric) */}
                <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC]">
                  <button
                    type="button"
                    onClick={() => setShowAdvancedCourse((v) => !v)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-bold text-[#0F172A] hover:bg-slate-100"
                  >
                    <span>รายละเอียดเพิ่มเติม (ความรู้/ทักษะ/คุณธรรม/ตัวชี้วัด/สื่อ-อุปกรณ์/รูบริค)</span>
                    {showAdvancedCourse ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  {showAdvancedCourse && (
                    <div className="space-y-3 border-t border-[#E2E8F0] p-3">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block font-semibold text-[#475569]">ความรู้ (บรรทัดละข้อ)</label>
                          <textarea rows={2} value={knowledgeText} onChange={(e) => setKnowledgeText(e.target.value)} className="ledger-input prose-saraban py-1 text-xs" />
                        </div>
                        <div>
                          <label className="mb-1 block font-semibold text-[#475569]">ทักษะ (บรรทัดละข้อ)</label>
                          <textarea rows={2} value={skillsText} onChange={(e) => setSkillsText(e.target.value)} className="ledger-input prose-saraban py-1 text-xs" />
                        </div>
                        <div>
                          <label className="mb-1 block font-semibold text-[#475569]">คุณธรรม จริยธรรม (บรรทัดละข้อ)</label>
                          <textarea rows={2} value={moralsText} onChange={(e) => setMoralsText(e.target.value)} className="ledger-input prose-saraban py-1 text-xs" />
                        </div>
                        <div>
                          <label className="mb-1 block font-semibold text-[#475569]">ตัวชี้วัดและเกณฑ์การประเมิน (บรรทัดละข้อ)</label>
                          <textarea rows={2} value={indicatorsText} onChange={(e) => setIndicatorsText(e.target.value)} placeholder="ตัวชี้วัดผลลัพธ์การเรียนรู้..." className="ledger-input prose-saraban py-1 text-xs" />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block font-semibold text-[#475569]">เกณฑ์การประเมินผลรวม (บรรทัดละข้อ)</label>
                        <textarea rows={2} value={evaluationCriteriaText} onChange={(e) => setEvaluationCriteriaText(e.target.value)} placeholder="เช่น ด้านความรู้ 30% / ทักษะปฏิบัติ 50% / จิตพิสัย 20%" className="ledger-input prose-saraban py-1 text-xs" />
                      </div>

                      {/* Equipment List (T2) */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[#0F172A]">สื่อ / อุปกรณ์ / เครื่องมือ ({equipmentList.length} รายการ)</span>
                          <button
                            type="button"
                            onClick={() => setEquipmentList((p) => [...p, { category: "สื่อ/อุปกรณ์", item: "", purpose: "" }])}
                            className="rounded border border-[#CBD5E1] bg-white px-2 py-0.5 text-[11px] font-semibold hover:bg-slate-50"
                          >
                            + เพิ่มรายการ
                          </button>
                        </div>
                        {equipmentList.map((eq, idx) => (
                          <div key={idx} className="grid grid-cols-12 gap-1.5">
                            <input type="text" placeholder="ประเภท" value={eq.category} onChange={(e) => setEquipmentList((p) => p.map((x, i) => (i === idx ? { ...x, category: e.target.value } : x)))} className="ledger-input col-span-3 py-1 text-xs" />
                            <input type="text" placeholder="รายการอุปกรณ์/สื่อ" value={eq.item} onChange={(e) => setEquipmentList((p) => p.map((x, i) => (i === idx ? { ...x, item: e.target.value } : x)))} className="ledger-input col-span-4 py-1 text-xs" />
                            <input type="text" placeholder="วัตถุประสงค์การใช้งาน" value={eq.purpose} onChange={(e) => setEquipmentList((p) => p.map((x, i) => (i === idx ? { ...x, purpose: e.target.value } : x)))} className="ledger-input col-span-4 py-1 text-xs" />
                            <button type="button" onClick={() => setEquipmentList((p) => p.filter((_, i) => i !== idx))} className="col-span-1 flex items-center justify-center text-slate-400 hover:text-[#B91C1C]">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Assessment Domains (T3) */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[#0F172A]">สัดส่วนการวัดและประเมินผล ({assessmentList.length} มิติ)</span>
                          <button
                            type="button"
                            onClick={() => setAssessmentList((p) => [...p, { domain: "ด้านความรู้", weight: "30%", method: "", criteria: "" }])}
                            className="rounded border border-[#CBD5E1] bg-white px-2 py-0.5 text-[11px] font-semibold hover:bg-slate-50"
                          >
                            + เพิ่มมิติ
                          </button>
                        </div>
                        {assessmentList.map((a, idx) => (
                          <div key={idx} className="grid grid-cols-12 gap-1.5">
                            <input type="text" placeholder="มิติการประเมิน" value={a.domain} onChange={(e) => setAssessmentList((p) => p.map((x, i) => (i === idx ? { ...x, domain: e.target.value } : x)))} className="ledger-input col-span-3 py-1 text-xs" />
                            <input type="text" placeholder="สัดส่วน" value={a.weight} onChange={(e) => setAssessmentList((p) => p.map((x, i) => (i === idx ? { ...x, weight: e.target.value } : x)))} className="ledger-input col-span-2 py-1 text-xs" />
                            <input type="text" placeholder="วิธีการวัดผล" value={a.method} onChange={(e) => setAssessmentList((p) => p.map((x, i) => (i === idx ? { ...x, method: e.target.value } : x)))} className="ledger-input col-span-3 py-1 text-xs" />
                            <input type="text" placeholder="เกณฑ์ความสำเร็จ" value={a.criteria} onChange={(e) => setAssessmentList((p) => p.map((x, i) => (i === idx ? { ...x, criteria: e.target.value } : x)))} className="ledger-input col-span-3 py-1 text-xs" />
                            <button type="button" onClick={() => setAssessmentList((p) => p.filter((_, i) => i !== idx))} className="col-span-1 flex items-center justify-center text-slate-400 hover:text-[#B91C1C]">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Rubric (T4) */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[#0F172A]">เกณฑ์รูบริคสมรรถนะ 4 ระดับ ({rubricList.length} ข้อ)</span>
                          <button
                            type="button"
                            onClick={() => setRubricList((p) => [...p, { dimension: "", level4: "", level3: "", level2: "", level1: "" }])}
                            className="rounded border border-[#CBD5E1] bg-white px-2 py-0.5 text-[11px] font-semibold hover:bg-slate-50"
                          >
                            + เพิ่มเกณฑ์รูบริค
                          </button>
                        </div>
                        {rubricList.map((rb, idx) => (
                          <div key={idx} className="space-y-1 rounded border border-[#CBD5E1] bg-white p-2">
                            <div className="flex items-center gap-1.5">
                              <input type="text" placeholder="หัวข้อประเมินสมรรถนะ" value={rb.dimension} onChange={(e) => setRubricList((p) => p.map((x, i) => (i === idx ? { ...x, dimension: e.target.value } : x)))} className="ledger-input flex-1 py-1 text-xs font-semibold" />
                              <button type="button" onClick={() => setRubricList((p) => p.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-[#B91C1C]">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                              <input type="text" placeholder="ดีมาก (4)" value={rb.level4} onChange={(e) => setRubricList((p) => p.map((x, i) => (i === idx ? { ...x, level4: e.target.value } : x)))} className="ledger-input py-1 text-[11px]" />
                              <input type="text" placeholder="ดี (3)" value={rb.level3} onChange={(e) => setRubricList((p) => p.map((x, i) => (i === idx ? { ...x, level3: e.target.value } : x)))} className="ledger-input py-1 text-[11px]" />
                              <input type="text" placeholder="พอใช้ (2)" value={rb.level2} onChange={(e) => setRubricList((p) => p.map((x, i) => (i === idx ? { ...x, level2: e.target.value } : x)))} className="ledger-input py-1 text-[11px]" />
                              <input type="text" placeholder="ปรับปรุง (1)" value={rb.level1} onChange={(e) => setRubricList((p) => p.map((x, i) => (i === idx ? { ...x, level1: e.target.value } : x)))} className="ledger-input py-1 text-[11px]" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Weekly Schedule Editor */}
                <div className="border-t border-[#E2E8F0] pt-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-bold text-[#0F172A]">ตารางการสอนรายสัปดาห์ ({weeklyPlan.length} สัปดาห์)</span>
                    <button
                      type="button"
                      onClick={() =>
                        setWeeklyPlan((prev) => [
                          ...prev,
                          {
                            week: prev.length + 1,
                            topic: "",
                            subtopics: "",
                            behavioral_objectives: "",
                            activities: "",
                            media: "",
                            evaluation: "",
                            competency: "",
                            theory_hours: 1,
                            practice_hours: 3,
                          },
                        ])
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1 font-semibold text-[#0F172A] hover:bg-slate-50"
                    >
                      <Plus className="h-3 w-3" />
                      เพิ่มสัปดาห์
                    </button>
                  </div>
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {weeklyPlan.map((wk, idx) => (
                      <div key={idx} className="space-y-1.5 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="tabular-nums-th rounded bg-[#0F172A] px-2 py-0.5 text-[11px] font-bold text-white">สัปดาห์ {wk.week}</span>
                          <input
                            type="text"
                            placeholder="หัวข้อ / หน่วยการเรียนรู้"
                            value={wk.topic}
                            onChange={(e) => setWeeklyPlan((p) => p.map((x, i) => (i === idx ? { ...x, topic: e.target.value } : x)))}
                            className="ledger-input min-w-[160px] flex-1 py-1 text-xs"
                          />
                          <div className="flex items-center gap-1 text-[11px] text-[#475569]">
                            <span>ท</span>
                            <input
                              type="number"
                              min={0}
                              value={wk.theory_hours ?? 1}
                              onChange={(e) => setWeeklyPlan((p) => p.map((x, i) => (i === idx ? { ...x, theory_hours: Number(e.target.value) } : x)))}
                              className="ledger-input tabular-nums-th w-11 py-0.5 text-center text-xs"
                            />
                            <span>ป</span>
                            <input
                              type="number"
                              min={0}
                              value={wk.practice_hours ?? 3}
                              onChange={(e) => setWeeklyPlan((p) => p.map((x, i) => (i === idx ? { ...x, practice_hours: Number(e.target.value) } : x)))}
                              className="ledger-input tabular-nums-th w-11 py-0.5 text-center text-xs"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => setWeeklyPlan((p) => p.filter((_, i) => i !== idx))}
                            className="text-slate-400 hover:text-[#B91C1C]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                          <input type="text" placeholder="สาระการเรียนรู้ / หัวข้อย่อย" value={wk.subtopics || ""} onChange={(e) => setWeeklyPlan((p) => p.map((x, i) => (i === idx ? { ...x, subtopics: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                          <input type="text" placeholder="จุดประสงค์เชิงพฤติกรรม" value={wk.behavioral_objectives || ""} onChange={(e) => setWeeklyPlan((p) => p.map((x, i) => (i === idx ? { ...x, behavioral_objectives: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                          <input type="text" placeholder="กิจกรรมการสอน" value={wk.activities} onChange={(e) => setWeeklyPlan((p) => p.map((x, i) => (i === idx ? { ...x, activities: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                          <input type="text" placeholder="สื่อ / อุปกรณ์การสอน" value={wk.media} onChange={(e) => setWeeklyPlan((p) => p.map((x, i) => (i === idx ? { ...x, media: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                          <input type="text" placeholder="ภาระงาน / การประเมินผล" value={wk.evaluation} onChange={(e) => setWeeklyPlan((p) => p.map((x, i) => (i === idx ? { ...x, evaluation: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                          <input type="text" placeholder="สมรรถนะ / ผลลัพธ์การเรียนรู้" value={wk.competency} onChange={(e) => setWeeklyPlan((p) => p.map((x, i) => (i === idx ? { ...x, competency: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Tab 3: Normal 4-Week Post-Teaching */}
          {tab === "normal_post" && (
            <section className="ledger-panel overflow-hidden text-xs">
              <div className="ledger-panel-header">
                <h2 className="text-sm font-bold text-[#0F172A]">รายงานบันทึกหลังการสอนปกติ (ราย 4 สัปดาห์)</h2>
              </div>
              <div className="space-y-3 p-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">แผนกวิชา</label>
                    <input type="text" value={normDept} onChange={(e) => setNormDept(e.target.value)} placeholder="แผนกวิชา" className="ledger-input py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">เลขที่หนังสือ (ที่ ...)</label>
                    <input type="text" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder="ฝว............/2569" className="ledger-input tabular-nums-th py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">วันที่บันทึก</label>
                    <input type="date" value={normDocDate} onChange={(e) => setNormDocDate(e.target.value)} className="ledger-input tabular-nums-th py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">ชื่อครูผู้สอน</label>
                    <input type="text" value={normInstructor} onChange={(e) => setNormInstructor(e.target.value)} placeholder="ชื่อครูผู้สอน" className="ledger-input py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">ภาคเรียนที่</label>
                    <input type="text" value={normSemester} onChange={(e) => setNormSemester(e.target.value)} placeholder="เช่น 2/2569" className="ledger-input tabular-nums-th py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">ช่วงสัปดาห์ที่</label>
                    <div className="flex items-center gap-1.5">
                      <input type="number" min={1} value={normWeekStart} onChange={(e) => setNormWeekStart(Number(e.target.value))} className="ledger-input tabular-nums-th w-16 py-1.5 text-xs" />
                      <span className="text-[#475569]">ถึง</span>
                      <input type="number" min={1} value={normWeekEnd} onChange={(e) => setNormWeekEnd(Number(e.target.value))} className="ledger-input tabular-nums-th w-16 py-1.5 text-xs" />
                    </div>
                  </div>
                </div>

                {courses.length > 0 && (
                  <div className="rounded-md border border-blue-200 bg-[#EFF6FF] p-2.5">
                    <span className="font-semibold text-[#1E3A8A]">ดึงรายวิชาจากคลัง:</span>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {courses.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() =>
                            setNormSubjects((prev) => [
                              ...prev.filter((s) => s.course_code || s.course_name),
                              {
                                ...emptyNormalSubject(),
                                course_code: c.course_code,
                                course_name: c.course_name,
                                unit_title: c.weekly_plan_json?.[0]?.topic || "",
                                student_group: c.curriculum_level,
                                total_students: 20,
                                passed_students: 20,
                                weekly_attendance: `สัปดาห์ที่ ${normWeekStart}-${normWeekEnd} เข้าเรียนครบ`,
                              },
                            ])
                          }
                          className="rounded border border-blue-200 bg-white px-2 py-1 text-[11px] font-semibold text-[#1E3A8A] hover:bg-blue-100"
                        >
                          + {c.course_code} {c.course_name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  {normSubjects.map((sub, idx) => (
                    <div key={idx} className="space-y-2 rounded-md border border-[#CBD5E1] bg-[#F8FAFC] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 font-bold text-[#0F172A]">
                        <span>รายวิชาที่ {idx + 1}</span>
                        <div className="flex items-center gap-2">
                          {aiCopilotEnabled && (
                            <button
                              type="button"
                              disabled={aiLoading}
                              onClick={() => handleAiPostTeachingNormal(idx)}
                              className="inline-flex items-center gap-1 rounded bg-[#1D4ED8] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-50"
                            >
                              <Sparkles className="h-3 w-3" />
                              AI ช่วยเขียนหลังสอน
                            </button>
                          )}
                          <button type="button" onClick={() => setNormSubjects((p) => p.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-[#B91C1C]">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <input type="text" placeholder="รหัสวิชา" value={sub.course_code} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, course_code: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                        <input type="text" placeholder="ชื่อวิชา" value={sub.course_name} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, course_name: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                        <input type="text" placeholder="หน่วย/เรื่อง" value={sub.unit_title} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, unit_title: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                        <input type="text" placeholder="กลุ่มเรียน" value={sub.student_group} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, student_group: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                        <input type="number" min={0} placeholder="ผู้เรียนทั้งหมด (คน)" value={sub.total_students} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, total_students: Number(e.target.value) } : x)))} className="ledger-input tabular-nums-th py-1 text-xs" />
                        <input type="number" min={0} placeholder="ผ่านเกณฑ์ (คน)" value={sub.passed_students} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, passed_students: Number(e.target.value) } : x)))} className="ledger-input tabular-nums-th py-1 text-xs" />
                      </div>
                      <input type="text" placeholder="บันทึกการเข้าเรียนรายสัปดาห์" value={sub.weekly_attendance} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, weekly_attendance: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                      <textarea rows={2} placeholder="1.2) ผลการประเมินผู้เรียน" value={sub.evaluation_summary} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, evaluation_summary: e.target.value } : x)))} className="ledger-input prose-saraban py-1 text-xs" />

                      {/* 8 × 5 Attitude & Characteristic Evaluation Matrix */}
                      <div className="space-y-2 rounded border border-[#E2E8F0] bg-white p-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span className="font-semibold text-[#334155]">เกณฑ์การประเมินผลการเรียนของผู้เรียน (8 ข้อ × 5 ระดับ):</span>
                          <div className="flex flex-wrap items-center gap-1 text-[11px]">
                            <span className="text-[#64748B]">เลือกทั้งหมด:</span>
                            {[
                              { val: 5, label: "มากที่สุด" },
                              { val: 4, label: "มาก" },
                              { val: 3, label: "ปานกลาง" },
                              { val: 0, label: "ล้างทั้งหมด" },
                            ].map((preset) => (
                              <button
                                key={preset.val}
                                type="button"
                                onClick={() =>
                                  setNormSubjects((p) =>
                                    p.map((x, i) =>
                                      i === idx ? { ...x, attitude_ratings: Array(8).fill(preset.val) } : x
                                    )
                                  )
                                }
                                className={`rounded border px-2 py-0.5 font-medium transition ${
                                  preset.val === 0
                                    ? "border-[#CBD5E1] bg-slate-50 text-[#475569] hover:bg-slate-100"
                                    : "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8] hover:bg-[#DBEAFE]"
                                }`}
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[440px] border-collapse text-[11px] text-[#334155]">
                            <thead>
                              <tr className="bg-slate-50">
                                <th className="border border-[#CBD5E1] px-2 py-1.5 text-left font-semibold">รายการ</th>
                                {ATTITUDE_LEVELS.map((lvl) => (
                                  <th key={lvl.value} className="w-16 border border-[#CBD5E1] px-1 py-1.5 text-center font-semibold">
                                    {lvl.label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {ATTITUDE_CRITERIA.map((criterion, cIdx) => {
                                const currentRating = (sub.attitude_ratings ?? [])[cIdx] ?? 0;
                                return (
                                  <tr key={criterion} className="hover:bg-slate-50/70">
                                    <td className="border border-[#CBD5E1] px-2 py-1 font-medium">
                                      {cIdx === 7 ? (
                                        <div className="flex items-center gap-1.5">
                                          <span className="shrink-0">{criterion}</span>
                                          <input
                                            type="text"
                                            placeholder="ระบุ (ถ้ามี)..."
                                            value={sub.attitude_other_label ?? ""}
                                            onChange={(e) =>
                                              setNormSubjects((p) =>
                                                p.map((x, i) => (i === idx ? { ...x, attitude_other_label: e.target.value } : x))
                                              )
                                            }
                                            className="ledger-input py-0.5 text-[11px]"
                                          />
                                        </div>
                                      ) : (
                                        criterion
                                      )}
                                    </td>
                                    {ATTITUDE_LEVELS.map((lvl) => {
                                      const isSelected = currentRating === lvl.value;
                                      return (
                                        <td key={lvl.value} className="border border-[#CBD5E1] p-0.5 text-center">
                                          <button
                                            type="button"
                                            aria-label={`${criterion} - ${lvl.label}`}
                                            aria-pressed={isSelected}
                                            onClick={() =>
                                              setNormSubjects((p) =>
                                                p.map((x, i) => {
                                                  if (i !== idx) return x;
                                                  const next = [...(x.attitude_ratings ?? [0, 0, 0, 0, 0, 0, 0, 0])];
                                                  while (next.length < 8) next.push(0);
                                                  next[cIdx] = isSelected ? 0 : lvl.value;
                                                  return { ...x, attitude_ratings: next };
                                                })
                                              )
                                            }
                                            className={`mx-auto flex h-6 w-6 items-center justify-center rounded border text-xs font-bold transition ${
                                              isSelected
                                                ? "border-[#1D4ED8] bg-[#1D4ED8] text-white shadow-sm"
                                                : "border-[#CBD5E1] bg-white text-transparent hover:border-[#93C5FD] hover:bg-[#EFF6FF]"
                                            }`}
                                          >
                                            ✓
                                          </button>
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <input type="text" placeholder="2) ปัญหาที่พบ" value={sub.problems} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, problems: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                        <input type="text" placeholder="3) แนวทางแก้ปัญหา" value={sub.solutions} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, solutions: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                      </div>

                      {/* All 5 Evaluation Checkboxes + Conditional Reasons */}
                      <div className="space-y-1.5 rounded border border-[#E2E8F0] bg-white p-2.5">
                        <div className="font-semibold text-[#334155]">ประเมินผลการสอนของครู (ข้อ 1–5):</div>
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 text-[11px] text-[#334155]">
                          {(
                            [
                              ["content_completed", "content_note", "1) สอนครบตามเนื้อหา"],
                              ["time_sufficient", "time_note", "2) เวลาที่ใช้สอนพอเพียง"],
                              ["media_suitable", "media_note", "3) สื่อ/อุปกรณ์เหมาะสม"],
                              ["activities_suitable", "activities_note", "4) กิจกรรมการสอนเหมาะสม"],
                              ["assessment_suitable", "assessment_note", "5) เครื่องมือวัดและประเมินผลเหมาะสม"],
                            ] as Array<[keyof NormalSubjectEntry, keyof NormalSubjectEntry, string]>
                          ).map(([boolKey, noteKey, label]) => (
                            <div key={String(boolKey)} className="space-y-1">
                              <label className="flex items-center gap-1.5 font-medium">
                                <input
                                  type="checkbox"
                                  checked={Boolean(sub[boolKey])}
                                  onChange={(e) =>
                                    setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, [boolKey]: e.target.checked } : x)))
                                  }
                                  className="accent-[#1D4ED8]"
                                />
                                {label}
                              </label>
                              {!sub[boolKey] && (
                                <input
                                  type="text"
                                  placeholder="ระบุเหตุผลที่ยังไม่ครบ/ไม่เหมาะสม..."
                                  value={String(sub[noteKey] || "")}
                                  onChange={(e) =>
                                    setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, [noteKey]: e.target.value } : x)))
                                  }
                                  className="ledger-input py-1 text-[11px]"
                                />
                              )}
                            </div>
                          ))}
                        </div>
                        <input
                          type="text"
                          placeholder="6) อื่นๆ (ถ้ามี)"
                          value={sub.other_note}
                          onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, other_note: e.target.value } : x)))}
                          className="ledger-input py-1 text-[11px]"
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setNormSubjects((p) => [...p, emptyNormalSubject()])}
                  className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-3 py-1.5 font-semibold text-[#0F172A] hover:bg-slate-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  เพิ่มรายวิชาในรายงาน
                </button>
              </div>
            </section>
          )}

          {/* Tab 4: Online Weekly Teaching Report + Photo Upload */}
          {tab === "online_post" && (
            <section className="ledger-panel overflow-hidden text-xs">
              <div className="ledger-panel-header">
                <h2 className="text-sm font-bold text-[#0F172A]">รายงานการสอนออนไลน์รายสัปดาห์ (แนบรูปถ่ายหลักฐาน)</h2>
              </div>
              <div className="space-y-3 p-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">สัปดาห์ที่</label>
                    <input type="number" min={1} value={onlWeekNo} onChange={(e) => setOnlWeekNo(Number(e.target.value))} placeholder="สัปดาห์ที่" className="ledger-input tabular-nums-th py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">เลขที่หนังสือ</label>
                    <input type="text" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder="ฝว............/2569" className="ledger-input tabular-nums-th py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">ช่วงวันที่สอน</label>
                    <input type="text" value={onlDateRange} onChange={(e) => setOnlDateRange(e.target.value)} placeholder="เช่น 19-23 ต.ค. 69" className="ledger-input py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">วันที่เอกสาร</label>
                    <input type="date" value={onlDocDate} onChange={(e) => setOnlDocDate(e.target.value)} className="ledger-input tabular-nums-th py-1.5 text-xs" />
                  </div>
                </div>

                {courses.length > 0 && (
                  <div className="rounded-md border border-blue-200 bg-[#EFF6FF] p-2.5">
                    <span className="font-semibold text-[#1E3A8A]">ดึงรายวิชาจากคลังเข้าแบบบันทึกออนไลน์:</span>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {courses.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() =>
                            setOnlSections((prev) => [
                              ...prev.filter((s) => s.course_code || s.course_name),
                              {
                                ...emptyOnlineSection(c.department_name || normDept),
                                course_code: c.course_code,
                                course_name: c.course_name,
                                level_type: c.curriculum_level.includes("ปวส") ? "ปวส." : "ปวช.",
                                major_name: c.department_name || normDept,
                                total_students: 20,
                                present_students: 20,
                              },
                            ])
                          }
                          className="rounded border border-blue-200 bg-white px-2 py-1 text-[11px] font-semibold text-[#1E3A8A] hover:bg-blue-100"
                        >
                          + {c.course_code} {c.course_name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2 border-t border-[#E2E8F0] pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 font-bold text-[#0F172A]">
                    <span>ตารางคาบสอนออนไลน์ในสัปดาห์</span>
                    <button
                      type="button"
                      onClick={() =>
                        setOnlSessions((p) => [
                          ...p,
                          { date_text: "", course_label: "", time_text: "", class_level: "", major_name: "", total_students: 0, present_students: 0 },
                        ])
                      }
                      className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1 font-semibold hover:bg-slate-50"
                    >
                      + เพิ่มคาบ
                    </button>
                  </div>
                  {onlSessions.map((ses, idx) => (
                    <div key={idx} className="space-y-1.5 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-2.5">
                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-12">
                        <input type="text" placeholder="วัน/เดือน/ปี" value={ses.date_text} onChange={(e) => setOnlSessions((p) => p.map((x, i) => (i === idx ? { ...x, date_text: e.target.value } : x)))} className="ledger-input py-1 text-xs sm:col-span-4" />
                        <input type="text" placeholder="รหัส+ชื่อวิชา" value={ses.course_label} onChange={(e) => setOnlSessions((p) => p.map((x, i) => (i === idx ? { ...x, course_label: e.target.value } : x)))} className="ledger-input py-1 text-xs sm:col-span-5" />
                        <input type="text" placeholder="เวลา เช่น 13.00-15.00" value={ses.time_text} onChange={(e) => setOnlSessions((p) => p.map((x, i) => (i === idx ? { ...x, time_text: e.target.value } : x)))} className="ledger-input py-1 text-xs sm:col-span-3" />
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-12">
                        <input type="text" placeholder="ระดับชั้น/ห้อง" value={ses.class_level} onChange={(e) => setOnlSessions((p) => p.map((x, i) => (i === idx ? { ...x, class_level: e.target.value } : x)))} className="ledger-input py-1 text-xs sm:col-span-4" />
                        <input type="text" placeholder="สาขางาน" value={ses.major_name} onChange={(e) => setOnlSessions((p) => p.map((x, i) => (i === idx ? { ...x, major_name: e.target.value } : x)))} className="ledger-input py-1 text-xs sm:col-span-3" />
                        <input type="number" min={0} placeholder="ทั้งหมด" value={ses.total_students} onChange={(e) => setOnlSessions((p) => p.map((x, i) => (i === idx ? { ...x, total_students: Number(e.target.value) } : x)))} className="ledger-input tabular-nums-th py-1 text-xs sm:col-span-2" />
                        <input type="number" min={0} placeholder="เข้าเรียน" value={ses.present_students} onChange={(e) => setOnlSessions((p) => p.map((x, i) => (i === idx ? { ...x, present_students: Number(e.target.value) } : x)))} className="ledger-input tabular-nums-th py-1 text-xs sm:col-span-2" />
                        <button type="button" onClick={() => setOnlSessions((p) => p.filter((_, i) => i !== idx))} className="col-span-2 flex items-center justify-end text-slate-400 hover:text-[#B91C1C] sm:col-span-1 sm:justify-center">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-3 border-t border-[#E2E8F0] pt-3">
                  <div className="flex items-center justify-between font-bold text-[#0F172A]">
                    <span>แบบบันทึกหลังการสอนออนไลน์รายวิชา</span>
                    <button
                      type="button"
                      onClick={() => setOnlSections((p) => [...p, emptyOnlineSection(normDept)])}
                      className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1 font-semibold hover:bg-slate-50"
                    >
                      + เพิ่มรายวิชาออนไลน์
                    </button>
                  </div>

                  {onlSections.map((sec, idx) => (
                    <div key={idx} className="space-y-2 rounded-md border border-[#CBD5E1] bg-[#F8FAFC] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 font-bold text-[#0F172A]">
                        <span>แบบบันทึกออนไลน์วิชาที่ {idx + 1}</span>
                        <div className="flex items-center gap-2">
                          {aiCopilotEnabled && (
                            <button
                              type="button"
                              disabled={aiLoading}
                              onClick={() => handleAiPostTeachingOnline(idx)}
                              className="inline-flex items-center gap-1 rounded bg-[#1D4ED8] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-50"
                            >
                              <Sparkles className="h-3 w-3" />
                              AI ช่วยสรุปผล
                            </button>
                          )}
                          <button type="button" onClick={() => setOnlSections((p) => p.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-[#B91C1C]">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <input type="text" placeholder="รหัสวิชา" value={sec.course_code} onChange={(e) => setOnlSections((p) => p.map((x, i) => (i === idx ? { ...x, course_code: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                        <input type="text" placeholder="ชื่อวิชา" value={sec.course_name} onChange={(e) => setOnlSections((p) => p.map((x, i) => (i === idx ? { ...x, course_name: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                        <input type="text" placeholder="กลุ่มเรียน" value={sec.student_group} onChange={(e) => setOnlSections((p) => p.map((x, i) => (i === idx ? { ...x, student_group: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                        <div className="flex gap-1.5">
                          <select value={sec.level_type} onChange={(e) => setOnlSections((p) => p.map((x, i) => (i === idx ? { ...x, level_type: e.target.value as "ปวช." | "ปวส." } : x)))} className="ledger-input flex-1 py-1 text-xs">
                            <option value="ปวช.">ปวช.</option>
                            <option value="ปวส.">ปวส.</option>
                          </select>
                          <select value={sec.system_type} onChange={(e) => setOnlSections((p) => p.map((x, i) => (i === idx ? { ...x, system_type: e.target.value as "ปกติ" | "ทวิภาคี" } : x)))} className="ledger-input flex-1 py-1 text-xs">
                            <option value="ปกติ">ปกติ</option>
                            <option value="ทวิภาคี">ทวิภาคี</option>
                          </select>
                        </div>
                        <input type="text" placeholder="สาขาวิชา / สาขางาน" value={sec.major_name} onChange={(e) => setOnlSections((p) => p.map((x, i) => (i === idx ? { ...x, major_name: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                        <input type="text" placeholder="แผนกวิชา" value={sec.department_name} onChange={(e) => setOnlSections((p) => p.map((x, i) => (i === idx ? { ...x, department_name: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                        <input type="number" min={0} placeholder="ผู้เรียนทั้งหมด (คน)" value={sec.total_students} onChange={(e) => setOnlSections((p) => p.map((x, i) => (i === idx ? { ...x, total_students: Number(e.target.value) } : x)))} className="ledger-input tabular-nums-th py-1 text-xs" />
                        <input type="number" min={0} placeholder="เข้าเรียน (คน)" value={sec.present_students} onChange={(e) => setOnlSections((p) => p.map((x, i) => (i === idx ? { ...x, present_students: Number(e.target.value) } : x)))} className="ledger-input tabular-nums-th py-1 text-xs" />
                      </div>
                      <input type="text" placeholder="รายชื่อผู้ที่ขาดเรียน (ถ้ามี)" value={sec.absent_names} onChange={(e) => setOnlSections((p) => p.map((x, i) => (i === idx ? { ...x, absent_names: e.target.value } : x)))} className="ledger-input py-1 text-xs" />

                      <div className="flex flex-wrap items-center gap-3 text-[#334155]">
                        {ONLINE_TOOLS.map((tl) => (
                          <label key={tl} className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={sec.tools.includes(tl)}
                              onChange={(e) =>
                                setOnlSections((p) =>
                                  p.map((x, i) =>
                                    i === idx
                                      ? { ...x, tools: e.target.checked ? [...x.tools, tl] : x.tools.filter((t) => t !== tl) }
                                      : x
                                  )
                                )
                              }
                              className="accent-[#1D4ED8]"
                            />
                            {tl}
                          </label>
                        ))}
                        <input
                          type="text"
                          placeholder="โปรแกรม/สื่ออื่นๆ..."
                          value={sec.other_tool}
                          onChange={(e) => setOnlSections((p) => p.map((x, i) => (i === idx ? { ...x, other_tool: e.target.value } : x)))}
                          className="ledger-input min-w-[140px] flex-1 py-1 text-xs"
                        />
                      </div>
                      <textarea rows={2} placeholder="1. หัวข้อเรื่องที่สอน (บรรทัดละ 1 ข้อ)" value={sec.topics_text} onChange={(e) => setOnlSections((p) => p.map((x, i) => (i === idx ? { ...x, topics_text: e.target.value } : x)))} className="ledger-input prose-saraban py-1 text-xs" />
                      <input type="text" placeholder="3. งานที่มอบหมาย" value={sec.assignment} onChange={(e) => setOnlSections((p) => p.map((x, i) => (i === idx ? { ...x, assignment: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                      <textarea rows={2} placeholder="4. ผลการเรียนรู้ของผู้เรียน (บรรทัดละ 1 ข้อ)" value={sec.outcomes_text} onChange={(e) => setOnlSections((p) => p.map((x, i) => (i === idx ? { ...x, outcomes_text: e.target.value } : x)))} className="ledger-input prose-saraban py-1 text-xs" />
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <input type="text" placeholder="5.1 ปัญหา / อุปสรรคที่พบ" value={sec.problems} onChange={(e) => setOnlSections((p) => p.map((x, i) => (i === idx ? { ...x, problems: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                        <input type="text" placeholder="5.2 แนวทางพัฒนาคุณภาพการเรียนรู้" value={sec.solutions} onChange={(e) => setOnlSections((p) => p.map((x, i) => (i === idx ? { ...x, solutions: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                      </div>

                      <div className="space-y-2 rounded-md border border-dashed border-[#CBD5E1] bg-white p-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] text-[#475569]">
                            รูปภาพหลักฐานที่แนบแล้ว: <strong className="tabular-nums-th text-[#0F172A]">{sec.photo_filenames.length}</strong> รูป (จัดวางแบบ 2 คอลัมน์ในรายงาน)
                          </span>
                          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[#0F172A] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#1E293B]">
                            <ImagePlus className="h-3.5 w-3.5" />
                            อัปโหลดภาพ (.JPG / .PNG)
                            <input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => handleUploadOnlinePhoto(idx, e.target.files)} className="hidden" />
                          </label>
                        </div>
                        {sec.photo_filenames.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {sec.photo_filenames.map((fn, pIdx) => (
                              <span key={fn} className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] text-[#334155]">
                                ภาพที่ {pIdx + 1}: {fn.slice(0, 18)}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setOnlSections((p) =>
                                      p.map((x, i) => (i === idx ? { ...x, photo_filenames: x.photo_filenames.filter((_, k) => k !== pIdx) } : x))
                                    )
                                  }
                                  className="text-slate-400 hover:text-[#B91C1C]"
                                  title="นำรูปนี้ออก"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* 4-Position Document Signers + Instructor Signature Toggle */}
          <section className="ledger-panel overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setShowSignersPanel((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left font-bold text-[#0F172A] hover:bg-slate-50"
            >
              <span className="flex items-center gap-1.5">
                <Users className="h-4 w-4 text-[#1D4ED8]" />
                รายชื่อผู้รับรองในเอกสาร (4 ตำแหน่ง) และลายเซ็นผู้สอน
              </span>
              {showSignersPanel ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showSignersPanel && (
              <div className="space-y-3 border-t border-[#E2E8F0] p-4">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">ฝ่ายงานต้นสังกัด</label>
                    <input type="text" value={normDivision} onChange={(e) => setNormDivision(e.target.value)} className="ledger-input py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">ตำแหน่งผู้รายงาน/ผู้สอน</label>
                    <input type="text" value={normTitle} onChange={(e) => setNormTitle(e.target.value)} className="ledger-input py-1.5 text-xs" />
                  </div>
                  <SignerComboField label="หัวหน้าแผนกวิชา" value={deptHeadName} onChange={setDeptHeadName} users={users} placeholder="ชื่อหัวหน้าแผนกวิชา" />
                  {tab !== "normal_post" && (
                    <SignerComboField label="หัวหน้างานพัฒนาหลักสูตรฯ" value={curriculumHeadName} onChange={setCurriculumHeadName} users={users} placeholder="ชื่อหัวหน้างานพัฒนาหลักสูตรฯ" />
                  )}
                  <SignerComboField label="รองผู้อำนวยการฝ่ายวิชาการ" value={deputyAcademicName} onChange={setDeputyAcademicName} users={users} placeholder="ชื่อรองฯ ฝ่ายวิชาการ" />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
                  <label className="flex items-center gap-2 font-medium text-[#0F172A]">
                    <input
                      type="checkbox"
                      checked={includeInstructorSig}
                      onChange={(e) => setIncludeInstructorSig(e.target.checked)}
                      className="accent-[#1D4ED8]"
                    />
                    <span>ฝังลายเซ็นอิเล็กทรอนิกส์ผู้สอน (.PNG) ลงในเอกสารอัตโนมัติ</span>
                  </label>
                  {meHasSignature ? (
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">พร้อมใช้งาน</span>
                  ) : (
                    <Link href="/profile?tab=signature" className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1D4ED8] hover:underline">
                      <PenTool className="h-3 w-3" />
                      ยังไม่มีลายเซ็น (ไปอัปโหลด/วาด)
                    </Link>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Render / Save / Submit Action Card */}
          <section className="ledger-panel space-y-3 p-4 text-xs">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="min-w-0">
                <label className="mb-1 block font-semibold text-[#475569]">ผู้ตรวจในสายอนุมัติ (/approvals)</label>
                <select value={reviewerEmail} onChange={(e) => setReviewerEmail(e.target.value)} className="ledger-input w-full min-w-0 max-w-full py-1.5 text-xs">
                  <option value="">-- ส่งตรงผู้อนุมัติ --</option>
                  {users.map((u) => (
                    <option key={u.email || u.id} value={u.email || ""}>
                      {u.full_name} ({u.position_title})
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0">
                <label className="mb-1 block font-semibold text-[#475569]">ผู้อนุมัติ / ลงนาม</label>
                <select value={approverEmail} onChange={(e) => setApproverEmail(e.target.value)} className="ledger-input w-full min-w-0 max-w-full py-1.5 text-xs">
                  {users.map((u) => (
                    <option key={u.email || u.id} value={u.email || ""}>
                      {u.full_name} ({u.position_title})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={handleRender}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-50"
              >
                <FileCheck2 className="h-4 w-4" />
                {busy ? "กำลังสร้างเอกสาร..." : "สร้างเอกสารและพรีวิว"}
              </button>
              <button
                type="button"
                onClick={() => setMobilePreviewOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-[#EFF6FF] px-3.5 py-2 text-xs font-semibold text-[#1E3A8A] hover:bg-blue-100 xl:hidden"
              >
                <Eye className="h-4 w-4" />
                ดูตัวอย่างเอกสาร
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleSaveOrSubmit(false)}
                className="rounded-md border border-[#CBD5E1] bg-white px-4 py-2 text-xs font-semibold text-[#0F172A] hover:bg-slate-50"
              >
                บันทึกร่าง
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleSaveOrSubmit(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
              >
                <Send className="h-4 w-4" />
                ส่งตรวจและลงนาม
              </button>
            </div>
          </section>
        </div>

        {/* Right Preview Column */}
        <ResponsivePreviewModal
          open={mobilePreviewOpen}
          onOpenChange={setMobilePreviewOpen}
          desktopColClass="min-w-0 xl:col-span-6"
          title="ตัวอย่างเอกสารการสอน (A4)"
          triggerLabel="ดูตัวอย่างการสอน"
          loading={busy}
          pageCount={activeFile?.page_image_urls?.length || 0}
          hasPreview={Boolean(activeFile?.file_url || activeFile?.pdf_url)}
          topContent={
            <div className="ledger-panel overflow-hidden">
              <div className="ledger-panel-header flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-bold text-[#0F172A]">เอกสารที่สร้างในชุดนี้</h2>
                <div className="flex flex-wrap items-center gap-1.5">
                  {renderResult?.merged_pdf_url && (
                    <a
                      href={`${API_BASE}${renderResult.merged_pdf_url}?download=1`}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-800"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      ดาวน์โหลด PDF รวมชุด
                    </a>
                  )}
                  {renderResult?.zip_url && (
                    <a
                      href={`${API_BASE}${renderResult.zip_url}?download=1`}
                      className="inline-flex items-center gap-1 rounded-md bg-[#0F172A] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#1E293B]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      ดาวน์โหลด .ZIP
                    </a>
                  )}
                </div>
              </div>
              <div className="p-3.5">
                {renderResult?.bundle_files?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {renderResult.bundle_files.map((bf, idx) => (
                      <button
                        key={bf.key}
                        type="button"
                        onClick={() => setActiveFileIdx(idx)}
                        className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                          idx === activeFileIdx
                            ? "bg-[#1D4ED8] text-white"
                            : "border border-[#CBD5E1] bg-[#F8FAFC] text-[#334155] hover:bg-slate-100"
                        }`}
                      >
                        {bf.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#475569]">เลือกแท็บงานสอนทางซ้าย กรอกข้อมูลแล้วกด &ldquo;สร้างเอกสารและพรีวิว&rdquo;</p>
                )}
              </div>
            </div>
          }
        >
          <DocumentPreviewPanel
            fontFamily="TH Sarabun New / IT๙"
            docxUrl={activeFile?.file_url}
            pdfUrl={activeFile?.pdf_url}
            pageImageUrls={activeFile?.page_image_urls || []}
            pdfError={activeFile?.pdf_error}
            loading={busy}
            versionKey={previewVersion}
            emptyMessage="ยังไม่มีตัวอย่างเอกสาร กด 'สร้างเอกสารและพรีวิว' ด้านซ้าย"
          />
        </ResponsivePreviewModal>
      </div>
    </div>
  );
}
