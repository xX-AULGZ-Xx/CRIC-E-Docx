"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Download,
  Eye,
  FileCheck2,
  ImagePlus,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { DocumentPreviewPanel } from "@/components/DocumentPreviewPanel";
import { ResponsivePreviewModal } from "@/components/ResponsivePreviewModal";
import { api, API_BASE, BundleRenderResult, CourseRecord, CourseWeeklyItem, DocType, UserProfile } from "@/lib/api";
import { confirmDanger, toastError, toastInfo, toastSuccess } from "@/lib/swal";

type TeachingTab = "syllabus" | "lesson_plan" | "normal_post" | "online_post";

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
  time_sufficient: boolean;
  media_suitable: boolean;
  activities_suitable: boolean;
  assessment_suitable: boolean;
}

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
  const [weeklyPlan, setWeeklyPlan] = useState<CourseWeeklyItem[]>([]);

  // Normal 4-Week Post-Teaching (Tab 3)
  const [normDept, setNormDept] = useState("");
  const [normInstructor, setNormInstructor] = useState("");
  const [normTitle, setNormTitle] = useState("ครู");
  const [normSemester, setNormSemester] = useState("2/2569");
  const [normDocDate, setNormDocDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [normWeekStart, setNormWeekStart] = useState(1);
  const [normWeekEnd, setNormWeekEnd] = useState(4);
  const [normSubjects, setNormSubjects] = useState<NormalSubjectEntry[]>([
    {
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
      time_sufficient: true,
      media_suitable: true,
      activities_suitable: true,
      assessment_suitable: true,
    },
  ]);

  // Online Weekly Teaching Report (Tab 4)
  const [onlWeekNo, setOnlWeekNo] = useState(1);
  const [onlDateRange, setOnlDateRange] = useState("");
  const [onlDocDate, setOnlDocDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [onlSessions, setOnlSessions] = useState<OnlineSessionEntry[]>([
    { date_text: "", course_label: "", time_text: "", class_level: "", major_name: "", total_students: 0, present_students: 0 },
  ]);
  const [onlSections, setOnlSections] = useState<OnlineSectionEntry[]>([
    {
      course_code: "",
      course_name: "",
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
    },
  ]);

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
    api.listUsers().then((r) => setUsers(r.users)).catch(() => {});
    api.getPublicSettings().then((pub) => {
      if (typeof pub.ai_copilot_enabled === "boolean") setAiCopilotEnabled(pub.ai_copilot_enabled);
    }).catch(() => {});
    const applyMyProfile = () => {
      api
        .me()
        .then(({ user }) => {
          if (!user) return;
          setCourseForm((prev) => ({
            ...prev,
            instructor_name: user.full_name || prev.instructor_name,
            instructor_phone: user.phone || prev.instructor_phone,
            instructor_email: user.email || prev.instructor_email || "",
            department_name: user.unit_name || prev.department_name,
          }));
          if (user.full_name) setNormInstructor(user.full_name);
          if (user.position_title) setNormTitle(user.position_title);
          if (user.unit_name) setNormDept((prev) => prev || user.unit_name || "");
          if (user.default_reviewer_email) setReviewerEmail(user.default_reviewer_email);
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

  function applyCourseToForm(c: CourseRecord) {
    setSelectedCourseId(c.id || "");
    setCourseForm(c);
    setObjectivesText((c.objectives_json || c.objectives || []).join("\n"));
    setStandardsText((c.standards_json || c.standards || []).join("\n"));
    setKnowledgeText((c.knowledge_json || c.knowledge || []).join("\n"));
    setSkillsText((c.skills_json || c.skills || []).join("\n"));
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
      if (Array.isArray(res.weekly_plan)) setWeeklyPlan(res.weekly_plan as CourseWeeklyItem[]);
      const modeLabel = String(res.mode || "template");
      setMsg(`AI (${modeLabel}) ร่างจุดประสงค์ สมรรถนะ และตาราง 18 สัปดาห์ให้เรียบร้อยแล้ว`);
      toastSuccess("AI ร่างแผน 18 สัปดาห์สำเร็จ", `โหมด ${modeLabel}`);
    } catch (err) {
      const m = err instanceof Error ? err.message : "AI ร่างแผนไม่สำเร็จ";
      setMsg(m);
      toastError("AI ร่างแผนไม่สำเร็จ", m);
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

  function buildTeachingRequest(): { docType: DocType; payload: Record<string, unknown>; subject: string } {
    if (tab === "syllabus") {
      const c = currentCoursePayload();
      return {
        docType: "course_syllabus",
        payload: c as unknown as Record<string, unknown>,
        subject: `กำหนดการสอน ${c.course_code} ${c.course_name}`.trim(),
      };
    }
    if (tab === "lesson_plan") {
      const c = currentCoursePayload();
      return {
        docType: "lesson_plan",
        payload: c as unknown as Record<string, unknown>,
        subject: `แผนการจัดการเรียนรู้ ${c.course_code} ${c.course_name}`.trim(),
      };
    }
    if (tab === "normal_post") {
      return {
        docType: "post_teaching_normal",
        payload: {
          department_name: normDept || courseForm.department_name || "แผนกวิชา",
          division_name: "ฝ่ายวิชาการ",
          doc_date: normDocDate,
          instructor_name: normInstructor || courseForm.instructor_name,
          instructor_title: normTitle,
          semester: normSemester,
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
        department_name: normDept || courseForm.department_name || "แผนกวิชา",
        division_name: "ฝ่ายวิชาการ",
        doc_date: onlDocDate,
        week_number: onlWeekNo,
        semester: normSemester,
        date_range_text: onlDateRange,
        instructor_name: normInstructor || courseForm.instructor_name,
        instructor_title: normTitle,
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
    <div className="space-y-4">
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
        <div className="space-y-4 xl:col-span-6">
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
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={selectedCourseId}
                    onChange={(e) => {
                      const found = courses.find((c) => c.id === e.target.value);
                      if (found) applyCourseToForm(found);
                    }}
                    className="ledger-input flex-1 py-1.5 text-xs"
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

                {/* Weekly Schedule Editor */}
                <div className="border-t border-[#E2E8F0] pt-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-bold text-[#0F172A]">ตารางการสอนรายสัปดาห์ ({weeklyPlan.length} สัปดาห์)</span>
                    <button
                      type="button"
                      onClick={() =>
                        setWeeklyPlan((prev) => [
                          ...prev,
                          { week: prev.length + 1, topic: "", activities: "", media: "", evaluation: "", competency: "", theory_hours: 1, practice_hours: 3 },
                        ])
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1 font-semibold text-[#0F172A] hover:bg-slate-50"
                    >
                      <Plus className="h-3 w-3" />
                      เพิ่มสัปดาห์
                    </button>
                  </div>
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {weeklyPlan.map((wk, idx) => (
                      <div key={idx} className="space-y-1.5 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-2.5">
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums-th rounded bg-[#0F172A] px-2 py-0.5 text-[11px] font-bold text-white">สัปดาห์ {wk.week}</span>
                          <input
                            type="text"
                            placeholder="หัวข้อ / หน่วยการเรียนรู้"
                            value={wk.topic}
                            onChange={(e) => setWeeklyPlan((p) => p.map((x, i) => (i === idx ? { ...x, topic: e.target.value } : x)))}
                            className="ledger-input flex-1 py-1 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => setWeeklyPlan((p) => p.filter((_, i) => i !== idx))}
                            className="text-slate-400 hover:text-[#B91C1C]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                          <input type="text" placeholder="กิจกรรมการสอน" value={wk.activities} onChange={(e) => setWeeklyPlan((p) => p.map((x, i) => (i === idx ? { ...x, activities: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                          <input type="text" placeholder="สื่อ / การประเมินผล" value={wk.evaluation} onChange={(e) => setWeeklyPlan((p) => p.map((x, i) => (i === idx ? { ...x, evaluation: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
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
                  <input type="text" value={normDept} onChange={(e) => setNormDept(e.target.value)} placeholder="แผนกวิชา" className="ledger-input py-1.5 text-xs" />
                  <input type="text" value={normInstructor} onChange={(e) => setNormInstructor(e.target.value)} placeholder="ชื่อครูผู้สอน" className="ledger-input py-1.5 text-xs" />
                  <input type="date" value={normDocDate} onChange={(e) => setNormDocDate(e.target.value)} className="ledger-input tabular-nums-th py-1.5 text-xs" />
                  <div className="flex items-center gap-1.5">
                    <span className="text-[#475569]">สัปดาห์</span>
                    <input type="number" value={normWeekStart} onChange={(e) => setNormWeekStart(Number(e.target.value))} className="ledger-input tabular-nums-th w-16 py-1 text-xs" />
                    <span className="text-[#475569]">ถึง</span>
                    <input type="number" value={normWeekEnd} onChange={(e) => setNormWeekEnd(Number(e.target.value))} className="ledger-input tabular-nums-th w-16 py-1 text-xs" />
                  </div>
                  <input type="text" value={normSemester} onChange={(e) => setNormSemester(e.target.value)} placeholder="ภาคเรียน เช่น 2/2569" className="ledger-input tabular-nums-th py-1.5 text-xs" />
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
                                course_code: c.course_code,
                                course_name: c.course_name,
                                unit_title: c.weekly_plan_json?.[0]?.topic || "",
                                student_group: c.curriculum_level,
                                total_students: 20,
                                passed_students: 20,
                                weekly_attendance: `สัปดาห์ที่ ${normWeekStart}-${normWeekEnd} เข้าเรียนครบ`,
                                evaluation_summary: "ผ่านเกณฑ์การประเมินตามจุดประสงค์เชิงพฤติกรรม",
                                problems: "-",
                                solutions: "-",
                                content_completed: true,
                                time_sufficient: true,
                                media_suitable: true,
                                activities_suitable: true,
                                assessment_suitable: true,
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
                      <div className="flex items-center justify-between font-bold text-[#0F172A]">
                        <span>รายวิชาที่ {idx + 1}</span>
                        <button type="button" onClick={() => setNormSubjects((p) => p.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-[#B91C1C]">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <input type="text" placeholder="รหัสวิชา" value={sub.course_code} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, course_code: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                        <input type="text" placeholder="ชื่อวิชา" value={sub.course_name} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, course_name: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                        <input type="text" placeholder="หน่วย/เรื่อง" value={sub.unit_title} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, unit_title: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                        <input type="text" placeholder="กลุ่มเรียน" value={sub.student_group} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, student_group: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                        <input type="number" placeholder="ผู้เรียนทั้งหมด" value={sub.total_students} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, total_students: Number(e.target.value) } : x)))} className="ledger-input tabular-nums-th py-1 text-xs" />
                        <input type="number" placeholder="ผ่านเกณฑ์ (คน)" value={sub.passed_students} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, passed_students: Number(e.target.value) } : x)))} className="ledger-input tabular-nums-th py-1 text-xs" />
                      </div>
                      <input type="text" placeholder="บันทึกการเข้าเรียนรายสัปดาห์" value={sub.weekly_attendance} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, weekly_attendance: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <input type="text" placeholder="ปัญหาที่พบ" value={sub.problems} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, problems: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                        <input type="text" placeholder="แนวทางแก้ปัญหา" value={sub.solutions} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, solutions: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                      </div>
                      <div className="flex flex-wrap gap-3 text-[11px] text-[#334155]">
                        <label className="flex items-center gap-1"><input type="checkbox" checked={sub.content_completed} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, content_completed: e.target.checked } : x)))} className="accent-[#1D4ED8]" /> สอนครบเนื้อหา</label>
                        <label className="flex items-center gap-1"><input type="checkbox" checked={sub.time_sufficient} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, time_sufficient: e.target.checked } : x)))} className="accent-[#1D4ED8]" /> เวลาพอเพียง</label>
                        <label className="flex items-center gap-1"><input type="checkbox" checked={sub.media_suitable} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, media_suitable: e.target.checked } : x)))} className="accent-[#1D4ED8]" /> สื่อเหมาะสม</label>
                        <label className="flex items-center gap-1"><input type="checkbox" checked={sub.activities_suitable} onChange={(e) => setNormSubjects((p) => p.map((x, i) => (i === idx ? { ...x, activities_suitable: e.target.checked } : x)))} className="accent-[#1D4ED8]" /> กิจกรรมเหมาะสม</label>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setNormSubjects((p) => [
                      ...p,
                      {
                        course_code: "",
                        course_name: "",
                        unit_title: "",
                        student_group: "",
                        total_students: 0,
                        passed_students: 0,
                        weekly_attendance: "",
                        evaluation_summary: "ผ่านเกณฑ์การประเมิน",
                        problems: "-",
                        solutions: "-",
                        content_completed: true,
                        time_sufficient: true,
                        media_suitable: true,
                        activities_suitable: true,
                        assessment_suitable: true,
                      },
                    ])
                  }
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
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                  <input type="number" value={onlWeekNo} onChange={(e) => setOnlWeekNo(Number(e.target.value))} placeholder="สัปดาห์ที่" className="ledger-input tabular-nums-th py-1.5 text-xs" />
                  <input type="text" value={onlDateRange} onChange={(e) => setOnlDateRange(e.target.value)} placeholder="ช่วงวันที่ เช่น 19-23 ต.ค. 69" className="ledger-input py-1.5 text-xs sm:col-span-2" />
                  <input type="date" value={onlDocDate} onChange={(e) => setOnlDocDate(e.target.value)} className="ledger-input tabular-nums-th py-1.5 text-xs" />
                </div>

                <div className="space-y-2 border-t border-[#E2E8F0] pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 font-bold text-[#0F172A]">
                    <span>ตารางคาบสอนออนไลน์ในสัปดาห์</span>
                    <button
                      type="button"
                      onClick={() => setOnlSessions((p) => [...p, { date_text: "", course_label: "", time_text: "", class_level: "", major_name: "", total_students: 0, present_students: 0 }])}
                      className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1 font-semibold hover:bg-slate-50"
                    >
                      + เพิ่มคาบ
                    </button>
                  </div>
                  {onlSessions.map((ses, idx) => (
                    <div key={idx} className="grid grid-cols-2 gap-2 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 sm:grid-cols-12 sm:gap-1.5 sm:p-2">
                      <input type="text" placeholder="วัน/เดือน/ปี" value={ses.date_text} onChange={(e) => setOnlSessions((p) => p.map((x, i) => (i === idx ? { ...x, date_text: e.target.value } : x)))} className="ledger-input col-span-2 py-1 text-xs sm:col-span-3" />
                      <input type="text" placeholder="รหัส+ชื่อวิชา" value={ses.course_label} onChange={(e) => setOnlSessions((p) => p.map((x, i) => (i === idx ? { ...x, course_label: e.target.value } : x)))} className="ledger-input col-span-2 py-1 text-xs sm:col-span-4" />
                      <input type="text" placeholder="เวลา" value={ses.time_text} onChange={(e) => setOnlSessions((p) => p.map((x, i) => (i === idx ? { ...x, time_text: e.target.value } : x)))} className="ledger-input col-span-2 py-1 text-xs sm:col-span-2" />
                      <input type="number" placeholder="ทั้งหมด" value={ses.total_students} onChange={(e) => setOnlSessions((p) => p.map((x, i) => (i === idx ? { ...x, total_students: Number(e.target.value) } : x)))} className="ledger-input tabular-nums-th col-span-1 py-1 text-xs sm:col-span-1" />
                      <input type="number" placeholder="เข้าเรียน" value={ses.present_students} onChange={(e) => setOnlSessions((p) => p.map((x, i) => (i === idx ? { ...x, present_students: Number(e.target.value) } : x)))} className="ledger-input tabular-nums-th col-span-1 py-1 text-xs sm:col-span-1" />
                      <button type="button" onClick={() => setOnlSessions((p) => p.filter((_, i) => i !== idx))} className="col-span-2 flex items-center justify-end text-slate-400 hover:text-[#B91C1C] sm:col-span-1 sm:justify-center">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="space-y-3 border-t border-[#E2E8F0] pt-3">
                  <div className="flex items-center justify-between font-bold text-[#0F172A]">
                    <span>แบบบันทึกหลังการสอนออนไลน์รายวิชา</span>
                    <button
                      type="button"
                      onClick={() =>
                        setOnlSections((p) => [
                          ...p,
                          {
                            course_code: "",
                            course_name: "",
                            level_type: "ปวช.",
                            system_type: "ทวิภาคี",
                            student_group: "",
                            major_name: "",
                            total_students: 0,
                            present_students: 0,
                            absent_names: "-",
                            topics_text: "",
                            tools: ["Google Classroom", "Meet"],
                            other_tool: "",
                            assignment: "",
                            outcomes_text: "",
                            problems: "-",
                            solutions: "-",
                            photo_filenames: [],
                          },
                        ])
                      }
                      className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1 font-semibold hover:bg-slate-50"
                    >
                      + เพิ่มรายวิชาออนไลน์
                    </button>
                  </div>

                  {onlSections.map((sec, idx) => (
                    <div key={idx} className="space-y-2 rounded-md border border-[#CBD5E1] bg-[#F8FAFC] p-3">
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
                      </div>
                      <div className="flex flex-wrap gap-3 text-[#334155]">
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
                      </div>
                      <textarea rows={2} placeholder="หัวข้อเรื่องที่สอน (บรรทัดละ 1 ข้อ)" value={sec.topics_text} onChange={(e) => setOnlSections((p) => p.map((x, i) => (i === idx ? { ...x, topics_text: e.target.value } : x)))} className="ledger-input prose-saraban py-1 text-xs" />
                      <input type="text" placeholder="งานที่มอบหมาย" value={sec.assignment} onChange={(e) => setOnlSections((p) => p.map((x, i) => (i === idx ? { ...x, assignment: e.target.value } : x)))} className="ledger-input py-1 text-xs" />
                      <textarea rows={2} placeholder="ผลการเรียนรู้ของผู้เรียน (บรรทัดละ 1 ข้อ)" value={sec.outcomes_text} onChange={(e) => setOnlSections((p) => p.map((x, i) => (i === idx ? { ...x, outcomes_text: e.target.value } : x)))} className="ledger-input prose-saraban py-1 text-xs" />

                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-[#CBD5E1] bg-white p-2.5">
                        <span className="text-[11px] text-[#475569]">
                          รูปภาพหลักฐานที่แนบแล้ว: <strong className="tabular-nums-th text-[#0F172A]">{sec.photo_filenames.length}</strong> รูป
                        </span>
                        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[#0F172A] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#1E293B]">
                          <ImagePlus className="h-3.5 w-3.5" />
                          อัปโหลดภาพ (.JPG / .PNG)
                          <input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => handleUploadOnlinePhoto(idx, e.target.files)} className="hidden" />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Render / Save / Submit Action Card */}
          <section className="ledger-panel space-y-3 p-4 text-xs">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">ผู้ตรวจ (หัวหน้าแผนก / รองฯ วิชาการ)</label>
                <select value={reviewerEmail} onChange={(e) => setReviewerEmail(e.target.value)} className="ledger-input py-1.5 text-xs">
                  <option value="">-- ส่งตรงผู้อนุมัติ --</option>
                  {users.map((u) => (
                    <option key={u.email || u.id} value={u.email || ""}>
                      {u.full_name} ({u.position_title})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">ผู้อนุมัติ / ลงนาม</label>
                <select value={approverEmail} onChange={(e) => setApproverEmail(e.target.value)} className="ledger-input py-1.5 text-xs">
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
          desktopColClass="xl:col-span-6"
          title="ตัวอย่างเอกสารการสอน (A4)"
          triggerLabel="ดูตัวอย่างการสอน"
          loading={busy}
          pageCount={activeFile?.page_image_urls?.length || 0}
          hasPreview={Boolean(activeFile?.file_url || activeFile?.pdf_url)}
          topContent={
            <div className="ledger-panel overflow-hidden">
              <div className="ledger-panel-header flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-bold text-[#0F172A]">เอกสารที่สร้างในชุดนี้</h2>
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
            fontFamily="TH SarabunPSK / New"
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
