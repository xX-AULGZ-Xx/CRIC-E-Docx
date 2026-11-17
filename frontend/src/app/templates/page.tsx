"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  Eye,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Layers,
  Loader2,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { DocumentPreviewPanel } from "@/components/DocumentPreviewPanel";
import { ResponsivePreviewModal } from "@/components/ResponsivePreviewModal";
import {
  API_BASE,
  api,
  CustomTemplateRecord,
  RenderResult,
  TemplateFieldSchema,
  UserProfile,
} from "@/lib/api";
import { toastError, toastSuccess } from "@/lib/swal";

export default function TemplatesPortalPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<CustomTemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>("ทั้งหมด");
  const [selectedId, setSelectedId] = useState<string>("");
  const [mode, setMode] = useState<"single" | "batch">("single");

  // Single mode state
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [itemRows, setItemRows] = useState<Array<Record<string, unknown>>>([]);
  const [divisionCode, setDivisionCode] = useState("ฝบ.");
  const [docSubject, setDocSubject] = useState("");
  const [savedDocId, setSavedDocId] = useState<string>("");

  // Approval routing
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [reviewerEmail, setReviewerEmail] = useState("");
  const [approverEmail, setApproverEmail] = useState("director@cric.ac.th");

  // AI Autofill
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  // Preview state
  const [preview, setPreview] = useState<RenderResult | null>(null);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);

  // Batch mode state
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const [batchIncludePdf, setBatchIncludePdf] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<{
    count: number;
    zip_filename: string;
    zip_url: string;
  } | null>(null);

  // Feedback
  const [aiCopilotEnabled, setAiCopilotEnabled] = useState(true);
  const [msg, setMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");

  const initFormFromTemplate = useCallback((tpl: CustomTemplateRecord) => {
    const initial: Record<string, unknown> = {};
    const mainFields = tpl.fields_schema_json.filter((f) => f.group !== "items");
    const itemFields = tpl.fields_schema_json.filter((f) => f.group === "items");
    for (const f of mainFields) {
      if (f.default_value) {
        initial[f.key] = f.default_value;
      } else if (f.field_type === "date") {
        initial[f.key] = new Date().toISOString().slice(0, 10);
      } else if (f.field_type === "select" && f.options?.length) {
        initial[f.key] = f.options[0];
      } else {
        initial[f.key] = "";
      }
    }
    setFormData(initial);
    if (itemFields.length > 0) {
      const blankRow: Record<string, unknown> = {};
      for (const f of itemFields) blankRow[f.key] = f.default_value || "";
      setItemRows([blankRow]);
    } else {
      setItemRows([]);
    }
    setDocSubject("");
    setSavedDocId("");
    setPreview(null);
    setBatchResult(null);
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const [tplRes, meRes, usersRes, pubRes] = await Promise.all([
        api.listCustomTemplates(false),
        api.me().catch(() => null),
        api.listUsers().catch(() => ({ users: [] })),
        api.getPublicSettings().catch(() => null),
      ]);
      setTemplates(tplRes.templates);
      if (pubRes && typeof pubRes.ai_copilot_enabled === "boolean") {
        setAiCopilotEnabled(pubRes.ai_copilot_enabled);
      }
      if (meRes?.user?.division_code) setDivisionCode(meRes.user.division_code);
      if (meRes?.user?.default_reviewer_email) setReviewerEmail(meRes.user.default_reviewer_email);
      if (usersRes?.users?.length) {
        setUsers(usersRes.users);
        const dir = usersRes.users.find((u) => u.role === "director");
        if (dir?.email) setApproverEmail(dir.email);
      }
      if (tplRes.templates.length > 0) {
        const current = tplRes.templates.find((t) => t.id === selectedId) || tplRes.templates[0];
        setSelectedId(current.id);
        initFormFromTemplate(current);
      } else {
        setSelectedId("");
      }
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : "โหลดคลังแม่แบบไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [selectedId, initFormFromTemplate]);

  useEffect(() => {
    loadInitial();
    const handler = () => loadInitial();
    window.addEventListener("cric-user-changed", handler);
    window.addEventListener("cric-profile-updated", handler);
    return () => {
      window.removeEventListener("cric-user-changed", handler);
      window.removeEventListener("cric-profile-updated", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(templates.map((t) => t.category || "ทั่วไป")));
    return ["ทั้งหมด", ...cats];
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    if (selectedCategory === "ทั้งหมด") return templates;
    return templates.filter((t) => (t.category || "ทั่วไป") === selectedCategory);
  }, [templates, selectedCategory]);

  const activeTemplate = useMemo(
    () => templates.find((t) => t.id === selectedId) || null,
    [templates, selectedId],
  );

  const mainFields: TemplateFieldSchema[] = useMemo(
    () => (activeTemplate?.fields_schema_json || []).filter((f) => f.group !== "items"),
    [activeTemplate],
  );
  const itemFields: TemplateFieldSchema[] = useMemo(
    () => (activeTemplate?.fields_schema_json || []).filter((f) => f.group === "items"),
    [activeTemplate],
  );

  function handleSelectTemplate(tpl: CustomTemplateRecord) {
    setSelectedId(tpl.id);
    initFormFromTemplate(tpl);
    setMsg("");
    setErrMsg("");
  }

  function buildPayloadData(): Record<string, unknown> {
    return {
      ...formData,
      items: itemRows,
    };
  }

  async function handleAiFill() {
    if (!activeTemplate || !aiPrompt.trim()) return;
    setAiBusy(true);
    setErrMsg("");
    setMsg("");
    try {
      const res = await api.aiFillTemplate({
        template_id: activeTemplate.id,
        template_name: activeTemplate.name,
        fields_schema: activeTemplate.fields_schema_json,
        prompt: aiPrompt.trim(),
      });
      setFormData((prev) => ({ ...prev, ...(res.fields || {}) }));
      if (Array.isArray(res.items) && res.items.length > 0) {
        setItemRows(res.items);
      }
      const m = `AI ช่วยกรอกข้อมูลสำเร็จ (${res.mode})`;
      setMsg(m);
      toastSuccess("AI เติมข้อมูลสำเร็จ", res.mode);
    } catch (err) {
      const m = err instanceof Error ? err.message : "AI ช่วยกรอกไม่สำเร็จ";
      setErrMsg(m);
      toastError("AI ช่วยกรอกไม่สำเร็จ", m);
    } finally {
      setAiBusy(false);
    }
  }

  async function handleImageUpload(key: string, file: File) {
    if (!activeTemplate) return;
    setErrMsg("");
    try {
      const res = await api.uploadCustomTemplateImage(activeTemplate.id, file);
      setFormData((prev) => ({ ...prev, [key]: res.filename }));
      const m = `อัปโหลดรูปภาพ "${res.original_name}" สำเร็จ`;
      setMsg(m);
      toastSuccess("แนบรูปภาพสำเร็จ", res.original_name);
    } catch (err) {
      const m = err instanceof Error ? err.message : "อัปโหลดรูปภาพไม่สำเร็จ";
      setErrMsg(m);
      toastError("อัปโหลดรูปภาพไม่สำเร็จ", m);
    }
  }

  async function handleRenderPreview() {
    if (!activeTemplate) return;
    setRendering(true);
    setErrMsg("");
    try {
      const res = await api.renderCustomTemplate(
        activeTemplate.id,
        buildPayloadData(),
        true,
        activeTemplate.id.slice(0, 10),
      );
      setPreview(res);
      setPreviewVersion((v) => v + 1);
      toastSuccess("สร้างตัวอย่างเอกสารแล้ว");
    } catch (err) {
      const m = err instanceof Error ? err.message : "สร้างตัวอย่างเอกสารไม่สำเร็จ";
      setErrMsg(m);
      toastError("สร้างตัวอย่างไม่สำเร็จ", m);
    } finally {
      setRendering(false);
    }
  }

  async function handleSaveOrSubmit(submitAfterSave: boolean) {
    if (!activeTemplate) return;
    setSaving(true);
    setErrMsg("");
    setMsg("");
    try {
      const saveRes = await api.saveCustomTemplateDoc(activeTemplate.id, {
        id: savedDocId || undefined,
        division_code: divisionCode,
        subject: docSubject.trim() || undefined,
        data: buildPayloadData(),
      });
      setSavedDocId(saveRes.document.id);
      setPreview(saveRes.render);
      setPreviewVersion((v) => v + 1);

      if (submitAfterSave) {
        await api.submitDocument(saveRes.document.id, reviewerEmail || null, approverEmail);
        setMsg("บันทึกและส่งเอกสารเข้าสู่ขั้นตอนตรวจร่างและลงนามเรียบร้อยแล้ว");
        toastSuccess("ส่งตรวจและลงนามเรียบร้อย", saveRes.document.subject);
        setTimeout(() => router.push("/approvals"), 900);
      } else {
        const m = `บันทึกร่าง "${saveRes.document.subject}" สำเร็จ`;
        setMsg(m);
        toastSuccess("บันทึกร่างเรียบร้อย", saveRes.document.subject);
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : "บันทึกเอกสารไม่สำเร็จ";
      setErrMsg(m);
      toastError("บันทึกเอกสารไม่สำเร็จ", m);
    } finally {
      setSaving(false);
    }
  }

  async function handleBatchGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!activeTemplate || !batchFile) return;
    setBatchBusy(true);
    setErrMsg("");
    setMsg("");
    try {
      const res = await api.batchCustomTemplate(activeTemplate.id, batchFile, batchIncludePdf);
      setBatchResult(res);
      const m = `สร้างชุดเอกสารสำเร็จทั้งหมด ${res.count} ฉบับ`;
      setMsg(m);
      toastSuccess("สร้างไฟล์ชุด .ZIP สำเร็จ", `${res.count} ฉบับ`);
    } catch (err) {
      const m = err instanceof Error ? err.message : "สร้างเอกสารชุด Batch ไม่สำเร็จ";
      setErrMsg(m);
      toastError("สร้างเอกสารชุด Batch ไม่สำเร็จ", m);
    } finally {
      setBatchBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {msg && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-900">{msg}</div>}
      {errMsg && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-[#991B1B]">{errMsg}</div>}

      {loading ? (
        <div className="ledger-panel p-12 text-center text-sm text-[#475569]">
          กำลังโหลดคลังแม่แบบเอกสาร...
        </div>
      ) : templates.length === 0 ? (
        <div className="ledger-panel border-dashed p-12 text-center">
          <Layers className="mx-auto mb-3 h-10 w-10 text-[#94A3B8]" />
          <h2 className="text-base font-bold text-[#0F172A]">ยังไม่มีแม่แบบเอกสารที่เปิดใช้งาน</h2>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-[#475569]">
            ผู้ดูแลระบบ (งานสารบรรณกลาง หรือ ผู้อำนวยการ) สามารถอัปโหลดไฟล์แม่แบบ .docx / .xlsx ที่มีตัวแปร{" "}
            <code className="rounded border border-[#CBD5E1] bg-[#F8FAFC] px-1 py-0.5 font-mono">{`{{ตัวแปร}}`}</code> ได้ที่หน้า ตั้งค่าระบบ แท็บ &ldquo;แม่แบบเอกสาร&rdquo;
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          {/* LEFT WORKSPACE */}
          <div className="space-y-4 xl:col-span-7">
            {/* Template selector bar */}
            <section className="ledger-panel overflow-hidden">
              <div className="ledger-panel-header flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#0F172A]">เลือกแม่แบบเอกสาร ({filteredTemplates.length})</span>
                <div className="flex flex-wrap gap-1">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        selectedCategory === cat ? "bg-[#1D4ED8] text-white" : "border border-[#CBD5E1] bg-white text-[#475569] hover:bg-slate-50"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2">
                {filteredTemplates.map((tpl) => {
                  const active = tpl.id === activeTemplate?.id;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => handleSelectTemplate(tpl)}
                      className={`flex items-start gap-2.5 rounded-md border p-3 text-left transition-colors ${
                        active ? "border-[#1D4ED8] bg-[#EFF6FF] ring-1 ring-[#1D4ED8]" : "border-[#CBD5E1] bg-white hover:bg-[#F8FAFC]"
                      }`}
                    >
                      {tpl.file_type === "xlsx" ? (
                        <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                      ) : (
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[#1D4ED8]" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-[#0F172A]">{tpl.name}</div>
                        <div className="tabular-nums-th mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-[#475569]">
                          <span>{tpl.category}</span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.2">{tpl.fields_schema_json.length} ตัวแปร</span>
                          <span className="font-mono">.{tpl.file_type.toUpperCase()}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Active Template Form / Batch */}
            {activeTemplate && (
              <section className="ledger-panel overflow-hidden">
                <div className="ledger-panel-header flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-bold text-[#0F172A]">{activeTemplate.name}</h2>
                    {activeTemplate.description && <p className="text-xs text-[#475569]">{activeTemplate.description}</p>}
                  </div>
                  <div className="flex rounded-md border border-[#CBD5E1] bg-white p-0.5 text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setMode("single")}
                      className={`rounded px-3 py-1 transition-colors ${
                        mode === "single" ? "bg-[#0F172A] text-white" : "text-[#475569] hover:text-[#0F172A]"
                      }`}
                    >
                      กรอกสร้าง 1 ฉบับ
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("batch")}
                      className={`rounded px-3 py-1 transition-colors ${
                        mode === "batch" ? "bg-emerald-700 text-white" : "text-[#475569] hover:text-[#0F172A]"
                      }`}
                    >
                      Batch หลายฉบับ (.ZIP)
                    </button>
                  </div>
                </div>

                <div className="p-5">
                  {mode === "single" ? (
                    <div className="space-y-4">
                      {/* AI Autofill */}
                      {aiCopilotEnabled && (
                        <div className="rounded-md border border-blue-200 bg-[#EFF6FF]/70 p-3">
                        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-[#1E3A8A]">
                          <Sparkles className="h-3.5 w-3.5 text-[#1D4ED8]" /> AI ช่วยกรอกค่าลงแบบฟอร์มอัตโนมัติ
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            type="text"
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            placeholder="พิมพ์สรุปโจทย์ เช่น ขออนุมัติใช้รถตู้ไปราชการจังหวัดเชียงใหม่ 18 พ.ย. 69..."
                            className="ledger-input flex-1 py-1.5 text-xs"
                          />
                          <button
                            type="button"
                            disabled={aiBusy || !aiPrompt.trim()}
                            onClick={handleAiFill}
                            className="inline-flex shrink-0 items-center justify-center gap-1 rounded-md bg-[#1D4ED8] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-50"
                          >
                            {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                            ให้ AI เติมข้อมูล
                          </button>
                        </div>
                        </div>
                      )}

                      {/* Dynamic Main Fields */}
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {mainFields.map((f) => {
                          const val = formData[f.key] ?? "";
                          const fullSpan = f.field_type === "textarea" || f.field_type === "image";
                          return (
                            <div key={f.key} className={fullSpan ? "sm:col-span-2" : ""}>
                              <label className="mb-1 block text-xs font-semibold text-[#475569]">
                                {f.label || f.key} {f.required && <span className="text-[#B91C1C]">*</span>}
                                <span className="ml-1 font-mono text-[10px] font-normal text-[#64748B]">{`{{${f.key}}}`}</span>
                              </label>
                              {f.field_type === "textarea" ? (
                                <textarea
                                  rows={3}
                                  value={String(val)}
                                  onChange={(e) => setFormData((prev) => ({ ...prev, [f.key]: e.target.value }))}
                                  className="ledger-input prose-saraban text-xs"
                                />
                              ) : f.field_type === "date" ? (
                                <input
                                  type="date"
                                  value={String(val)}
                                  onChange={(e) => setFormData((prev) => ({ ...prev, [f.key]: e.target.value }))}
                                  className="ledger-input tabular-nums-th text-xs"
                                />
                              ) : f.field_type === "number" ? (
                                <input
                                  type="number"
                                  step="any"
                                  value={String(val)}
                                  onChange={(e) => setFormData((prev) => ({ ...prev, [f.key]: e.target.value }))}
                                  className="ledger-input tabular-nums-th text-xs"
                                />
                              ) : f.field_type === "select" ? (
                                <select
                                  value={String(val)}
                                  onChange={(e) => setFormData((prev) => ({ ...prev, [f.key]: e.target.value }))}
                                  className="ledger-input text-xs"
                                >
                                  {(f.options || []).map((opt) => (
                                    <option key={opt} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                </select>
                              ) : f.field_type === "image" ? (
                                <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-3 py-2">
                                  <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2.5 py-1 text-xs font-semibold text-[#0F172A] hover:bg-slate-50">
                                    <Upload className="h-3.5 w-3.5 text-[#1D4ED8]" /> เลือกรูปภาพ
                                    <input
                                      type="file"
                                      accept=".png,.jpg,.jpeg,.webp"
                                      className="hidden"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleImageUpload(f.key, file);
                                        e.target.value = "";
                                      }}
                                    />
                                  </label>
                                  <span className="text-[11px] text-[#475569]">
                                    {val ? `แนบแล้ว: ${String(val)}` : "ยังไม่ได้แนบรูปภาพ"}
                                  </span>
                                </div>
                              ) : (
                                <input
                                  type="text"
                                  value={String(val)}
                                  onChange={(e) => setFormData((prev) => ({ ...prev, [f.key]: e.target.value }))}
                                  className="ledger-input text-xs"
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Repeating Items Table */}
                      {itemFields.length > 0 && (
                        <div className="overflow-hidden rounded-md border border-[#CBD5E1]">
                          <div className="flex items-center justify-between border-b border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2">
                            <span className="text-xs font-bold text-[#0F172A]">รายการตารางวนซ้ำ ({itemRows.length} แถว)</span>
                            <button
                              type="button"
                              onClick={() => {
                                const blank: Record<string, unknown> = {};
                                for (const f of itemFields) blank[f.key] = f.default_value || "";
                                setItemRows((prev) => [...prev, blank]);
                              }}
                              className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2.5 py-1 text-xs font-semibold text-[#0F172A] hover:bg-slate-50"
                            >
                              <Plus className="h-3 w-3" /> เพิ่มแถว
                            </button>
                          </div>
                          {/* Mobile (< md) Adaptive Cards */}
                          <div className="space-y-2.5 p-3 md:hidden">
                            {itemRows.map((row, rIdx) => (
                              <div key={rIdx} className="space-y-2 rounded-md border border-[#CBD5E1] bg-[#F8FAFC] p-3">
                                <div className="flex items-center justify-between">
                                  <span className="tabular-nums-th rounded bg-[#0F172A] px-2 py-0.5 text-[11px] font-bold text-white">
                                    แถวที่ {rIdx + 1}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setItemRows((prev) => prev.filter((_, idx) => idx !== rIdx))}
                                    className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-[#B91C1C]"
                                    aria-label={`ลบแถวที่ ${rIdx + 1}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  {itemFields.map((col) => (
                                    <div key={col.key}>
                                      <label className="mb-0.5 block text-[11px] font-semibold text-[#475569]">
                                        {col.label || col.key}
                                      </label>
                                      <input
                                        type={col.field_type === "number" ? "number" : col.field_type === "date" ? "date" : "text"}
                                        value={String(row[col.key] ?? "")}
                                        onChange={(e) => {
                                          const next = [...itemRows];
                                          next[rIdx] = { ...next[rIdx], [col.key]: e.target.value };
                                          setItemRows(next);
                                        }}
                                        className="ledger-input py-1 text-xs"
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Desktop (>= md) Table */}
                          <div className="hidden overflow-x-auto md:block">
                            <table className="ledger-table text-xs">
                              <thead>
                                <tr>
                                  <th className="w-8">#</th>
                                  {itemFields.map((col) => (
                                    <th key={col.key}>{col.label || col.key}</th>
                                  ))}
                                  <th className="w-8" />
                                </tr>
                              </thead>
                              <tbody>
                                {itemRows.map((row, rIdx) => (
                                  <tr key={rIdx}>
                                    <td className="text-[#64748B]">{rIdx + 1}</td>
                                    {itemFields.map((col) => (
                                      <td key={col.key}>
                                        <input
                                          type={col.field_type === "number" ? "number" : col.field_type === "date" ? "date" : "text"}
                                          value={String(row[col.key] ?? "")}
                                          onChange={(e) => {
                                            const next = [...itemRows];
                                            next[rIdx] = { ...next[rIdx], [col.key]: e.target.value };
                                            setItemRows(next);
                                          }}
                                          className="ledger-input min-w-[90px] py-1 text-xs"
                                        />
                                      </td>
                                    ))}
                                    <td>
                                      <button
                                        type="button"
                                        onClick={() => setItemRows((prev) => prev.filter((_, idx) => idx !== rIdx))}
                                        className="text-slate-400 hover:text-[#B91C1C]"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Workflow Metadata & Actions */}
                      <div className="grid grid-cols-1 gap-3 border-t border-[#E2E8F0] pt-3 sm:grid-cols-3">
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-[#475569]">ชื่อเรื่องสำหรับทะเบียนคุม</label>
                          <input
                            type="text"
                            value={docSubject}
                            onChange={(e) => setDocSubject(e.target.value)}
                            placeholder={activeTemplate.name}
                            className="ledger-input py-1.5 text-xs"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-[#475569]">ผู้ตรวจร่าง (ถ้ามี)</label>
                          <select
                            value={reviewerEmail}
                            onChange={(e) => setReviewerEmail(e.target.value)}
                            className="ledger-input py-1.5 text-xs"
                          >
                            <option value="">-- ส่งตรงผู้อนุมัติ --</option>
                            {users
                              .filter((u) => Boolean(u.email))
                              .map((u) => (
                                <option key={u.id} value={u.email || ""}>
                                  {u.full_name} ({u.role})
                                </option>
                              ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold text-[#475569]">ผู้อนุมัติ</label>
                          <select
                            value={approverEmail}
                            onChange={(e) => setApproverEmail(e.target.value)}
                            className="ledger-input py-1.5 text-xs"
                          >
                            {users
                              .filter((u) => Boolean(u.email))
                              .map((u) => (
                                <option key={u.id} value={u.email || ""}>
                                  {u.full_name} ({u.role})
                                </option>
                              ))}
                          </select>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          disabled={rendering}
                          onClick={handleRenderPreview}
                          className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-60"
                        >
                          {rendering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                          สร้างตัวอย่าง
                        </button>
                        <button
                          type="button"
                          onClick={() => setMobilePreviewOpen(true)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-[#EFF6FF] px-3 py-2 text-xs font-semibold text-[#1E3A8A] hover:bg-blue-100 xl:hidden"
                        >
                          <Eye className="h-3.5 w-3.5" /> ดูตัวอย่าง A4
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => handleSaveOrSubmit(false)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs font-semibold text-[#0F172A] hover:bg-slate-50"
                        >
                          <Save className="h-3.5 w-3.5" /> บันทึกร่าง
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => handleSaveOrSubmit(true)}
                          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                        >
                          <Send className="h-3.5 w-3.5" /> ส่งตรวจและลงนาม
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* BATCH MODE */
                    <form onSubmit={handleBatchGenerate} className="space-y-4">
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-950">
                        <p className="font-bold">ขั้นตอนการสร้างเอกสารชุดจำนวนมาก (Batch Mail-Merge สูงสุด 100 แถว/ครั้ง):</p>
                        <ol className="mt-1.5 list-inside list-decimal space-y-1">
                          <li>ดาวน์โหลดไฟล์ Excel ต้นแบบที่มีหัวคอลัมน์ตรงกับตัวแปรของแม่แบบนี้</li>
                          <li>กรอกข้อมูล 1 แถวต่อ 1 ฉบับ (รองรับทั้ง .xlsx และ .csv UTF-8)</li>
                          <li>อัปโหลดไฟล์แล้วกดสร้าง เพื่อดาวน์โหลดไฟล์เอกสารทั้งหมดในรูปแบบ .ZIP</li>
                        </ol>
                        <button
                          type="button"
                          onClick={() =>
                            api.downloadWithAuth(
                              `/v1/templates/custom/${activeTemplate.id}/batch-sample.xlsx`,
                              `sample_${activeTemplate.name}.xlsx`,
                            )
                          }
                          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-emerald-400 bg-white px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-50"
                        >
                          <Download className="h-3.5 w-3.5" /> ดาวน์โหลดไฟล์ Excel ตัวอย่าง
                        </button>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-semibold text-[#475569]">อัปโหลดไฟล์ข้อมูล (.xlsx หรือ .csv)</label>
                        <input
                          type="file"
                          accept=".xlsx,.csv"
                          onChange={(e) => setBatchFile(e.target.files?.[0] || null)}
                          className="block w-full rounded-md border border-[#CBD5E1] bg-white p-2 text-xs file:mr-3 file:rounded file:border-0 file:bg-emerald-50 file:px-3 file:py-1.5 file:font-semibold file:text-emerald-800"
                        />
                      </div>

                      <label className="flex items-center gap-2 text-xs font-semibold text-[#0F172A]">
                        <input
                          type="checkbox"
                          checked={batchIncludePdf}
                          onChange={(e) => setBatchIncludePdf(e.target.checked)}
                          className="accent-[#1D4ED8]"
                        />
                        แปลงเป็นไฟล์ .PDF แนบมาด้วยในไฟล์ .ZIP (ใช้เวลาประมวลผลเพิ่มเล็กน้อย)
                      </label>

                      <button
                        type="submit"
                        disabled={batchBusy || !batchFile}
                        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                      >
                        {batchBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileArchive className="h-3.5 w-3.5" />}
                        สร้างไฟล์ชุด .ZIP
                      </button>

                      {batchResult && (
                        <div className="rounded-md border border-blue-200 bg-[#EFF6FF] p-4">
                          <div className="tabular-nums-th text-xs font-bold text-[#1E3A8A]">
                            สร้างเอกสารเสร็จสมบูรณ์ ({batchResult.count} ฉบับ)
                          </div>
                          <a
                            href={`${API_BASE}${batchResult.zip_url}`}
                            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E293B]"
                          >
                            <Download className="h-3.5 w-3.5" /> ดาวน์โหลด {batchResult.zip_filename}
                          </a>
                        </div>
                      )}
                    </form>
                  )}
                </div>
              </section>
            )}
          </div>

          {/* RIGHT PREVIEW PANEL */}
          <ResponsivePreviewModal
            open={mobilePreviewOpen}
            onOpenChange={setMobilePreviewOpen}
            desktopColClass="xl:col-span-5"
            title="ตัวอย่างเอกสารจากแม่แบบ (A4)"
            triggerLabel="ดูตัวอย่าง A4"
            loading={rendering}
            pageCount={preview?.page_image_urls?.length || 0}
            hasPreview={Boolean(preview?.docx_url || preview?.pdf_url)}
          >
            <DocumentPreviewPanel
              fontFamily={preview?.font_family || "TH SarabunPSK"}
              docxUrl={preview?.docx_url}
              pdfUrl={preview?.pdf_url}
              pageImageUrls={preview?.page_image_urls || []}
              pdfError={preview?.pdf_error}
              loading={rendering}
              versionKey={previewVersion}
              emptyMessage="กรอกข้อมูลแล้วกด 'สร้างตัวอย่าง' เพื่อดูหน้ากระดาษเอกสารจริง"
            />
          </ResponsivePreviewModal>
        </div>
      )}
    </div>
  );
}
