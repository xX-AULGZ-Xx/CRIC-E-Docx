"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Eye, FileCheck2, PackageCheck, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { DocumentPreviewPanel } from "@/components/DocumentPreviewPanel";
import { ResponsivePreviewModal } from "@/components/ResponsivePreviewModal";
import { api, API_BASE, BundleRenderResult, UserProfile } from "@/lib/api";
import { toastError, toastInfo, toastSuccess } from "@/lib/swal";

interface SpItemRow {
  name: string;
  spec: string;
  qty: number;
  unit: string;
  unit_price: number;
  note: string;
}

export default function ProcurementBundlePage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [projectName, setProjectName] = useState("");
  const [docNumber, setDocNumber] = useState("");
  const [budgetYearBe, setBudgetYearBe] = useState(2570);
  const [departmentName, setDepartmentName] = useState("");
  const [divisionName, setDivisionName] = useState("ฝ่ายวิชาการ");
  const [levelLabel, setLevelLabel] = useState("ปวช.");
  const [studentCount, setStudentCount] = useState(20);
  const [semesterLabel, setSemesterLabel] = useState("2/2569");
  const [docDate, setDocDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [requestKind, setRequestKind] = useState("จัดซื้อ");
  const [materialKind, setMaterialKind] = useState("วัสดุ");
  const [planSource, setPlanSource] = useState("ตามใบงาน / แผนการสอน");
  const [expectedOutcome, setExpectedOutcome] = useState("");
  const [outcomeUnits, setOutcomeUnits] = useState("");
  const [objectivesText, setObjectivesText] = useState("");
  const [torBackground, setTorBackground] = useState("");
  const [torObjective, setTorObjective] = useState("");
  const [deliveryDays, setDeliveryDays] = useState(7);
  const [sp1Subject, setSp1Subject] = useState("");
  const [expenseCategory, setExpenseCategory] = useState<"material" | "service">("material");
  const [expenseLabel, setExpenseLabel] = useState("");
  const [changeFlags, setChangeFlags] = useState({
    additional: false,
    modify_activity: false,
    modify_budget: false,
    modify_period: false,
    improve_efficiency: false,
    other: false,
    other_text: "",
  });
  const [oldBudget, setOldBudget] = useState("");
  const [newBudget, setNewBudget] = useState("");

  const [requesterName, setRequesterName] = useState("");
  const [requesterTitle, setRequesterTitle] = useState("ผู้รับผิดชอบโครงการ");
  const [deptHeadName, setDeptHeadName] = useState("");
  const [deputyName, setDeputyName] = useState("");
  const [deputyTitle, setDeputyTitle] = useState("");
  const [torChairName, setTorChairName] = useState("");
  const [torMember1, setTorMember1] = useState("");
  const [torMember2, setTorMember2] = useState("");
  const [suppliesHeadName, setSuppliesHeadName] = useState("");
  const [planHeadName, setPlanHeadName] = useState("");
  const [deputyPlanName, setDeputyPlanName] = useState("");
  const [deputyResourceName, setDeputyResourceName] = useState("");
  const [purchaseMethod, setPurchaseMethod] = useState("specific");
  const [procurementCommitteeText, setProcurementCommitteeText] = useState("");
  const [committeeText, setCommitteeText] = useState("");
  const [includeUrgentPo, setIncludeUrgentPo] = useState(false);
  const [urgentVendor, setUrgentVendor] = useState("");

  const [items, setItems] = useState<SpItemRow[]>([
    { name: "", spec: "", qty: 1, unit: "ชุด", unit_price: 0, note: "" },
  ]);

  // AI Draft Assistant
  const [aiBudgetHint, setAiBudgetHint] = useState("3000");
  const [aiNote, setAiNote] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  // Preview, Save & Workflow
  const previewKeyRef = useRef("");
  const [renderResult, setRenderResult] = useState<BundleRenderResult | null>(null);
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const [previewVersion, setPreviewVersion] = useState(1);
  const [savedDocId, setSavedDocId] = useState<string | null>(null);
  const [reviewerEmail, setReviewerEmail] = useState("orawan@cric.ac.th");
  const [approverEmail, setApproverEmail] = useState("director@cric.ac.th");
  const [aiCopilotEnabled, setAiCopilotEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!previewKeyRef.current) {
      previewKeyRef.current = `sp_${Math.random().toString(36).slice(2, 10)}`;
    }
    const divNameMap: Record<string, string> = {
      "ฝบ.": "ฝ่ายบริหารทรัพยากร",
      "ฝว.": "ฝ่ายวิชาการ",
      "ฝย.": "ฝ่ายยุทธศาสตร์และแผนงาน",
      "ฝก.": "ฝ่ายกิจการนักเรียน นักศึกษา",
    };
    const applyMyProfile = () => {
      api
        .me()
        .then(({ user }) => {
          if (user?.full_name) setRequesterName(user.full_name);
          if (user?.position_title) setRequesterTitle(user.position_title);
          if (user?.unit_name) setDepartmentName((prev) => prev || user.unit_name || "");
          if (user?.division_code && divNameMap[user.division_code]) {
            setDivisionName(divNameMap[user.division_code]);
          }
          if (user?.default_reviewer_email) setReviewerEmail(user.default_reviewer_email);
        })
        .catch(() => {});
    };
    applyMyProfile();
    window.addEventListener("cric-user-changed", applyMyProfile);
    window.addEventListener("cric-profile-updated", applyMyProfile);
    api.listUsers().then((res) => setUsers(res.users)).catch(() => {});
    api.getPublicSettings().then((pub) => {
      if (typeof pub.ai_copilot_enabled === "boolean") {
        setAiCopilotEnabled(pub.ai_copilot_enabled);
      }
      const sp1 = pub.org_profile?.sp1_signers;
      if (sp1) {
        setPlanHeadName((prev) => prev || sp1.plan_head || "");
        setDeputyPlanName((prev) => prev || sp1.deputy_plan || "");
        setSuppliesHeadName((prev) => prev || sp1.supplies_head || "");
        setDeputyResourceName((prev) => prev || sp1.deputy_resource || "");
      }
    }).catch(() => {});
    return () => {
      window.removeEventListener("cric-user-changed", applyMyProfile);
      window.removeEventListener("cric-profile-updated", applyMyProfile);
    };
  }, []);

  const grandTotal = items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0);

  function buildPayload(): Record<string, unknown> {
    return {
      project_name: projectName,
      doc_number: docNumber,
      budget_year_be: Number(budgetYearBe),
      department_name: departmentName,
      division_name: divisionName,
      level_label: levelLabel,
      student_count: Number(studentCount),
      semester_label: semesterLabel,
      doc_date: docDate,
      start_date: startDate,
      end_date: endDate,
      request_kind: requestKind,
      material_kind: materialKind,
      plan_source: planSource,
      expected_outcome: expectedOutcome,
      outcome_units: outcomeUnits,
      objectives: objectivesText.split("\n").map((s) => s.trim()).filter(Boolean),
      sp1_subject: sp1Subject,
      expense_category: expenseCategory,
      expense_label: expenseLabel,
      change_flags: changeFlags,
      old_budget: oldBudget,
      new_budget: newBudget,
      tor_background: torBackground,
      tor_objective: torObjective,
      delivery_days: Number(deliveryDays),
      requester_name: requesterName,
      requester_title: requesterTitle,
      dept_head_name: deptHeadName,
      deputy_name: deputyName,
      deputy_title: deputyTitle,
      tor_chair_name: torChairName,
      tor_member_1: torMember1,
      tor_member_2: torMember2,
      supplies_head_name: suppliesHeadName,
      plan_head_name: planHeadName,
      deputy_plan_name: deputyPlanName,
      deputy_resource_name: deputyResourceName,
      purchase_method: purchaseMethod,
      procurement_committee_members: procurementCommitteeText.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 3),
      committee_members: committeeText.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 3),
      include_urgent_po: includeUrgentPo,
      urgent_po_vendor: urgentVendor,
      items: items.filter((it) => it.name.trim()),
    };
  }

  async function handleAiDraft() {
    if (!projectName.trim()) {
      const m = "กรุณาระบุชื่อโครงการฝึก / งานจัดซื้อก่อนเรียกใช้ AI ช่วยร่าง";
      setMsg(m);
      toastInfo("กรุณาระบุชื่อโครงการ", m);
      return;
    }
    setAiLoading(true);
    setMsg("");
    try {
      const res = await api.aiDraftSp({
        project_name: projectName,
        department_name: departmentName || "แผนกวิชา",
        budget_hint: Number(aiBudgetHint) || undefined,
        prompt: aiNote,
      });
      if (res.objectives?.length) setObjectivesText(res.objectives.join("\n"));
      if (res.expected_outcome) setExpectedOutcome(res.expected_outcome);
      if (res.tor_background) setTorBackground(res.tor_background);
      if (res.tor_objective) setTorObjective(res.tor_objective);
      if (res.items?.length) setItems(res.items);
      const m = `AI (${res.mode}) ร่างรายละเอียดโครงการ รายการวัสดุ และ TOR ให้เรียบร้อยแล้ว`;
      setMsg(m);
      toastSuccess("AI ช่วยร่างชุด สผ. แล้ว", `โหมด ${res.mode}`);
    } catch (err) {
      const m = err instanceof Error ? err.message : "AI ช่วยร่างไม่สำเร็จ";
      setMsg(m);
      toastError("AI ช่วยร่างไม่สำเร็จ", m);
    } finally {
      setAiLoading(false);
    }
  }

  async function handleRenderBundle() {
    setBusy(true);
    setMsg("");
    try {
      const res = await api.renderSpBundle(buildPayload(), true, previewKeyRef.current);
      setRenderResult(res);
      setActiveFileIdx(0);
      setPreviewVersion((v) => v + 1);
      const m = `สร้างชุดเอกสาร สผ. สำเร็จ (${res.bundle_files.length} ไฟล์) — ยอดรวม ${res.grand_total?.toLocaleString()} บาท (${res.grand_total_thai_text})`;
      setMsg(m);
      toastSuccess(`สร้างชุด สผ. ${res.bundle_files.length} ไฟล์สำเร็จ`, `ยอดรวม ${res.grand_total?.toLocaleString()} บาท`);
    } catch (err) {
      const m = err instanceof Error ? err.message : "สร้างชุดเอกสารไม่สำเร็จ";
      setMsg(m);
      toastError("สร้างชุดเอกสารไม่สำเร็จ", m);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveOrSubmit(submitAfterSave: boolean) {
    if (!projectName.trim()) {
      const m = "กรุณาระบุชื่อโครงการก่อนบันทึก";
      setMsg(m);
      toastInfo("กรุณาระบุชื่อโครงการ", m);
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const divCode = divisionName.includes("บริหาร") ? "ฝบ." : divisionName.includes("ยุทธ") ? "ฝย." : divisionName.includes("กิจการ") ? "ฝก." : "ฝว.";
      const saveRes = await api.saveSpBundle(
        buildPayload(),
        divCode,
        `ชุดจัดซื้อวัสดุฝึก: ${projectName}`,
        savedDocId || undefined
      );
      setSavedDocId(saveRes.document.id);
      setRenderResult(saveRes.render);
      setActiveFileIdx(0);
      setPreviewVersion((v) => v + 1);
      if (submitAfterSave) {
        await api.submitBundle(saveRes.document.id, reviewerEmail || null, approverEmail);
        setMsg(`ส่งชุด สผ. "${projectName}" เข้าคิวตรวจร่าง & ลงนาม (/approvals) เรียบร้อยแล้ว`);
        toastSuccess("ส่งตรวจและลงนามเรียบร้อย", projectName);
      } else {
        setMsg(`บันทึกชุด สผ. "${projectName}" ลงระบบเรียบร้อยแล้ว`);
        toastSuccess("บันทึกร่างชุด สผ. แล้ว", projectName);
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : "บันทึก/ส่งเอกสารไม่สำเร็จ";
      setMsg(m);
      toastError("บันทึกหรือส่งเอกสารไม่สำเร็จ", m);
    } finally {
      setBusy(false);
    }
  }

  const activeFile = renderResult?.bundle_files?.[activeFileIdx] || null;

  return (
    <div className="space-y-4">
      <div className="ledger-panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <PackageCheck className="h-4 w-4 text-[#1D4ED8]" />
          <span className="font-bold text-[#0F172A]">ชุดเอกสารที่สร้างในคราวเดียว:</span>
          {["1. บันทึกข้อความ", "2. ใบ สผ.1 (พ.101)", "3. แผนโครงการฝึก (.XLSX)", "4. ร่าง TOR (.XLSX)", "5. ใบสั่งซื้อชั่วคราว (เลือกได้)"].map((step) => (
            <span key={step} className="rounded border border-[#CBD5E1] bg-[#F8FAFC] px-2 py-0.5 text-[11px] font-medium text-[#334155]">
              {step}
            </span>
          ))}
        </div>
        {renderResult?.zip_url && (
          <a
            href={`${API_BASE}${renderResult.zip_url}?download=1`}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
          >
            <Download className="h-3.5 w-3.5" />
            ดาวน์โหลดทั้งชุด (.ZIP)
          </a>
        )}
      </div>

      {msg && (
        <div className="rounded-md border border-blue-300 bg-[#EFF6FF] px-4 py-2.5 text-sm font-medium text-[#1E3A8A]">
          {msg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* Left: Unified SP Form */}
        <div className="space-y-4 xl:col-span-6">
          {/* AI Helper */}
          {aiCopilotEnabled && (
            <section className="ledger-panel overflow-hidden">
              <div className="ledger-panel-header flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#1E3A8A]">
                <Sparkles className="h-3.5 w-3.5 text-[#1D4ED8]" />
                <span>AI ช่วยร่างรายการวัสดุ วัตถุประสงค์ และ TOR</span>
              </div>
              <button
                type="button"
                disabled={aiLoading}
                onClick={handleAiDraft}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-3 py-1 text-xs font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-50"
              >
                <Sparkles className="h-3 w-3" />
                {aiLoading ? "กำลังร่าง..." : "ร่างจากชื่อโครงการ"}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 p-3.5 sm:grid-cols-3">
              <input
                type="number"
                value={aiBudgetHint}
                onChange={(e) => setAiBudgetHint(e.target.value)}
                placeholder="งบประมาณโดยประมาณ (บาท)"
                className="ledger-input tabular-nums-th py-1.5 text-xs"
              />
              <input
                type="text"
                value={aiNote}
                onChange={(e) => setAiNote(e.target.value)}
                placeholder="ระบุลักษณะวิชา/งานฝึกเพิ่มเติม (ไม่บังคับ)..."
                className="ledger-input py-1.5 text-xs sm:col-span-2"
              />
            </div>
            </section>
          )}

          <section className="ledger-panel overflow-hidden text-xs">
            <div className="ledger-panel-header">
              <h2 className="text-sm font-bold text-[#0F172A]">1. ข้อมูลโครงการและหน่วยงาน</h2>
            </div>
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="mb-1 block font-semibold text-[#475569]">ชื่อโครงการฝึก / งานจัดซื้อ *</label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="เช่น จัดซื้อวัสดุฝึกวิชาระบบเครือข่ายคอมพิวเตอร์"
                    className="ledger-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">เลขที่หนังสือ (ที่)</label>
                  <input
                    type="text"
                    value={docNumber}
                    onChange={(e) => setDocNumber(e.target.value)}
                    placeholder="เช่น ฝว. .../2569"
                    className="ledger-input"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">แผนกวิชา / งาน</label>
                  <input type="text" value={departmentName} onChange={(e) => setDepartmentName(e.target.value)} placeholder="เช่น แผนกวิชาเทคโนโลยีฯ" className="ledger-input py-1.5 text-xs" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">ฝ่าย</label>
                  <input type="text" value={divisionName} onChange={(e) => setDivisionName(e.target.value)} className="ledger-input py-1.5 text-xs" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">ปีงบประมาณ พ.ศ.</label>
                  <input type="number" value={budgetYearBe} onChange={(e) => setBudgetYearBe(Number(e.target.value))} className="ledger-input tabular-nums-th py-1.5 text-xs" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">ระดับชั้น</label>
                  <input type="text" value={levelLabel} onChange={(e) => setLevelLabel(e.target.value)} className="ledger-input py-1.5 text-xs" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">จำนวนนักเรียน</label>
                  <input type="number" value={studentCount} onChange={(e) => setStudentCount(Number(e.target.value))} className="ledger-input tabular-nums-th py-1.5 text-xs" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">ภาคเรียน/ปี</label>
                  <input type="text" value={semesterLabel} onChange={(e) => setSemesterLabel(e.target.value)} className="ledger-input tabular-nums-th py-1.5 text-xs" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">ส่งมอบภายใน (วัน)</label>
                  <input type="number" value={deliveryDays} onChange={(e) => setDeliveryDays(Number(e.target.value))} className="ledger-input tabular-nums-th py-1.5 text-xs" />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">วันที่เอกสาร</label>
                  <input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className="ledger-input tabular-nums-th py-1.5 text-xs" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">วันเริ่มฝึก</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="ledger-input tabular-nums-th py-1.5 text-xs" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">วันสิ้นสุดฝึก</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="ledger-input tabular-nums-th py-1.5 text-xs" />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">ประเภทคำขอ</label>
                  <select value={requestKind} onChange={(e) => setRequestKind(e.target.value)} className="ledger-input py-1.5 text-xs">
                    <option value="จัดซื้อ">จัดซื้อ</option>
                    <option value="จัดจ้าง">จัดจ้าง</option>
                    <option value="จ้างซ่อม">จ้างซ่อม</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">หมวดพัสดุ</label>
                  <select value={materialKind} onChange={(e) => setMaterialKind(e.target.value)} className="ledger-input py-1.5 text-xs">
                    <option value="วัสดุ">วัสดุ</option>
                    <option value="ครุภัณฑ์">ครุภัณฑ์</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">ที่มาโครงการ</label>
                  <select value={planSource} onChange={(e) => setPlanSource(e.target.value)} className="ledger-input py-1.5 text-xs">
                    <option value="ตามใบงาน / แผนการสอน">ตามใบงาน / แผนการสอน</option>
                    <option value="ตามโครงการพัฒนาสถานศึกษา">ตามโครงการพัฒนาสถานศึกษา</option>
                    <option value="ตามโครงการผลิตเพื่อจำหน่าย">ตามโครงการผลิตเพื่อจำหน่าย</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold text-[#475569]">วัตถุประสงค์ (บรรทัดละ 1 ข้อ สูงสุด 3 ข้อ)</label>
                <textarea rows={2} value={objectivesText} onChange={(e) => setObjectivesText(e.target.value)} className="ledger-input prose-saraban py-1.5 text-xs" />
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">ผลที่คาดว่าจะได้รับ (ใบโครงการฝึก)</label>
                  <input type="text" value={expectedOutcome} onChange={(e) => setExpectedOutcome(e.target.value)} className="ledger-input py-1.5 text-xs" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">จำนวนหน่วยผลผลิต</label>
                  <input type="text" value={outcomeUnits} onChange={(e) => setOutcomeUnits(e.target.value)} className="ledger-input py-1.5 text-xs" />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">ความเป็นมา (TOR ข้อ 1)</label>
                  <textarea rows={2} value={torBackground} onChange={(e) => setTorBackground(e.target.value)} className="ledger-input prose-saraban py-1.5 text-xs" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">วัตถุประสงค์ (TOR ข้อ 2)</label>
                  <textarea rows={2} value={torObjective} onChange={(e) => setTorObjective(e.target.value)} className="ledger-input prose-saraban py-1.5 text-xs" />
                </div>
              </div>

              <details className="rounded-md border border-[#CBD5E1] bg-[#F8FAFC] p-2.5">
                <summary className="cursor-pointer font-semibold text-[#0F172A]">
                  ตัวเลือกเพิ่มเติมสำหรับบันทึกข้อความขออนุมัติและใบ สผ.1 (ปรับเปลี่ยนโครงการ, ค่าใช้จ่าย, เรื่อง)
                </summary>
                <div className="mt-2.5 space-y-2.5 border-t border-[#E2E8F0] pt-2.5">
                  <div>
                    <div className="mb-1.5 font-semibold text-[#475569]">ข้อ ๒ ขอปรับเปลี่ยนโครงการ (เลือกได้มากกว่า 1 ข้อ):</div>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {(
                        [
                          ["additional", "เพิ่มเติมโครงการ/กิจกรรม"],
                          ["modify_activity", "เปลี่ยนแปลงโครงการ/กิจกรรม"],
                          ["modify_budget", "เปลี่ยนแปลงงบประมาณ"],
                          ["modify_period", "เปลี่ยนแปลงระยะเวลาดำเนินการ"],
                          ["improve_efficiency", "เป็นการเพิ่มประสิทธิภาพการดำเนินงาน"],
                          ["other", "อื่น ๆ (ระบุ)"],
                        ] as const
                      ).map(([k, label]) => (
                        <label key={k} className="flex cursor-pointer items-center gap-1.5 text-xs text-[#0F172A]">
                          <input
                            type="checkbox"
                            checked={changeFlags[k]}
                            onChange={(e) => setChangeFlags((p) => ({ ...p, [k]: e.target.checked }))}
                            className="accent-[#1D4ED8]"
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                    {changeFlags.modify_budget && (
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-[#475569]">งบประมาณเดิม (บาท)</label>
                          <input type="text" value={oldBudget} onChange={(e) => setOldBudget(e.target.value)} placeholder="เช่น 5,000" className="ledger-input py-1 text-xs" />
                        </div>
                        <div>
                          <label className="mb-1 block text-[#475569]">งบประมาณที่ขอเปลี่ยนแปลง (บาท)</label>
                          <input type="text" value={newBudget} onChange={(e) => setNewBudget(e.target.value)} placeholder="เช่น 6,500" className="ledger-input py-1 text-xs" />
                        </div>
                      </div>
                    )}
                    {changeFlags.other && (
                      <div className="mt-2">
                        <label className="mb-1 block text-[#475569]">ระบุรายละเอียด &quot;อื่น ๆ&quot;</label>
                        <input
                          type="text"
                          value={changeFlags.other_text}
                          onChange={(e) => setChangeFlags((p) => ({ ...p, other_text: e.target.value }))}
                          placeholder="ระบุเพิ่มเติม..."
                          className="ledger-input py-1 text-xs"
                        />
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block font-semibold text-[#475569]">หมวดค่าใช้จ่าย (ข้อ ๓)</label>
                      <select
                        value={expenseCategory}
                        onChange={(e) => setExpenseCategory(e.target.value === "service" ? "service" : "material")}
                        className="ledger-input py-1 text-xs"
                      >
                        <option value="material">ค่าวัสดุ</option>
                        <option value="service">ค่าใช้สอย / จ้างเหมา</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block font-semibold text-[#475569]">ชื่อรายการขออนุมัติค่าใช้จ่าย (ข้อ ๓.๑)</label>
                      <input
                        type="text"
                        value={expenseLabel}
                        onChange={(e) => setExpenseLabel(e.target.value)}
                        placeholder="เว้นว่าง = ใช้ชื่อโครงการอัตโนมัติ"
                        className="ledger-input py-1 text-xs"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block font-semibold text-[#475569]">เรื่องในใบ สผ.1 (ถ้าต้องการกำหนดเอง)</label>
                    <input
                      type="text"
                      value={sp1Subject}
                      onChange={(e) => setSp1Subject(e.target.value)}
                      placeholder="เว้นว่าง = ขออนุมัติจัดซื้อ/จัดจ้าง (หรือตามประเภทคำขอ)"
                      className="ledger-input py-1 text-xs"
                    />
                  </div>
                </div>
              </details>
            </div>
          </section>

          {/* Items Ledger Table */}
          <section className="ledger-panel overflow-hidden text-xs">
            <div className="ledger-panel-header flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-[#0F172A]">2. รายการวัสดุ / พัสดุ ({items.length} แถว)</h2>
              <span className="tabular-nums-th rounded border border-blue-200 bg-[#EFF6FF] px-2.5 py-1 font-bold text-[#1E3A8A]">
                รวมทั้งสิ้น {grandTotal.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
              </span>
            </div>
            {/* Mobile (< md) Adaptive Cards */}
            <div className="space-y-2.5 p-3 md:hidden">
              {items.map((it, idx) => {
                const lineTotal = (Number(it.qty) || 0) * (Number(it.unit_price) || 0);
                return (
                  <div key={idx} className="space-y-2 rounded-md border border-[#CBD5E1] bg-[#F8FAFC] p-3">
                    <div className="flex items-center justify-between">
                      <span className="tabular-nums-th rounded bg-[#0F172A] px-2 py-0.5 text-[11px] font-bold text-white">
                        รายการที่ {idx + 1}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="tabular-nums-th font-bold text-[#1E3A8A]">
                          {lineTotal.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿
                        </span>
                        <button
                          type="button"
                          onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                          className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-[#B91C1C]"
                          title="ลบแถว"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      placeholder="ชื่อรายการวัสดุ/พัสดุ"
                      value={it.name}
                      onChange={(e) => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))}
                      className="ledger-input py-1.5 text-xs"
                    />
                    <input
                      type="text"
                      placeholder="คุณลักษณะ / สเปก"
                      value={it.spec}
                      onChange={(e) => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, spec: e.target.value } : x)))}
                      className="ledger-input py-1.5 text-xs"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="mb-0.5 block text-[11px] font-semibold text-[#475569]">จำนวน</label>
                        <input
                          type="number"
                          min={0}
                          value={it.qty}
                          onChange={(e) => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, qty: Number(e.target.value) } : x)))}
                          className="ledger-input py-1 text-right text-xs"
                        />
                      </div>
                      <div>
                        <label className="mb-0.5 block text-[11px] font-semibold text-[#475569]">หน่วย</label>
                        <input
                          type="text"
                          placeholder="หน่วย"
                          value={it.unit}
                          onChange={(e) => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))}
                          className="ledger-input py-1 text-xs"
                        />
                      </div>
                      <div>
                        <label className="mb-0.5 block text-[11px] font-semibold text-[#475569]">ราคา/หน่วย</label>
                        <input
                          type="number"
                          min={0}
                          value={it.unit_price}
                          onChange={(e) => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, unit_price: Number(e.target.value) } : x)))}
                          className="ledger-input py-1 text-right text-xs"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop (>= md) Table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="ledger-table text-xs">
                <thead>
                  <tr>
                    <th className="w-8 text-center">#</th>
                    <th>รายการ</th>
                    <th>คุณลักษณะ / สเปก</th>
                    <th className="w-16 text-right">จำนวน</th>
                    <th className="w-16">หน่วย</th>
                    <th className="w-24 text-right">ราคา/หน่วย</th>
                    <th className="w-24 text-right">รวม (บาท)</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => {
                    const lineTotal = (Number(it.qty) || 0) * (Number(it.unit_price) || 0);
                    return (
                      <tr key={idx}>
                        <td className="text-center font-medium text-[#64748B]">{idx + 1}</td>
                        <td>
                          <input
                            type="text"
                            placeholder="ชื่อรายการ"
                            value={it.name}
                            onChange={(e) => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))}
                            className="ledger-input min-w-[110px] py-1 text-xs"
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            placeholder="สเปก"
                            value={it.spec}
                            onChange={(e) => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, spec: e.target.value } : x)))}
                            className="ledger-input min-w-[90px] py-1 text-xs"
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            value={it.qty}
                            onChange={(e) => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, qty: Number(e.target.value) } : x)))}
                            className="ledger-input py-1 text-right text-xs"
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            placeholder="หน่วย"
                            value={it.unit}
                            onChange={(e) => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))}
                            className="ledger-input py-1 text-xs"
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            value={it.unit_price}
                            onChange={(e) => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, unit_price: Number(e.target.value) } : x)))}
                            className="ledger-input py-1 text-right text-xs"
                          />
                        </td>
                        <td className="text-right font-semibold text-[#0F172A]">
                          {lineTotal.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="text-center">
                          <button
                            type="button"
                            onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                            className="text-slate-400 hover:text-[#B91C1C]"
                            title="ลบแถว"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2.5">
              <button
                type="button"
                onClick={() => setItems((prev) => [...prev, { name: "", spec: "", qty: 1, unit: "ชิ้น", unit_price: 0, note: "" }])}
                className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-3 py-1.5 font-semibold text-[#0F172A] hover:bg-slate-50"
              >
                <Plus className="h-3.5 w-3.5" />
                เพิ่มรายการวัสดุ
              </button>
            </div>
          </section>

          {/* Signers & Urgent PO & Workflow */}
          <section className="ledger-panel overflow-hidden text-xs">
            <div className="ledger-panel-header">
              <h2 className="text-sm font-bold text-[#0F172A]">3. ผู้เกี่ยวข้อง คณะกรรมการ และใบสั่งซื้อชั่วคราว</h2>
            </div>
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">ผู้รับผิดชอบโครงการ / ผู้ขอซื้อ</label>
                  <input type="text" value={requesterName} onChange={(e) => setRequesterName(e.target.value)} className="ledger-input py-1.5 text-xs" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">ตำแหน่งผู้รับผิดชอบ</label>
                  <input type="text" value={requesterTitle} onChange={(e) => setRequesterTitle(e.target.value)} className="ledger-input py-1.5 text-xs" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">หัวหน้าแผนกวิชา / หัวหน้างาน</label>
                  <input type="text" value={deptHeadName} onChange={(e) => setDeptHeadName(e.target.value)} className="ledger-input py-1.5 text-xs" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">รองผู้อำนวยการฝ่ายที่เกี่ยวข้อง</label>
                  <input type="text" value={deputyName} onChange={(e) => setDeputyName(e.target.value)} className="ledger-input py-1.5 text-xs" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">ตำแหน่งรองผู้อำนวยการ (บันทึกข้อความขออนุมัติ)</label>
                  <input type="text" value={deputyTitle} onChange={(e) => setDeputyTitle(e.target.value)} placeholder="เว้นว่าง = รองผู้อำนวยการ + ฝ่าย" className="ledger-input py-1.5 text-xs" />
                </div>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">วิธีจัดซื้อ/จัดจ้าง (สผ.1 ข้อ 5)</label>
                <select value={purchaseMethod} onChange={(e) => setPurchaseMethod(e.target.value)} className="ledger-input py-1.5 text-xs">
                  <option value="specific">วิธีเฉพาะเจาะจง ตามมาตรา 56 วรรคหนึ่ง (2) (ข)</option>
                  <option value="selection">วิธีคัดเลือก</option>
                  <option value="open_bidding">วิธีประกาศเชิญชวนทั่วไป</option>
                </select>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="font-semibold text-[#475569]">คณะกรรมการจัดซื้อ/จัดจ้าง (ข้อ 5.1 สูงสุด 3 ท่าน)</label>
                    <button
                      type="button"
                      onClick={() => setProcurementCommitteeText(committeeText)}
                      className="text-[11px] font-semibold text-[#1D4ED8] hover:underline"
                    >
                      คัดลอกจากตรวจรับ
                    </button>
                  </div>
                  <textarea rows={2} value={procurementCommitteeText} onChange={(e) => setProcurementCommitteeText(e.target.value)} placeholder="บรรทัด 1 ประธานฯ&#10;บรรทัด 2-3 กรรมการ" className="ledger-input py-1.5 text-xs" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">คณะกรรมการตรวจรับ / TOR (ข้อ 5.2 สูงสุด 3 ท่าน)</label>
                  <textarea rows={2} value={committeeText} onChange={(e) => setCommitteeText(e.target.value)} placeholder="บรรทัด 1 ประธานฯ&#10;บรรทัด 2-3 กรรมการ" className="ledger-input py-1.5 text-xs" />
                </div>
              </div>

              <details className="rounded-md border border-[#CBD5E1] bg-[#F8FAFC] p-2.5">
                <summary className="cursor-pointer font-semibold text-[#0F172A]">
                  ปรับรายชื่อผู้ลงนามกรอบความเห็น สผ.1 (ข้อ 3–6) เฉพาะใบงานนี้
                </summary>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[#475569]">ข้อ 3 หัวหน้างานพัฒนายุทธศาสตร์ฯ</label>
                    <input type="text" value={planHeadName} onChange={(e) => setPlanHeadName(e.target.value)} className="ledger-input py-1 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[#475569]">ข้อ 4 รองฯ ฝ่ายยุทธศาสตร์ฯ</label>
                    <input type="text" value={deputyPlanName} onChange={(e) => setDeputyPlanName(e.target.value)} className="ledger-input py-1 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[#475569]">ข้อ 5 หัวหน้างานพัสดุ</label>
                    <input type="text" value={suppliesHeadName} onChange={(e) => setSuppliesHeadName(e.target.value)} className="ledger-input py-1 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[#475569]">ข้อ 6 รองฯ ฝ่ายบริหารทรัพยากร</label>
                    <input type="text" value={deputyResourceName} onChange={(e) => setDeputyResourceName(e.target.value)} className="ledger-input py-1 text-xs" />
                  </div>
                </div>
              </details>

              <details className="rounded-md border border-[#CBD5E1] bg-[#F8FAFC] p-2.5">
                <summary className="cursor-pointer font-semibold text-[#0F172A]">
                  กำหนดรายชื่อผู้จัดทำร่าง TOR เฉพาะใบงานนี้ (เว้นว่าง = ใช้จากกรรมการตรวจรับ)
                </summary>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-[#475569]">ประธาน / ผู้จัดทำ TOR</label>
                    <input type="text" value={torChairName} onChange={(e) => setTorChairName(e.target.value)} className="ledger-input py-1 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[#475569]">กรรมการ TOR คนที่ 1</label>
                    <input type="text" value={torMember1} onChange={(e) => setTorMember1(e.target.value)} className="ledger-input py-1 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[#475569]">กรรมการ TOR คนที่ 2</label>
                    <input type="text" value={torMember2} onChange={(e) => setTorMember2(e.target.value)} className="ledger-input py-1 text-xs" />
                  </div>
                </div>
              </details>

              <div className="rounded-md border border-[#CBD5E1] bg-[#F8FAFC] p-3">
                <label className="flex cursor-pointer items-center gap-2 font-semibold text-[#0F172A]">
                  <input type="checkbox" checked={includeUrgentPo} onChange={(e) => setIncludeUrgentPo(e.target.checked)} className="accent-[#1D4ED8]" />
                  สร้างไฟล์ที่ 5: ใบสั่งซื้อชั่วคราว (เร่งด่วน) (.DOCX) รวมในชุดด้วย
                </label>
                {includeUrgentPo && (
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input type="text" value={urgentVendor} onChange={(e) => setUrgentVendor(e.target.value)} placeholder="ผู้จัดการร้านค้า/หจก./บริษัท" className="ledger-input py-1.5 text-xs" />
                    <input type="text" value={suppliesHeadName} onChange={(e) => setSuppliesHeadName(e.target.value)} placeholder="หัวหน้าเจ้าหน้าที่พัสดุ" className="ledger-input py-1.5 text-xs" />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2.5 border-t border-[#E2E8F0] pt-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold text-[#475569]">ผู้ตรวจ (รองฯ / พัสดุ)</label>
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

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleRenderBundle}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-50"
                >
                  <FileCheck2 className="h-4 w-4" />
                  {busy ? "กำลังสร้างชุดเอกสาร..." : "สร้างชุดเอกสารและพรีวิว"}
                </button>
                <button
                  type="button"
                  onClick={() => setMobilePreviewOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-[#EFF6FF] px-3.5 py-2 text-xs font-semibold text-[#1E3A8A] hover:bg-blue-100 xl:hidden"
                >
                  <Eye className="h-4 w-4" />
                  ดูตัวอย่าง สผ.
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
            </div>
          </section>
        </div>

        {/* Right: Multi-File Bundle Preview */}
        <ResponsivePreviewModal
          open={mobilePreviewOpen}
          onOpenChange={setMobilePreviewOpen}
          desktopColClass="xl:col-span-6"
          title="ตัวอย่างชุดเอกสาร สผ."
          triggerLabel="ดูตัวอย่าง สผ."
          loading={busy}
          pageCount={activeFile?.page_image_urls?.length || 0}
          hasPreview={Boolean(activeFile?.file_url || activeFile?.pdf_url)}
          topContent={
            <div className="ledger-panel overflow-hidden">
              <div className="ledger-panel-header flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-bold text-[#0F172A]">ไฟล์ในชุดเอกสาร สผ.</h2>
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
                  <p className="text-xs text-[#475569]">กรอกข้อมูลโครงการทางซ้ายแล้วกด &ldquo;สร้างชุดเอกสารและพรีวิว&rdquo; เพื่อสลับดูเอกสารแต่ละฉบับ</p>
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
            emptyMessage="ยังไม่มีตัวอย่างชุด สผ. กรอกข้อมูลแล้วกดสร้างชุดเอกสารด้านซ้าย"
          />
        </ResponsivePreviewModal>
      </div>
    </div>
  );
}
