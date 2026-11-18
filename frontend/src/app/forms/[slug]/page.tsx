"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Download, Eye, FileCheck2, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { DocumentPreviewPanel } from "@/components/DocumentPreviewPanel";
import { NumericInput } from "@/components/NumericInput";
import { ResponsivePreviewModal } from "@/components/ResponsivePreviewModal";
import { api, API_BASE, UserProfile } from "@/lib/api";
import { DIVISION_FORM_META, DivisionFormSlug } from "@/lib/divisionDocuments";
import { toastError, toastSuccess } from "@/lib/swal";

function isValidSlug(s: string): s is DivisionFormSlug {
  return s in DIVISION_FORM_META;
}

export default function DivisionDynamicFormPage() {
  const params = useParams<{ slug: string }>();
  const slug = String(params?.slug || "");
  const valid = isValidSlug(slug);
  const meta = valid ? DIVISION_FORM_META[slug] : null;

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [docNumber, setDocNumber] = useState("");
  const [docDate, setDocDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [departmentName, setDepartmentName] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [requesterTitle, setRequesterTitle] = useState("");
  const [deptHeadName, setDeptHeadName] = useState("");

  // Vehicle Request
  const [purpose, setPurpose] = useState("");
  const [destination, setDestination] = useState("");
  const [travelDate, setTravelDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [timeStart, setTimeStart] = useState("08.30");
  const [timeEnd, setTimeEnd] = useState("16.30");
  const [vehicleType, setVehicleType] = useState("รถยนต์ราชการ (รถตู้)");
  const [licensePlate, setLicensePlate] = useState("");
  const [driverName, setDriverName] = useState("");
  const [passengers, setPassengers] = useState<Array<{ name: string; position: string }>>([{ name: "", position: "" }]);

  // Official Travel
  const [subject, setSubject] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [vehicle, setVehicle] = useState("รถยนต์ราชการ / รถโดยสารประจำทาง");
  const [allowanceAmount, setAllowanceAmount] = useState(0);
  const [lodgingAmount, setLodgingAmount] = useState(0);
  const [transportAmount, setTransportAmount] = useState(0);
  const [otherAmount, setOtherAmount] = useState(0);
  const [travelers, setTravelers] = useState<Array<{ name: string; position: string }>>([{ name: "", position: "" }]);

  // Overload Teaching
  const [semester, setSemester] = useState("2/2569");
  const [monthLabel, setMonthLabel] = useState("พฤศจิกายน 2569");
  const [baseLoadHours, setBaseLoadHours] = useState(18);
  const [overloadCourses, setOverloadCourses] = useState<
    Array<{ course_code: string; course_name: string; extra_hours: number; rate_per_hour: number }>
  >([{ course_code: "", course_name: "", extra_hours: 0, rate_per_hour: 200 }]);

  // Internship Supervision
  const [companyName, setCompanyName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [mentorName, setMentorName] = useState("");
  const [visitDate, setVisitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [supervisionSummary, setSupervisionSummary] = useState("นักศึกษาปฏิบัติงานด้วยความตั้งใจ มีวินัย และปฏิบัติตามกฎระเบียบของสถานประกอบการ");
  const [suggestions, setSuggestions] = useState("");
  const [internStudents, setInternStudents] = useState<Array<{ student_id: string; name: string; result: string }>>([
    { student_id: "", name: "", result: "ผ่านเกณฑ์ดี" },
  ]);

  // Home Visit
  const [studentName, setStudentName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [studentGroup, setStudentGroup] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [homeAddress, setHomeAddress] = useState("");
  const [livingCondition, setLivingCondition] = useState("");
  const [behaviorNote, setBehaviorNote] = useState("");
  const [supportPlan, setSupportPlan] = useState("");

  // Project Summary & Single Plan Summary
  const [projectName, setProjectName] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const [budgetYearBe, setBudgetYearBe] = useState(2570);
  const [budgetAllocated, setBudgetAllocated] = useState(0);
  const [budgetSpent, setBudgetSpent] = useState(0);
  const [summaryNote, setSummaryNote] = useState("");
  const [problemsNote, setProblemsNote] = useState("");
  const [kpis, setKpis] = useState<Array<{ indicator: string; target: string; actual: string }>>([
    { indicator: "", target: "", actual: "" },
  ]);
  const [planName, setPlanName] = useState("");
  const [planActivities, setPlanActivities] = useState<Array<{ activity: string; target: string; result: string; percent: string }>>([
    { activity: "", target: "", result: "", percent: "100%" },
  ]);

  // Preview & Workflow
  const previewKeyRef = useRef(Math.random().toString(36).slice(2, 10));
  const [busy, setBusy] = useState(false);
  const [renderResult, setRenderResult] = useState<{
    docx_filename: string;
    docx_url: string;
    pdf_url: string | null;
    page_image_urls: string[];
  } | null>(null);
  const [previewVersion, setPreviewVersion] = useState(1);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const [savedDocId, setSavedDocId] = useState<string | null>(null);
  const [reviewerEmail, setReviewerEmail] = useState("");
  const [approverEmail, setApproverEmail] = useState("director@cric.ac.th");

  useEffect(() => {
    Promise.all([api.me().catch(() => null), api.listUsers().catch(() => ({ users: [] }))]).then(([meRes, usersRes]) => {
      const list = usersRes?.users || [];
      setUsers(list);
      const u = meRes?.user;
      if (u) {
        setRequesterName((p) => p || u.full_name || "");
        setRequesterTitle((p) => p || u.position_title || "");
        setDepartmentName((p) => p || u.unit_name || (u.units && u.units[0]) || "");
        setTravelers((p) => (p.length === 1 && !p[0].name ? [{ name: u.full_name, position: u.position_title }] : p));
        if (u.default_reviewer_email) setReviewerEmail(u.default_reviewer_email);
      }
      const dir = list.find((x) => x.role === "director");
      if (dir?.email) setApproverEmail(dir.email);
    });
  }, []);

  const overloadTotal = useMemo(
    () => overloadCourses.reduce((acc, c) => acc + Number(c.extra_hours || 0) * Number(c.rate_per_hour || 0), 0),
    [overloadCourses]
  );

  function buildPayload(): Record<string, unknown> {
    const base: Record<string, unknown> = {
      doc_number: docNumber,
      doc_date: docDate,
      division_name: meta?.divisionName || "",
      department_name: departmentName,
      requester_name: requesterName,
      requester_title: requesterTitle,
      dept_head_name: deptHeadName,
    };
    if (slug === "vehicle_request") {
      return {
        ...base,
        purpose,
        destination,
        travel_date: travelDate,
        time_start: timeStart,
        time_end: timeEnd,
        vehicle_type: vehicleType,
        license_plate: licensePlate,
        driver_name: driverName,
        passengers: passengers.filter((p) => p.name.trim()),
      };
    }
    if (slug === "official_travel") {
      return {
        ...base,
        subject: subject || "ขออนุญาตไปราชการ",
        destination,
        start_date: startDate,
        end_date: endDate,
        vehicle,
        allowance_amount: allowanceAmount,
        lodging_amount: lodgingAmount,
        transport_amount: transportAmount,
        other_amount: otherAmount,
        travelers: travelers.filter((t) => t.name.trim()),
      };
    }
    if (slug === "overload_teaching") {
      return {
        ...base,
        semester,
        month_label: monthLabel,
        base_load_hours: baseLoadHours,
        courses: overloadCourses.filter((c) => c.course_code.trim() || c.course_name.trim()),
      };
    }
    if (slug === "internship_supervision") {
      return {
        ...base,
        semester,
        company_name: companyName,
        company_address: companyAddress,
        mentor_name: mentorName,
        visit_date: visitDate,
        supervision_summary: supervisionSummary,
        suggestions,
        students: internStudents.filter((s) => s.name.trim() || s.student_id.trim()),
      };
    }
    if (slug === "home_visit") {
      return {
        ...base,
        student_name: studentName,
        student_id: studentId,
        student_group: studentGroup,
        guardian_name: guardianName,
        guardian_phone: guardianPhone,
        home_address: homeAddress,
        visit_date: visitDate,
        living_condition: livingCondition,
        behavior_note: behaviorNote,
        support_plan: supportPlan,
      };
    }
    if (slug === "project_summary") {
      return {
        ...base,
        project_name: projectName,
        project_code: projectCode,
        budget_year_be: budgetYearBe,
        budget_allocated: budgetAllocated,
        budget_spent: budgetSpent,
        kpis: kpis.filter((k) => k.indicator.trim()),
        summary_note: summaryNote,
        problems_note: problemsNote,
      };
    }
    return {
      ...base,
      plan_name: planName,
      budget_year_be: budgetYearBe,
      activities: planActivities.filter((a) => a.activity.trim()),
      summary_note: summaryNote,
    };
  }

  async function handleRender() {
    if (!valid || !meta) return;
    setBusy(true);
    try {
      const res = await api.renderDivisionForm(slug, buildPayload(), true, previewKeyRef.current);
      setRenderResult(res);
      setPreviewVersion((v) => v + 1);
      toastSuccess("สร้างเอกสารและพรีวิวเรียบร้อยแล้ว");
    } catch (e: unknown) {
      toastError("สร้างเอกสารไม่สำเร็จ", e instanceof Error ? e.message : "เกิดข้อผิดพลาด");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveDraft() {
    if (!valid || !meta) return;
    setBusy(true);
    try {
      const res = await api.saveDivisionForm(slug, meta.divisionCode, subject || projectName || planName || meta.title, buildPayload(), true);
      setSavedDocId(res.document.id);
      toastSuccess("บันทึกร่างเอกสารแล้ว", "สามารถส่งตรวจ/ลงนาม หรือดูได้ที่ศูนย์รวมเอกสารของฉัน");
    } catch (e: unknown) {
      toastError("บันทึกไม่สำเร็จ", e instanceof Error ? e.message : "เกิดข้อผิดพลาด");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitWorkflow() {
    if (!valid || !meta) return;
    setBusy(true);
    try {
      let docId = savedDocId;
      if (!docId) {
        const res = await api.saveDivisionForm(slug, meta.divisionCode, subject || projectName || planName || meta.title, buildPayload(), true);
        docId = res.document.id;
        setSavedDocId(docId);
      }
      await api.submitBundle(docId, reviewerEmail, approverEmail);
      toastSuccess("ส่งตรวจ/ลงนามเรียบร้อยแล้ว");
    } catch (e: unknown) {
      toastError("ส่งตรวจไม่สำเร็จ", e instanceof Error ? e.message : "เกิดข้อผิดพลาด");
    } finally {
      setBusy(false);
    }
  }

  if (!valid || !meta) {
    return (
      <div className="ledger-panel space-y-3 p-8 text-center text-sm">
        <p className="font-bold text-[#0F172A]">ไม่พบแบบฟอร์มเอกสารที่ระบุ</p>
        <Link href="/divisions" className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-4 py-2 text-xs font-semibold text-white">
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>กลับไปศูนย์รวมเอกสาร 4 ฝ่าย</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Banner */}
      <div className="ledger-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0F172A] px-5 py-4 text-white">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded border border-white/25 bg-white/10 px-2 py-0.5 text-[10px] font-bold">{meta.divisionName}</span>
              <h2 className="text-base font-bold">{meta.title}</h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-300">{meta.description}</p>
          </div>
          <Link
            href="/divisions"
            className="inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>เอกสารประจำ 4 ฝ่าย</span>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Left Form Column */}
        <div className="space-y-4 xl:col-span-7">
          <section className="ledger-panel overflow-hidden text-xs">
            <div className="ledger-panel-header">
              <h3 className="text-sm font-bold text-[#0F172A]">1. ข้อมูลหัวบันทึกและผู้รับผิดชอบ</h3>
            </div>
            <div className="grid grid-cols-1 gap-2.5 p-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">เลขที่หนังสือ (ที่)</label>
                <input type="text" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder="เช่น ฝบ. .../2569" className="ledger-input py-1.5 text-xs" />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">วันที่เอกสาร</label>
                <input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className="ledger-input py-1.5 text-xs" />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">แผนกวิชา / งาน</label>
                <input type="text" value={departmentName} onChange={(e) => setDepartmentName(e.target.value)} className="ledger-input py-1.5 text-xs" />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">ผู้ขออนุญาต / ผู้รายงาน</label>
                <input type="text" value={requesterName} onChange={(e) => setRequesterName(e.target.value)} className="ledger-input py-1.5 text-xs" />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">ตำแหน่ง</label>
                <input type="text" value={requesterTitle} onChange={(e) => setRequesterTitle(e.target.value)} className="ledger-input py-1.5 text-xs" />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">หัวหน้าแผนก / หัวหน้างาน</label>
                <input type="text" value={deptHeadName} onChange={(e) => setDeptHeadName(e.target.value)} placeholder="ระบุชื่อหัวหน้างาน (ถ้ามี)" className="ledger-input py-1.5 text-xs" />
              </div>
            </div>
          </section>

          {/* Form-specific fields */}
          <section className="ledger-panel overflow-hidden text-xs">
            <div className="ledger-panel-header">
              <h3 className="text-sm font-bold text-[#0F172A]">2. รายละเอียด{meta.title}</h3>
            </div>
            <div className="space-y-3 p-4">
              {slug === "vehicle_request" && (
                <>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="mb-1 block font-semibold text-[#475569]">วัตถุประสงค์การใช้รถ</label>
                      <input type="text" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="เช่น ไปร่วมประชุม / นำนักศึกษาแข่งขันทักษะ" className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">สถานที่ / เส้นทาง</label>
                      <input type="text" value={destination} onChange={(e) => setDestination(e.target.value)} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">วันที่ใช้รถ</label>
                      <input type="date" value={travelDate} onChange={(e) => setTravelDate(e.target.value)} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">เวลาไป</label>
                      <input type="text" value={timeStart} onChange={(e) => setTimeStart(e.target.value)} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">เวลากลับ</label>
                      <input type="text" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">ประเภทรถยนต์</label>
                      <input type="text" value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">ทะเบียนรถ</label>
                      <input type="text" value={licensePlate} onChange={(e) => setLicensePlate(e.target.value)} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block font-semibold text-[#475569]">พนักงานขับรถ</label>
                      <input type="text" value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="ระบุชื่อพนักงานขับรถ (หรือเว้นว่าง)" className="ledger-input py-1.5 text-xs" />
                    </div>
                  </div>
                  <div className="space-y-2 border-t border-[#E2E8F0] pt-3">
                    <div className="flex items-center justify-between font-bold text-[#0F172A]">
                      <span>รายชื่อผู้ร่วมเดินทาง</span>
                      <button type="button" onClick={() => setPassengers((p) => [...p, { name: "", position: "" }])} className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] px-2 py-1 text-[11px] font-semibold hover:bg-slate-50">
                        <Plus className="h-3 w-3" /> เพิ่มผู้เดินทาง
                      </button>
                    </div>
                    {passengers.map((p, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2">
                        <input type="text" placeholder="ชื่อ-สกุล" value={p.name} onChange={(e) => setPassengers((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))} className="ledger-input col-span-6 py-1 text-xs" />
                        <input type="text" placeholder="ตำแหน่ง" value={p.position} onChange={(e) => setPassengers((prev) => prev.map((x, i) => (i === idx ? { ...x, position: e.target.value } : x)))} className="ledger-input col-span-5 py-1 text-xs" />
                        <button type="button" onClick={() => setPassengers((prev) => prev.filter((_, i) => i !== idx))} className="col-span-1 flex items-center justify-center text-slate-400 hover:text-[#B91C1C]">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {slug === "official_travel" && (
                <>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="mb-1 block font-semibold text-[#475569]">เรื่อง / กิจกรรมที่ไปราชการ</label>
                      <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">สถานที่ไปราชการ</label>
                      <input type="text" value={destination} onChange={(e) => setDestination(e.target.value)} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">พาหนะเดินทาง</label>
                      <input type="text" value={vehicle} onChange={(e) => setVehicle(e.target.value)} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">ตั้งแต่วันที่</label>
                      <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">ถึงวันที่</label>
                      <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">ค่าเบี้ยเลี้ยง (บาท)</label>
                      <NumericInput decimal min={0} placeholder="0" value={allowanceAmount} onChangeValue={setAllowanceAmount} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">ค่าที่พัก (บาท)</label>
                      <NumericInput decimal min={0} placeholder="0" value={lodgingAmount} onChangeValue={setLodgingAmount} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">ค่าพาหนะ (บาท)</label>
                      <NumericInput decimal min={0} placeholder="0" value={transportAmount} onChangeValue={setTransportAmount} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">ค่าใช้จ่ายอื่นๆ (บาท)</label>
                      <NumericInput decimal min={0} placeholder="0" value={otherAmount} onChangeValue={setOtherAmount} className="ledger-input py-1.5 text-xs" />
                    </div>
                  </div>
                  <div className="space-y-2 border-t border-[#E2E8F0] pt-3">
                    <div className="flex items-center justify-between font-bold text-[#0F172A]">
                      <span>รายชื่อผู้เดินทางไปราชการ</span>
                      <button type="button" onClick={() => setTravelers((p) => [...p, { name: "", position: "" }])} className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] px-2 py-1 text-[11px] font-semibold hover:bg-slate-50">
                        <Plus className="h-3 w-3" /> เพิ่มผู้เดินทาง
                      </button>
                    </div>
                    {travelers.map((t, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2">
                        <input type="text" placeholder="ชื่อ-สกุล" value={t.name} onChange={(e) => setTravelers((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))} className="ledger-input col-span-6 py-1 text-xs" />
                        <input type="text" placeholder="ตำแหน่ง" value={t.position} onChange={(e) => setTravelers((prev) => prev.map((x, i) => (i === idx ? { ...x, position: e.target.value } : x)))} className="ledger-input col-span-5 py-1 text-xs" />
                        <button type="button" onClick={() => setTravelers((prev) => prev.filter((_, i) => i !== idx))} className="col-span-1 flex items-center justify-center text-slate-400 hover:text-[#B91C1C]">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {slug === "overload_teaching" && (
                <>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">ภาคเรียน / ปีการศึกษา</label>
                      <input type="text" value={semester} onChange={(e) => setSemester(e.target.value)} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">ประจำเดือน</label>
                      <input type="text" value={monthLabel} onChange={(e) => setMonthLabel(e.target.value)} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">ภาระงานสอนปกติ (คาบ/สัปดาห์)</label>
                      <NumericInput min={0} placeholder="18" value={baseLoadHours} onChangeValue={setBaseLoadHours} className="ledger-input py-1.5 text-xs" />
                    </div>
                  </div>
                  <div className="space-y-2 border-t border-[#E2E8F0] pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 font-bold text-[#0F172A]">
                      <span>รายวิชาสอนเกินภาระงาน (รวม {overloadTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท)</span>
                      <button type="button" onClick={() => setOverloadCourses((p) => [...p, { course_code: "", course_name: "", extra_hours: 0, rate_per_hour: 200 }])} className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] px-2 py-1 text-[11px] font-semibold hover:bg-slate-50">
                        <Plus className="h-3 w-3" /> เพิ่มรายวิชา
                      </button>
                    </div>
                    {overloadCourses.map((c, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-1.5 rounded border border-[#E2E8F0] bg-[#F8FAFC] p-2">
                        <input type="text" placeholder="รหัสวิชา" value={c.course_code} onChange={(e) => setOverloadCourses((p) => p.map((x, i) => (i === idx ? { ...x, course_code: e.target.value } : x)))} className="ledger-input col-span-4 py-1 text-xs sm:col-span-3" />
                        <input type="text" placeholder="ชื่อวิชา" value={c.course_name} onChange={(e) => setOverloadCourses((p) => p.map((x, i) => (i === idx ? { ...x, course_name: e.target.value } : x)))} className="ledger-input col-span-8 py-1 text-xs sm:col-span-4" />
                        <div className="col-span-5 sm:col-span-2">
                          <NumericInput decimal min={0} placeholder="คาบเกิน" value={c.extra_hours} onChangeValue={(v) => setOverloadCourses((p) => p.map((x, i) => (i === idx ? { ...x, extra_hours: v } : x)))} className="ledger-input py-1 text-xs" />
                        </div>
                        <div className="col-span-5 sm:col-span-2">
                          <NumericInput decimal min={0} placeholder="อัตรา/คาบ" value={c.rate_per_hour} onChangeValue={(v) => setOverloadCourses((p) => p.map((x, i) => (i === idx ? { ...x, rate_per_hour: v } : x)))} className="ledger-input py-1 text-xs" />
                        </div>
                        <button type="button" onClick={() => setOverloadCourses((p) => p.filter((_, i) => i !== idx))} className="col-span-2 flex items-center justify-center text-slate-400 hover:text-[#B91C1C] sm:col-span-1">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {slug === "internship_supervision" && (
                <>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">ภาคเรียน / ปีการศึกษา</label>
                      <input type="text" value={semester} onChange={(e) => setSemester(e.target.value)} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">วันที่นิเทศ</label>
                      <input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">ชื่อสถานประกอบการ</label>
                      <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">ผู้ควบคุมฝึก / พี่เลี้ยง</label>
                      <input type="text" value={mentorName} onChange={(e) => setMentorName(e.target.value)} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block font-semibold text-[#475569]">ที่ตั้งสถานประกอบการ</label>
                      <input type="text" value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} className="ledger-input py-1.5 text-xs" />
                    </div>
                  </div>
                  <div className="space-y-2 border-t border-[#E2E8F0] pt-3">
                    <div className="flex items-center justify-between font-bold text-[#0F172A]">
                      <span>รายชื่อนักศึกษาฝึกงาน</span>
                      <button type="button" onClick={() => setInternStudents((p) => [...p, { student_id: "", name: "", result: "ผ่านเกณฑ์ดี" }])} className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] px-2 py-1 text-[11px] font-semibold hover:bg-slate-50">
                        <Plus className="h-3 w-3" /> เพิ่มนักศึกษา
                      </button>
                    </div>
                    {internStudents.map((s, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-1.5">
                        <input type="text" placeholder="รหัสนักศึกษา" value={s.student_id} onChange={(e) => setInternStudents((p) => p.map((x, i) => (i === idx ? { ...x, student_id: e.target.value } : x)))} className="ledger-input col-span-3 py-1 text-xs" />
                        <input type="text" placeholder="ชื่อ-สกุล" value={s.name} onChange={(e) => setInternStudents((p) => p.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))} className="ledger-input col-span-5 py-1 text-xs" />
                        <input type="text" placeholder="ผลการนิเทศ" value={s.result} onChange={(e) => setInternStudents((p) => p.map((x, i) => (i === idx ? { ...x, result: e.target.value } : x)))} className="ledger-input col-span-3 py-1 text-xs" />
                        <button type="button" onClick={() => setInternStudents((p) => p.filter((_, i) => i !== idx))} className="col-span-1 flex items-center justify-center text-slate-400 hover:text-[#B91C1C]">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">สรุปผลการนิเทศ</label>
                    <textarea rows={2} value={supervisionSummary} onChange={(e) => setSupervisionSummary(e.target.value)} className="ledger-input py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">ปัญหาและข้อเสนอแนะ</label>
                    <textarea rows={2} value={suggestions} onChange={(e) => setSuggestions(e.target.value)} className="ledger-input py-1.5 text-xs" />
                  </div>
                </>
              )}

              {slug === "home_visit" && (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">วันที่เยี่ยมบ้าน</label>
                    <input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} className="ledger-input py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">รหัสประจำตัวนักเรียน</label>
                    <input type="text" value={studentId} onChange={(e) => setStudentId(e.target.value)} className="ledger-input py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">ชื่อ - สกุลนักเรียน</label>
                    <input type="text" value={studentName} onChange={(e) => setStudentName(e.target.value)} className="ledger-input py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">ระดับชั้น / กลุ่มเรียน</label>
                    <input type="text" value={studentGroup} onChange={(e) => setStudentGroup(e.target.value)} className="ledger-input py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">ชื่อผู้ปกครอง</label>
                    <input type="text" value={guardianName} onChange={(e) => setGuardianName(e.target.value)} className="ledger-input py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">เบอร์โทรผู้ปกครอง</label>
                    <input type="text" value={guardianPhone} onChange={(e) => setGuardianPhone(e.target.value)} className="ledger-input py-1.5 text-xs" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block font-semibold text-[#475569]">ที่อยู่ปัจจุบัน</label>
                    <input type="text" value={homeAddress} onChange={(e) => setHomeAddress(e.target.value)} className="ledger-input py-1.5 text-xs" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block font-semibold text-[#475569]">๑. สภาพความเป็นอยู่และเศรษฐกิจครอบครัว</label>
                    <textarea rows={2} value={livingCondition} onChange={(e) => setLivingCondition(e.target.value)} className="ledger-input py-1.5 text-xs" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block font-semibold text-[#475569]">๒. พฤติกรรม ความประพฤติ และปัญหาที่พบ</label>
                    <textarea rows={2} value={behaviorNote} onChange={(e) => setBehaviorNote(e.target.value)} className="ledger-input py-1.5 text-xs" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block font-semibold text-[#475569]">๓. แนวทางการดูแลช่วยเหลือ / ส่งต่อ</label>
                    <textarea rows={2} value={supportPlan} onChange={(e) => setSupportPlan(e.target.value)} className="ledger-input py-1.5 text-xs" />
                  </div>
                </div>
              )}

              {slug === "project_summary" && (
                <>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="mb-1 block font-semibold text-[#475569]">ชื่อโครงการ</label>
                      <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">รหัสโครงการ</label>
                      <input type="text" value={projectCode} onChange={(e) => setProjectCode(e.target.value)} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">ปีงบประมาณ พ.ศ.</label>
                      <NumericInput placeholder="2570" value={budgetYearBe} onChangeValue={setBudgetYearBe} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">งบประมาณที่ได้รับอนุมัติ (บาท)</label>
                      <NumericInput decimal min={0} placeholder="0" value={budgetAllocated} onChangeValue={setBudgetAllocated} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">งบประมาณที่ใช้จ่ายจริง (บาท)</label>
                      <NumericInput decimal min={0} placeholder="0" value={budgetSpent} onChangeValue={setBudgetSpent} className="ledger-input py-1.5 text-xs" />
                    </div>
                  </div>
                  <div className="space-y-2 border-t border-[#E2E8F0] pt-3">
                    <div className="flex items-center justify-between font-bold text-[#0F172A]">
                      <span>ตัวชี้วัดความสำเร็จ (KPI)</span>
                      <button type="button" onClick={() => setKpis((p) => [...p, { indicator: "", target: "", actual: "" }])} className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] px-2 py-1 text-[11px] font-semibold hover:bg-slate-50">
                        <Plus className="h-3 w-3" /> เพิ่มตัวชี้วัด
                      </button>
                    </div>
                    {kpis.map((k, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-1.5">
                        <input type="text" placeholder="ตัวชี้วัด" value={k.indicator} onChange={(e) => setKpis((p) => p.map((x, i) => (i === idx ? { ...x, indicator: e.target.value } : x)))} className="ledger-input col-span-6 py-1 text-xs" />
                        <input type="text" placeholder="เป้าหมาย" value={k.target} onChange={(e) => setKpis((p) => p.map((x, i) => (i === idx ? { ...x, target: e.target.value } : x)))} className="ledger-input col-span-2 py-1 text-xs" />
                        <input type="text" placeholder="ผลที่ได้" value={k.actual} onChange={(e) => setKpis((p) => p.map((x, i) => (i === idx ? { ...x, actual: e.target.value } : x)))} className="ledger-input col-span-3 py-1 text-xs" />
                        <button type="button" onClick={() => setKpis((p) => p.filter((_, i) => i !== idx))} className="col-span-1 flex items-center justify-center text-slate-400 hover:text-[#B91C1C]">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">สรุปผลการดำเนินงาน</label>
                    <textarea rows={2} value={summaryNote} onChange={(e) => setSummaryNote(e.target.value)} className="ledger-input py-1.5 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">ปัญหา อุปสรรค และข้อเสนอแนะ</label>
                    <textarea rows={2} value={problemsNote} onChange={(e) => setProblemsNote(e.target.value)} className="ledger-input py-1.5 text-xs" />
                  </div>
                </>
              )}

              {slug === "single_plan_summary" && (
                <>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <label className="mb-1 block font-semibold text-[#475569]">ชื่อแผนปฏิบัติการ / แผนเดี่ยว</label>
                      <input type="text" value={planName} onChange={(e) => setPlanName(e.target.value)} className="ledger-input py-1.5 text-xs" />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">ปีงบประมาณ พ.ศ.</label>
                      <NumericInput placeholder="2570" value={budgetYearBe} onChangeValue={setBudgetYearBe} className="ledger-input py-1.5 text-xs" />
                    </div>
                  </div>
                  <div className="space-y-2 border-t border-[#E2E8F0] pt-3">
                    <div className="flex items-center justify-between font-bold text-[#0F172A]">
                      <span>รายการกิจกรรมตามแผน</span>
                      <button type="button" onClick={() => setPlanActivities((p) => [...p, { activity: "", target: "", result: "", percent: "100%" }])} className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] px-2 py-1 text-[11px] font-semibold hover:bg-slate-50">
                        <Plus className="h-3 w-3" /> เพิ่มกิจกรรม
                      </button>
                    </div>
                    {planActivities.map((a, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-1.5">
                        <input type="text" placeholder="กิจกรรม" value={a.activity} onChange={(e) => setPlanActivities((p) => p.map((x, i) => (i === idx ? { ...x, activity: e.target.value } : x)))} className="ledger-input col-span-5 py-1 text-xs" />
                        <input type="text" placeholder="เป้าหมาย" value={a.target} onChange={(e) => setPlanActivities((p) => p.map((x, i) => (i === idx ? { ...x, target: e.target.value } : x)))} className="ledger-input col-span-2 py-1 text-xs" />
                        <input type="text" placeholder="ผลดำเนินงาน" value={a.result} onChange={(e) => setPlanActivities((p) => p.map((x, i) => (i === idx ? { ...x, result: e.target.value } : x)))} className="ledger-input col-span-2 py-1 text-xs" />
                        <input type="text" placeholder="ร้อยละ" value={a.percent} onChange={(e) => setPlanActivities((p) => p.map((x, i) => (i === idx ? { ...x, percent: e.target.value } : x)))} className="ledger-input col-span-2 py-1 text-xs" />
                        <button type="button" onClick={() => setPlanActivities((p) => p.filter((_, i) => i !== idx))} className="col-span-1 flex items-center justify-center text-slate-400 hover:text-[#B91C1C]">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">สรุปผลภาพรวมและข้อเสนอแนะ</label>
                    <textarea rows={2} value={summaryNote} onChange={(e) => setSummaryNote(e.target.value)} className="ledger-input py-1.5 text-xs" />
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Workflow & Action Buttons */}
          <section className="ledger-panel space-y-3 p-4 text-xs">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">ผู้ตรวจทาน</label>
                <select value={reviewerEmail} onChange={(e) => setReviewerEmail(e.target.value)} className="ledger-input py-1.5 text-xs">
                  <option value="">-- ส่งตรงผู้อนุมัติ --</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.email || ""}>
                      {u.full_name} ({u.position_title})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">ผู้อนุมัติ</label>
                <select value={approverEmail} onChange={(e) => setApproverEmail(e.target.value)} className="ledger-input py-1.5 text-xs">
                  {users.map((u) => (
                    <option key={u.id} value={u.email || ""}>
                      {u.full_name} ({u.position_title})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={handleRender}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-4 py-2 font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                <span>สร้างเอกสารและพรีวิว</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleSaveDraft}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-3.5 py-2 font-semibold text-[#0F172A] hover:bg-slate-50 disabled:opacity-50"
              >
                <FileCheck2 className="h-4 w-4" />
                <span>บันทึกร่าง</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleSubmitWorkflow}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#0F172A] px-3.5 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                <span>ส่งตรวจ / ลงนาม</span>
              </button>
              {renderResult?.docx_url && (
                <a
                  href={`${API_BASE}${renderResult.docx_url}?download=1`}
                  className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-3 py-2 font-semibold text-[#0F172A] hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" /> .DOCX
                </a>
              )}
              {renderResult?.pdf_url && (
                <a
                  href={`${API_BASE}${renderResult.pdf_url}?download=1`}
                  className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-3 py-2 font-semibold text-[#0F172A] hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" /> .PDF
                </a>
              )}
            </div>
          </section>
        </div>

        {/* Right Live A4 Preview */}
        <div className="hidden xl:col-span-5 xl:block">
          <div className="sticky top-20">
            <DocumentPreviewPanel
              fontFamily="TH Sarabun New"
              pageImageUrls={renderResult?.page_image_urls || []}
              pdfUrl={renderResult?.pdf_url || undefined}
              docxUrl={renderResult?.docx_url || undefined}
              versionKey={previewVersion}
              loading={busy}
              emptyMessage="กรอกรายละเอียดแบบฟอร์มด้านซ้าย แล้วกด 'สร้างเอกสารและพรีวิว'"
            />
          </div>
        </div>
      </div>

      {/* Mobile Floating Preview Pill */}
      {(renderResult?.page_image_urls?.length || 0) > 0 && (
        <button
          type="button"
          onClick={() => setMobilePreviewOpen(true)}
          className="fixed bottom-4 right-4 z-30 inline-flex items-center gap-2 rounded-full bg-[#0F172A] px-4 py-2.5 text-xs font-semibold text-white shadow-lg xl:hidden"
        >
          <Eye className="h-4 w-4" />
          <span>ดูตัวอย่างเอกสาร</span>
          <span className="rounded-full bg-[#1D4ED8] px-2 py-0.5 text-[10px]">{renderResult?.page_image_urls.length} หน้า</span>
        </button>
      )}
      <ResponsivePreviewModal open={mobilePreviewOpen} onOpenChange={setMobilePreviewOpen} title={meta.title}>
        <DocumentPreviewPanel
          fontFamily="TH Sarabun New"
          pageImageUrls={renderResult?.page_image_urls || []}
          pdfUrl={renderResult?.pdf_url || undefined}
          docxUrl={renderResult?.docx_url || undefined}
          versionKey={previewVersion}
          loading={busy}
        />
      </ResponsivePreviewModal>
    </div>
  );
}
