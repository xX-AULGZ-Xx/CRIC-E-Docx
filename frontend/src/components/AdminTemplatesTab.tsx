"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { API_BASE, api, CustomTemplateRecord, SystemTemplateInfo, TemplateFieldSchema } from "@/lib/api";
import { confirmDanger, toastError, toastSuccess } from "@/lib/swal";

interface AdminTemplatesTabProps {
  onStatus: (msg: string, err?: string) => void;
}

const FIELD_TYPE_OPTIONS: Array<{ value: TemplateFieldSchema["field_type"]; label: string }> = [
  { value: "text", label: "ข้อความสั้น (Text)" },
  { value: "textarea", label: "ข้อความยาว (Textarea)" },
  { value: "date", label: "วันที่ไทย (Date)" },
  { value: "number", label: "ตัวเลข + คำอ่านบาท (Number)" },
  { value: "select", label: "ตัวเลือก (Dropdown)" },
  { value: "image", label: "รูปภาพแนบ ({{img:...}})" },
];

export function AdminTemplatesTab({ onStatus }: AdminTemplatesTabProps) {
  const [subTab, setSubTab] = useState<"custom" | "system">("custom");

  // Custom templates state
  const [customList, setCustomList] = useState<CustomTemplateRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [editTpl, setEditTpl] = useState<CustomTemplateRecord | null>(null);
  const [loadingCustom, setLoadingCustom] = useState(false);

  // New custom template upload state
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("ทั่วไป");
  const [newDesc, setNewDesc] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [savingSchema, setSavingSchema] = useState(false);

  // System templates state
  const [systemList, setSystemList] = useState<SystemTemplateInfo[]>([]);
  const [loadingSystem, setLoadingSystem] = useState(false);
  const [busySysKey, setBusySysKey] = useState<string>("");
  const [sysPreview, setSysPreview] = useState<{
    key: string;
    name: string;
    page_image_urls: string[];
    pdf_url: string;
    pdf_error?: string;
  } | null>(null);

  const loadAllTemplates = useCallback(async () => {
    setLoadingCustom(true);
    setLoadingSystem(true);
    try {
      const [cRes, sRes] = await Promise.all([api.listCustomTemplates(true), api.listSystemTemplates()]);
      setCustomList(cRes.templates);
      setSystemList(sRes.templates);
      if (selectedId) {
        const found = cRes.templates.find((t) => t.id === selectedId);
        if (found) setEditTpl(structuredClone(found));
      } else if (cRes.templates.length > 0 && !editTpl) {
        setSelectedId(cRes.templates[0].id);
        setEditTpl(structuredClone(cRes.templates[0]));
      }
    } catch (err) {
      onStatus("", err instanceof Error ? err.message : "โหลดข้อมูลแม่แบบไม่สำเร็จ");
    } finally {
      setLoadingCustom(false);
      setLoadingSystem(false);
    }
  }, [selectedId, editTpl, onStatus]);

  useEffect(() => {
    loadAllTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectCustom(tpl: CustomTemplateRecord) {
    setSelectedId(tpl.id);
    setEditTpl(structuredClone(tpl));
  }

  async function handleCreateCustom(e: React.FormEvent) {
    e.preventDefault();
    if (!newFile) {
      onStatus("", "กรุณาเลือกไฟล์ .docx หรือ .xlsx");
      return;
    }
    setCreating(true);
    onStatus("", "");
    try {
      const res = await api.createCustomTemplate(newFile, {
        name: newName.trim() || newFile.name.replace(/\.(docx|xlsx)$/i, ""),
        category: newCategory.trim() || "ทั่วไป",
        description: newDesc.trim(),
        is_active: true,
      });
      setNewName("");
      setNewDesc("");
      setNewFile(null);
      setSelectedId(res.template.id);
      setEditTpl(structuredClone(res.template));
      await loadAllTemplates();
      const msg = `สร้างแม่แบบ "${res.template.name}" สำเร็จ (ตรวจพบ ${res.detected_count} ตัวแปรอัตโนมัติ)`;
      onStatus(msg);
      toastSuccess("อัปโหลดแม่แบบสำเร็จ", msg);
    } catch (err) {
      const m = err instanceof Error ? err.message : "สร้างแม่แบบไม่สำเร็จ";
      onStatus("", m);
      toastError("สร้างแม่แบบไม่สำเร็จ", m);
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveCustom() {
    if (!editTpl) return;
    setSavingSchema(true);
    onStatus("", "");
    try {
      const res = await api.updateCustomTemplate(editTpl.id, {
        name: editTpl.name,
        category: editTpl.category,
        description: editTpl.description,
        is_active: editTpl.is_active,
        fields_schema: editTpl.fields_schema_json,
      });
      setEditTpl(structuredClone(res.template));
      await loadAllTemplates();
      const msg = `บันทึกการตั้งค่าและ Schema ของแม่แบบ "${res.template.name}" เรียบร้อยแล้ว`;
      onStatus(msg);
      toastSuccess("บันทึก Schema เรียบร้อย", msg);
    } catch (err) {
      const m = err instanceof Error ? err.message : "บันทึก Schema ไม่สำเร็จ";
      onStatus("", m);
      toastError("บันทึก Schema ไม่สำเร็จ", m);
    } finally {
      setSavingSchema(false);
    }
  }

  async function handleReplaceCustomFile(file: File) {
    if (!editTpl) return;
    onStatus("", "");
    try {
      const res = await api.replaceCustomTemplateFile(editTpl.id, file, true);
      setEditTpl(structuredClone(res.template));
      await loadAllTemplates();
      const msg = `อัปโหลดไฟล์ใหม่และสแกนตัวแปรใหม่สำเร็จ (${res.detected_count} ตัวแปร)`;
      onStatus(msg);
      toastSuccess("อัปเดตไฟล์แม่แบบสำเร็จ", msg);
    } catch (err) {
      const m = err instanceof Error ? err.message : "อัปโหลดไฟล์แม่แบบใหม่ไม่สำเร็จ";
      onStatus("", m);
      toastError("อัปโหลดไฟล์แม่แบบใหม่ไม่สำเร็จ", m);
    }
  }

  async function handleDeleteCustom(id: string, name: string) {
    const ok = await confirmDanger({
      title: `ลบแม่แบบ "${name}"?`,
      text: "ไฟล์แม่แบบและ Schema ทั้งหมดจะถูกลบออกจากระบบอย่างถาวร",
      confirmText: "ลบแม่แบบ",
    });
    if (!ok) return;
    onStatus("", "");
    try {
      await api.deleteCustomTemplate(id);
      if (selectedId === id) {
        setSelectedId("");
        setEditTpl(null);
      }
      await loadAllTemplates();
      const msg = `ลบแม่แบบ "${name}" เรียบร้อยแล้ว`;
      onStatus(msg);
      toastSuccess("ลบแม่แบบเรียบร้อย", msg);
    } catch (err) {
      const m = err instanceof Error ? err.message : "ลบแม่แบบไม่สำเร็จ";
      onStatus("", m);
      toastError("ลบแม่แบบไม่สำเร็จ", m);
    }
  }

  function updateField(idx: number, patch: Partial<TemplateFieldSchema>) {
    if (!editTpl) return;
    const next = [...editTpl.fields_schema_json];
    next[idx] = { ...next[idx], ...patch };
    setEditTpl({ ...editTpl, fields_schema_json: next });
  }

  async function handleSystemUpload(key: string, file: File) {
    setBusySysKey(key);
    onStatus("", "");
    try {
      const res = await api.uploadSystemTemplateOverride(key, file);
      await loadAllTemplates();
      const msg = `อัปโหลดไฟล์ปรับแต่งสำหรับ "${res.template?.name || key}" สำเร็จ`;
      onStatus(msg);
      toastSuccess("อัปโหลดแม่แบบระบบสำเร็จ", msg);
    } catch (err) {
      const m = err instanceof Error ? err.message : "ไฟล์ปรับแต่งไม่ผ่านการตรวจสอบโครงสร้าง";
      onStatus("", m);
      toastError("ไฟล์ไม่ผ่านการตรวจสอบโครงสร้าง", m);
    } finally {
      setBusySysKey("");
    }
  }

  async function handleSystemReset(key: string, name: string) {
    const ok = await confirmDanger({
      title: `รีเซ็ตแม่แบบ "${name}"?`,
      text: "ระบบจะลบไฟล์ปรับแต่งและกลับไปใช้ไฟล์มาตรฐานเริ่มต้นของวิทยาลัย",
      confirmText: "รีเซ็ตกลับค่าเดิม",
    });
    if (!ok) return;
    setBusySysKey(key);
    onStatus("", "");
    try {
      await api.resetSystemTemplateOverride(key);
      await loadAllTemplates();
      const msg = `รีเซ็ตแม่แบบ "${name}" กลับเป็นค่าเริ่มต้นเรียบร้อยแล้ว`;
      onStatus(msg);
      toastSuccess("รีเซ็ตกลับค่าเริ่มต้นแล้ว", msg);
    } catch (err) {
      const m = err instanceof Error ? err.message : "รีเซ็ตไม่สำเร็จ";
      onStatus("", m);
      toastError("รีเซ็ตไม่สำเร็จ", m);
    } finally {
      setBusySysKey("");
    }
  }

  async function handleSystemPreview(key: string) {
    setBusySysKey(key);
    onStatus("", "");
    try {
      const res = await api.previewSystemTemplate(key);
      setSysPreview({
        key: res.key,
        name: res.name,
        page_image_urls: res.page_image_urls,
        pdf_url: res.pdf_url,
        pdf_error: res.pdf_error,
      });
    } catch (err) {
      onStatus("", err instanceof Error ? err.message : "สร้างพรีวิวไม่สำเร็จ");
    } finally {
      setBusySysKey("");
    }
  }

  // Group system templates cleanly
  const groupedSystem = systemList.reduce<Record<string, SystemTemplateInfo[]>>((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="inline-flex flex-wrap gap-1 rounded-md border border-[#CBD5E1] bg-white p-1">
        <button
          type="button"
          onClick={() => setSubTab("custom")}
          className={`rounded px-3.5 py-1.5 text-xs font-bold transition-colors ${
            subTab === "custom" ? "bg-[#1D4ED8] text-white" : "text-[#475569] hover:bg-slate-50 hover:text-[#0F172A]"
          }`}
        >
          1. แม่แบบกำหนดเอง ({`{{ตัวแปร}}`}) ({customList.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab("system")}
          className={`rounded px-3.5 py-1.5 text-xs font-bold transition-colors ${
            subTab === "system" ? "bg-[#0F172A] text-white" : "text-[#475569] hover:bg-slate-50 hover:text-[#0F172A]"
          }`}
        >
          2. แม่แบบมาตรฐานระบบ (16 แบบฟอร์ม)
        </button>
      </div>

      {/* SECTION 1: CUSTOM TEMPLATES */}
      {subTab === "custom" && (
        <div className="space-y-4">
          {/* Upload / Create Custom Template */}
          <form onSubmit={handleCreateCustom} className="ledger-panel overflow-hidden">
            <div className="ledger-panel-header">
              <h2 className="text-sm font-bold text-[#0F172A]">เพิ่มแม่แบบเอกสารแบบกำหนดเอง (.docx / .xlsx)</h2>
              <p className="mt-0.5 text-xs text-[#475569]">
                ใส่ตัวแปร <code className="rounded border border-[#CBD5E1] bg-white px-1 py-0.5 font-mono text-[#1D4ED8]">{`{{ชื่อตัวแปร}}`}</code> ในไฟล์ Word หรือ Excel
                รองรับ <code className="font-mono">{`{{org_name}}`}</code>, <code className="font-mono">{`{{today_thai}}`}</code>,{" "}
                <code className="font-mono">{`{{amount_bahttext}}`}</code>, <code className="font-mono">{`{{img:ภาพประกอบ}}`}</code>, และ{" "}
                <code className="font-mono">{`{{items.รายการ}}`}</code>
              </p>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#475569]">ชื่อแม่แบบ *</label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="เช่น แบบฟอร์มขอใช้รถราชการ"
                    className="ledger-input py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#475569]">หมวดหมู่</label>
                  <input
                    type="text"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    placeholder="ทั่วไป / พัสดุ / วิชาการ"
                    className="ledger-input py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#475569]">คำอธิบายสั้นๆ</label>
                  <input
                    type="text"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="รายละเอียดการใช้งาน"
                    className="ledger-input py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#475569]">ไฟล์แม่แบบ (.docx / .xlsx) *</label>
                  <input
                    type="file"
                    accept=".docx,.xlsx"
                    onChange={(e) => setNewFile(e.target.files?.[0] || null)}
                    className="block w-full text-xs text-[#475569] file:mr-2 file:rounded file:border file:border-[#CBD5E1] file:bg-[#F8FAFC] file:px-2.5 file:py-1.5 file:font-semibold file:text-[#0F172A]"
                  />
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="submit"
                  disabled={creating}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-60"
                >
                  {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  อัปโหลดและสแกนตัวแปร
                </button>
              </div>
            </div>
          </form>

          {/* List + Schema Editor */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            {/* Left list */}
            <div className="ledger-panel overflow-hidden xl:col-span-4">
              <div className="ledger-panel-header flex items-center justify-between">
                <h3 className="text-xs font-bold text-[#0F172A]">คลังแม่แบบที่สร้างไว้</h3>
                <span className="tabular-nums-th text-xs text-[#475569]">{customList.length} รายการ</span>
              </div>
              {loadingCustom ? (
                <div className="p-6 text-center text-xs text-[#475569]">กำลังโหลด...</div>
              ) : customList.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#475569]">
                  ยังไม่มีแม่แบบกำหนดเอง อัปโหลดไฟล์ด้านบนเพื่อเริ่มต้น
                </div>
              ) : (
                <div className="divide-y divide-[#E2E8F0]">
                  {customList.map((tpl) => {
                    const active = tpl.id === editTpl?.id;
                    return (
                      <div
                        key={tpl.id}
                        onClick={() => selectCustom(tpl)}
                        className={`cursor-pointer border-l-[3px] p-3 transition-colors ${
                          active ? "border-[#1D4ED8] bg-[#EFF6FF]/60" : "border-transparent bg-white hover:bg-[#F8FAFC]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              {tpl.file_type === "xlsx" ? (
                                <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
                              ) : (
                                <FileText className="h-3.5 w-3.5 shrink-0 text-[#1D4ED8]" />
                              )}
                              <span className="truncate text-xs font-bold text-[#0F172A]">{tpl.name}</span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                              <span className="rounded border border-[#CBD5E1] bg-white px-1.5 py-0.5 text-[#475569]">{tpl.category}</span>
                              <span className="tabular-nums-th rounded bg-[#EFF6FF] px-1.5 py-0.5 text-[#1E3A8A]">
                                {tpl.fields_schema_json.length} ตัวแปร
                              </span>
                              <span
                                className={`rounded px-1.5 py-0.5 font-semibold ${
                                  tpl.is_active ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"
                                }`}
                              >
                                {tpl.is_active ? "เปิดใช้งาน" : "ปิดชั่วคราว"}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCustom(tpl.id, tpl.name);
                            }}
                            title="ลบแม่แบบ"
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-[#B91C1C]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Schema Editor */}
            <div className="ledger-panel overflow-hidden xl:col-span-8">
              {!editTpl ? (
                <div className="p-12 text-center text-xs text-[#475569]">เลือกแม่แบบทางซ้ายเพื่อตั้งค่าข้อมูลและชนิดของฟิลด์</div>
              ) : (
                <div>
                  <div className="ledger-panel-header flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-[#0F172A]">ตั้งค่าแม่แบบ: {editTpl.name}</h3>
                      <p className="font-mono text-[11px] text-[#475569]">
                        {editTpl.storage_filename} (.{editTpl.file_type.toUpperCase()})
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => api.downloadWithAuth(`/v1/templates/custom/${editTpl.id}/download`, `${editTpl.name}.${editTpl.file_type}`)}
                        className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0F172A] hover:bg-slate-50"
                      >
                        <Download className="h-3.5 w-3.5" /> โหลดไฟล์ต้นฉบับ
                      </button>
                      <button
                        type="button"
                        onClick={() => api.downloadWithAuth(`/v1/templates/custom/${editTpl.id}/batch-sample.xlsx`, `sample_${editTpl.name}.xlsx`)}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5" /> Excel ตัวอย่าง
                      </button>
                      <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-blue-200 bg-[#EFF6FF] px-2.5 py-1.5 text-xs font-semibold text-[#1E3A8A] hover:bg-blue-100">
                        <Upload className="h-3.5 w-3.5" /> อัปโหลดไฟล์ทับและสแกนใหม่
                        <input
                          type="file"
                          accept=".docx,.xlsx"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleReplaceCustomFile(f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="space-y-4 p-5">
                    {/* Metadata */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-[#475569]">ชื่อแม่แบบ</label>
                        <input
                          type="text"
                          value={editTpl.name}
                          onChange={(e) => setEditTpl({ ...editTpl, name: e.target.value })}
                          className="ledger-input py-1.5 text-xs"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-[#475569]">หมวดหมู่</label>
                        <input
                          type="text"
                          value={editTpl.category}
                          onChange={(e) => setEditTpl({ ...editTpl, category: e.target.value })}
                          className="ledger-input py-1.5 text-xs"
                        />
                      </div>
                      <div className="flex items-end pb-1">
                        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[#0F172A]">
                          <input
                            type="checkbox"
                            checked={editTpl.is_active}
                            onChange={(e) => setEditTpl({ ...editTpl, is_active: e.target.checked })}
                            className="accent-[#1D4ED8]"
                          />
                          เปิดให้ผู้ใช้เลือกในหน้า /templates
                        </label>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#475569]">คำอธิบาย</label>
                      <input
                        type="text"
                        value={editTpl.description}
                        onChange={(e) => setEditTpl({ ...editTpl, description: e.target.value })}
                        className="ledger-input py-1.5 text-xs"
                      />
                    </div>

                    {/* Fields schema table */}
                    <div>
                      <h4 className="mb-2 text-xs font-bold text-[#0F172A]">
                        ตัวแปรที่ตรวจพบ ({editTpl.fields_schema_json.length} ฟิลด์)
                      </h4>
                      {editTpl.fields_schema_json.length === 0 ? (
                        <div className="rounded-md border border-dashed border-[#CBD5E1] p-4 text-center text-xs text-[#475569]">
                          ไม่พบตัวแปร {`{{...}}`} ในไฟล์แม่แบบนี้ (อาจใช้เฉพาะตัวแปรอัตโนมัติเช่น {`{{org_name}}`})
                        </div>
                      ) : (
                        <>
                          {/* Mobile (< md) Adaptive Field Cards */}
                          <div className="space-y-2.5 md:hidden">
                            {editTpl.fields_schema_json.map((f, idx) => (
                              <div key={`${f.group}-${f.key}-${idx}`} className="space-y-2 rounded-md border border-[#CBD5E1] bg-[#F8FAFC] p-3 text-xs">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-mono text-[11px] font-bold text-[#1E3A8A]">
                                    {f.group === "items" ? `items.${f.key}` : f.key}
                                  </span>
                                  <span
                                    className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                                      f.group === "items" ? "bg-[#EFF6FF] text-[#1E3A8A]" : "bg-slate-200 text-[#475569]"
                                    }`}
                                  >
                                    {f.group === "items" ? "ตารางซ้ำ" : "หลัก"}
                                  </span>
                                </div>
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  <div>
                                    <label className="mb-0.5 block text-[11px] font-semibold text-[#475569]">ป้ายชื่อฟอร์ม</label>
                                    <input
                                      type="text"
                                      value={f.label}
                                      onChange={(e) => updateField(idx, { label: e.target.value })}
                                      className="ledger-input py-1 text-xs"
                                    />
                                  </div>
                                  <div>
                                    <label className="mb-0.5 block text-[11px] font-semibold text-[#475569]">ชนิดข้อมูล</label>
                                    <select
                                      value={f.field_type}
                                      onChange={(e) => updateField(idx, { field_type: e.target.value as TemplateFieldSchema["field_type"] })}
                                      className="ledger-input py-1 text-xs"
                                    >
                                      {FIELD_TYPE_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                          {opt.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                                <div>
                                  <label className="mb-0.5 block text-[11px] font-semibold text-[#475569]">
                                    {f.field_type === "select" ? "ตัวเลือก (คั่นด้วย ,)" : "ค่าเริ่มต้น"}
                                  </label>
                                  {f.field_type === "select" ? (
                                    <input
                                      type="text"
                                      value={(f.options || []).join(", ")}
                                      onChange={(e) =>
                                        updateField(idx, {
                                          options: e.target.value
                                            .split(",")
                                            .map((x) => x.trim())
                                            .filter(Boolean),
                                        })
                                      }
                                      placeholder="ตัวเลือก1, ตัวเลือก2"
                                      className="ledger-input py-1 text-xs"
                                    />
                                  ) : (
                                    <input
                                      type="text"
                                      value={f.default_value || ""}
                                      onChange={(e) => updateField(idx, { default_value: e.target.value })}
                                      placeholder="ค่าเริ่มต้น"
                                      className="ledger-input py-1 text-xs"
                                    />
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-4 pt-1 text-[11px] font-medium text-[#334155]">
                                  <label className="inline-flex items-center gap-1.5">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(f.thai_digits)}
                                      onChange={(e) => updateField(idx, { thai_digits: e.target.checked })}
                                      className="accent-[#1D4ED8]"
                                    />
                                    เลขไทย
                                  </label>
                                  <label className="inline-flex items-center gap-1.5">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(f.required)}
                                      onChange={(e) => updateField(idx, { required: e.target.checked })}
                                      className="accent-[#1D4ED8]"
                                    />
                                    บังคับกรอก
                                  </label>
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Desktop (>= md) Schema Table */}
                          <div className="hidden overflow-x-auto rounded-md border border-[#CBD5E1] md:block">
                            <table className="ledger-table text-xs">
                            <thead>
                              <tr>
                                <th>ตัวแปร</th>
                                <th>กลุ่ม</th>
                                <th>ป้ายชื่อฟอร์ม</th>
                                <th>ชนิดข้อมูล</th>
                                <th>ค่าเริ่มต้น / ตัวเลือก</th>
                                <th className="text-center">เลขไทย</th>
                                <th className="text-center">บังคับ</th>
                              </tr>
                            </thead>
                            <tbody>
                              {editTpl.fields_schema_json.map((f, idx) => (
                                <tr key={`${f.group}-${f.key}-${idx}`}>
                                  <td className="font-mono text-[11px] font-semibold text-[#1E3A8A]">
                                    {f.group === "items" ? `items.${f.key}` : f.key}
                                  </td>
                                  <td className="text-[11px]">
                                    <span
                                      className={`rounded px-1.5 py-0.5 font-semibold ${
                                        f.group === "items" ? "bg-[#EFF6FF] text-[#1E3A8A]" : "bg-slate-100 text-[#475569]"
                                      }`}
                                    >
                                      {f.group === "items" ? "ตารางซ้ำ" : "หลัก"}
                                    </span>
                                  </td>
                                  <td>
                                    <input
                                      type="text"
                                      value={f.label}
                                      onChange={(e) => updateField(idx, { label: e.target.value })}
                                      className="ledger-input w-32 py-1 text-xs"
                                    />
                                  </td>
                                  <td>
                                    <select
                                      value={f.field_type}
                                      onChange={(e) => updateField(idx, { field_type: e.target.value as TemplateFieldSchema["field_type"] })}
                                      className="ledger-input py-1 text-xs"
                                    >
                                      {FIELD_TYPE_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                          {opt.label}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                  <td>
                                    {f.field_type === "select" ? (
                                      <input
                                        type="text"
                                        value={(f.options || []).join(", ")}
                                        onChange={(e) =>
                                          updateField(idx, {
                                            options: e.target.value
                                              .split(",")
                                              .map((x) => x.trim())
                                              .filter(Boolean),
                                          })
                                        }
                                        placeholder="ตัวเลือก1, ตัวเลือก2"
                                        className="ledger-input w-36 py-1 text-xs"
                                      />
                                    ) : (
                                      <input
                                        type="text"
                                        value={f.default_value || ""}
                                        onChange={(e) => updateField(idx, { default_value: e.target.value })}
                                        placeholder="ค่าเริ่มต้น"
                                        className="ledger-input w-36 py-1 text-xs"
                                      />
                                    )}
                                  </td>
                                  <td className="text-center">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(f.thai_digits)}
                                      onChange={(e) => updateField(idx, { thai_digits: e.target.checked })}
                                      className="accent-[#1D4ED8]"
                                    />
                                  </td>
                                  <td className="text-center">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(f.required)}
                                      onChange={(e) => updateField(idx, { required: e.target.checked })}
                                      className="accent-[#1D4ED8]"
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        </>
                      )}
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={savingSchema}
                        onClick={handleSaveCustom}
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-60"
                      >
                        {savingSchema ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        บันทึก Schema แม่แบบ
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: 16 BUILT-IN SYSTEM TEMPLATES */}
      {subTab === "system" && (
        <div className="space-y-4">
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950">
            <strong>หมายเหตุ:</strong> สามารถดาวน์โหลดแม่แบบมาตรฐานทั้ง 16 แบบฟอร์มไปปรับแต่งแล้วอัปโหลดทับได้
            ไฟล์จะเก็บถาวรใน <code className="font-mono">/app/storage/system_template_overrides/</code>{" "}
            พร้อมตรวจสอบโครงสร้างก่อนบันทึก และสามารถกด <strong>รีเซ็ต</strong> กลับเป็นค่าเริ่มต้นได้ตลอดเวลา
          </div>

          {loadingSystem ? (
            <div className="py-10 text-center text-xs text-[#475569]">กำลังโหลดรายการแม่แบบระบบ...</div>
          ) : (
            Object.entries(groupedSystem).map(([groupTitle, items]) => (
              <section key={groupTitle} className="ledger-panel overflow-hidden">
                <div className="ledger-panel-header">
                  <h3 className="text-xs font-bold text-[#0F172A]">{groupTitle}</h3>
                </div>
                {/* Mobile (< md) Adaptive System Template Cards */}
                <div className="divide-y divide-[#E2E8F0] md:hidden">
                  {items.map((st) => {
                    const busy = busySysKey === st.key;
                    return (
                      <div key={st.key} className="space-y-2 p-3.5 text-xs">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <span className="font-bold text-[#0F172A]">{st.name}</span>
                          {st.is_overridden ? (
                            <span className="inline-flex items-center gap-1 rounded bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-bold text-[#1E3A8A]">
                              <CheckCircle2 className="h-3 w-3" /> ปรับแต่งแล้ว
                            </span>
                          ) : (
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-[#475569]">
                              ค่าเริ่มต้น
                            </span>
                          )}
                        </div>
                        <div className="tabular-nums-th break-all font-mono text-[11px] text-[#475569]">
                          {st.rel_path}{" "}
                          <span className="text-[#94A3B8]">({Math.round(st.file_size_bytes / 1024)} KB)</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => api.downloadWithAuth(`/v1/templates/system/${st.key}/download`, st.rel_path.split("/").pop() || `${st.key}.${st.file_type}`)}
                            className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#0F172A] hover:bg-slate-50"
                          >
                            <Download className="h-3 w-3" /> ดาวน์โหลด
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleSystemPreview(st.key)}
                            className="inline-flex items-center gap-1 rounded border border-blue-200 bg-[#EFF6FF] px-2.5 py-1.5 text-[11px] font-semibold text-[#1E3A8A] hover:bg-blue-100"
                          >
                            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />} พรีวิว
                          </button>
                          <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-[#CBD5E1] bg-[#F8FAFC] px-2.5 py-1.5 text-[11px] font-semibold text-[#0F172A] hover:bg-slate-100">
                            <Upload className="h-3 w-3" /> อัปโหลดทับ
                            <input
                              type="file"
                              accept={`.${st.file_type}`}
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleSystemUpload(st.key, f);
                                e.target.value = "";
                              }}
                            />
                          </label>
                          {st.is_overridden && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleSystemReset(st.key, st.name)}
                              className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-semibold text-[#B91C1C] hover:bg-red-100"
                            >
                              <RotateCcw className="h-3 w-3" /> รีเซ็ต
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop (>= md) System Templates Table */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="ledger-table text-xs">
                    <thead>
                      <tr>
                        <th>แบบฟอร์ม</th>
                        <th>ไฟล์แม่แบบ</th>
                        <th>สถานะ</th>
                        <th>จัดการ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((st) => {
                        const busy = busySysKey === st.key;
                        return (
                          <tr key={st.key}>
                            <td className="font-semibold text-[#0F172A]">{st.name}</td>
                            <td className="tabular-nums-th font-mono text-[11px] text-[#475569]">
                              {st.rel_path}{" "}
                              <span className="text-[#94A3B8]">({Math.round(st.file_size_bytes / 1024)} KB)</span>
                            </td>
                            <td>
                              {st.is_overridden ? (
                                <span className="inline-flex items-center gap-1 rounded bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-bold text-[#1E3A8A]">
                                  <CheckCircle2 className="h-3 w-3" /> ปรับแต่งแล้ว
                                </span>
                              ) : (
                                <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-[#475569]">
                                  ค่าเริ่มต้น
                                </span>
                              )}
                            </td>
                            <td>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => api.downloadWithAuth(`/v1/templates/system/${st.key}/download`, st.rel_path.split("/").pop() || `${st.key}.${st.file_type}`)}
                                  className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0F172A] hover:bg-slate-50"
                                >
                                  <Download className="h-3 w-3" /> ดาวน์โหลด
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleSystemPreview(st.key)}
                                  className="inline-flex items-center gap-1 rounded border border-blue-200 bg-[#EFF6FF] px-2.5 py-1 text-[11px] font-semibold text-[#1E3A8A] hover:bg-blue-100"
                                >
                                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />} พรีวิว
                                </button>
                                <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-[#CBD5E1] bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-semibold text-[#0F172A] hover:bg-slate-100">
                                  <Upload className="h-3 w-3" /> อัปโหลดทับ
                                  <input
                                    type="file"
                                    accept={`.${st.file_type}`}
                                    className="hidden"
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      if (f) handleSystemUpload(st.key, f);
                                      e.target.value = "";
                                    }}
                                  />
                                </label>
                                {st.is_overridden && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => handleSystemReset(st.key, st.name)}
                                    className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-[#B91C1C] hover:bg-red-100"
                                  >
                                    <RotateCcw className="h-3 w-3" /> รีเซ็ต
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))
          )}

          {/* System Preview Box */}
          {sysPreview && (
            <div className="ledger-panel overflow-hidden">
              <div className="ledger-panel-header flex items-center justify-between">
                <h4 className="text-sm font-bold text-[#0F172A]">ตัวอย่างแม่แบบระบบ: {sysPreview.name}</h4>
                <button
                  type="button"
                  onClick={() => setSysPreview(null)}
                  className="rounded border border-[#CBD5E1] bg-white px-3 py-1 text-xs font-semibold text-[#475569] hover:text-[#0F172A]"
                >
                  ปิดพรีวิว
                </button>
              </div>
              <div className="drafting-grid p-2.5 sm:p-5">
                {sysPreview.pdf_error && (
                  <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    ไม่สามารถแปลงพรีวิวในโหมดนี้: {sysPreview.pdf_error}
                  </div>
                )}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {sysPreview.page_image_urls.map((u, idx) => (
                    <img
                      key={u}
                      src={`${API_BASE}${u}?v=${Date.now()}`}
                      alt={`หน้า ${idx + 1}`}
                      className="w-full border border-[#94A3B8] bg-white shadow-[0_3px_12px_rgba(15,23,42,0.12)]"
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
