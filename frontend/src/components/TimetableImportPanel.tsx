"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  Globe,
  ImagePlus,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { api, CourseRecord, TimetableMetadata, TimetableParsedItem } from "@/lib/api";
import { toastError, toastInfo, toastSuccess } from "@/lib/swal";

type ImportMode = "file_text" | "scan_pdf" | "sornor02_web";

interface TimetableImportPanelProps {
  coursesCount: number;
  defaultSemester: string;
  onImportSuccess: (
    importedItems: TimetableParsedItem[],
    savedCourses: CourseRecord[],
    allCourses: CourseRecord[],
    skippedCount: number,
    metadata?: TimetableMetadata
  ) => void;
}

export function TimetableImportPanel({
  coursesCount,
  defaultSemester,
  onImportSuccess,
}: TimetableImportPanelProps) {
  const [open, setOpen] = useState(false);
  const [userToggled, setUserToggled] = useState(false);
  const [mode, setMode] = useState<ImportMode>("file_text");

  // Mode 1: File / Text
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState("");

  // Mode 2: PDF / Image
  const [scanFile, setScanFile] = useState<File | null>(null);

  // Mode 3: Direct ศธ.02 Web
  const [sornorUrl, setSornorUrl] = useState("https://std2018.vec.go.th");
  const [authMode, setAuthMode] = useState<"none" | "cookie" | "credentials">("none");
  const [sornorUser, setSornorUser] = useState("");
  const [sornorPass, setSornorPass] = useState("");
  const [sornorCookie, setSornorCookie] = useState("");

  // Preview state
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewItems, setPreviewItems] = useState<TimetableParsedItem[]>([]);
  const [parsedMeta, setParsedMeta] = useState<TimetableMetadata | null>(null);
  const [applyMetadata, setApplyMetadata] = useState(true);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    if (!userToggled) {
      setOpen(coursesCount === 0);
    }
  }, [coursesCount, userToggled]);

  async function handleParseFileOrText() {
    if (!selectedFile && !rawText.trim()) {
      toastInfo("กรุณาเลือกไฟล์ (.xlsx, .csv, .html) หรือวางข้อความตารางสอนก่อน");
      return;
    }
    setParsing(true);
    setWarnings([]);
    try {
      const fd = new FormData();
      if (selectedFile) fd.append("file", selectedFile);
      if (rawText.trim()) fd.append("raw_text", rawText.trim());
      fd.append("default_semester", defaultSemester || "2/2569");
      const res = await api.parseTimetable(fd);
      setPreviewItems(res.items.map((it) => ({ ...it, selected: it.selected !== false })));
      setParsedMeta(res.metadata && Object.keys(res.metadata).length > 0 ? res.metadata : null);
      setWarnings(res.warnings || []);
      if (res.items.length > 0) {
        toastSuccess(`วิเคราะห์ตารางสำเร็จ พบ ${res.items.length} รายวิชา`);
      } else {
        toastInfo("ไม่พบรายวิชาอัตโนมัติ สามารถกด '+ เพิ่มแถวเอง' เพื่อกรอกในตารางได้");
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : "ไม่สามารถวิเคราะห์ตารางสอนได้");
    } finally {
      setParsing(false);
    }
  }

  async function handleParseScan() {
    if (!scanFile) {
      toastInfo("กรุณาเลือกไฟล์ PDF หรือรูปภาพตารางสอนก่อน");
      return;
    }
    setParsing(true);
    setWarnings([]);
    try {
      const fd = new FormData();
      fd.append("file", scanFile);
      fd.append("default_semester", defaultSemester || "2/2569");
      const res = await api.parseTimetable(fd);
      setPreviewItems(res.items.map((it) => ({ ...it, selected: it.selected !== false })));
      setParsedMeta(res.metadata && Object.keys(res.metadata).length > 0 ? res.metadata : null);
      setWarnings(res.warnings || []);
      if (res.items.length > 0) {
        toastSuccess(`สแกนตารางสำเร็จ พบ ${res.items.length} รายวิชา`);
      } else {
        toastInfo("ไม่พบรายวิชาจากไฟล์ที่สแกน ลองวางข้อความตารางในแท็บแรกแทน");
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : "ไม่สามารถสแกนไฟล์ตารางสอนได้");
    } finally {
      setParsing(false);
    }
  }

  async function handleFetchSornor02() {
    if (!sornorUrl.trim()) {
      toastInfo("กรุณาระบุ URL หน้าตารางสอน ศธ.02");
      return;
    }
    setParsing(true);
    setWarnings([]);
    try {
      const res = await api.importSornor02({
        url: sornorUrl.trim(),
        auth_mode: authMode,
        username: authMode === "credentials" ? sornorUser : "",
        password: authMode === "credentials" ? sornorPass : "",
        cookie_header: authMode === "cookie" ? sornorCookie : "",
        default_semester: defaultSemester || "2/2569",
      });
      setPreviewItems(res.items.map((it) => ({ ...it, selected: true })));
      setWarnings(res.warnings || []);
      toastSuccess(`ดึงข้อมูลจาก ศธ.02 สำเร็จ พบ ${res.items.length} รายวิชา`);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "ดึงข้อมูลจาก ศธ.02 ไม่สำเร็จ");
    } finally {
      setParsing(false);
    }
  }

  function updateItem(idx: number, patch: Partial<TimetableParsedItem>) {
    setPreviewItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function addEmptyRow() {
    setPreviewItems((prev) => [
      ...prev,
      {
        course_code: "",
        course_name: "",
        t_hours: 1,
        p_hours: 3,
        credit_num: 2,
        credits: "1-3-2 (2 หน่วยกิต 4 ชั่วโมง)",
        curriculum_level: "ปวช.",
        student_group: "",
        total_students: 0,
        schedule_text: "",
        room: "",
        semester: defaultSemester || "2/2569",
        selected: true,
      },
    ]);
  }

  async function handleConfirmImport() {
    const chosen = previewItems.filter((it) => it.selected !== false && it.course_code.trim() && it.course_name.trim());
    if (chosen.length === 0) {
      toastInfo("กรุณาเลือกรายวิชาที่มีรหัสวิชาและชื่อวิชาอย่างน้อย 1 รายการ");
      return;
    }
    setImporting(true);
    try {
      const res = await api.importCourses(chosen);
      onImportSuccess(chosen, res.imported, res.courses, res.skipped_count, applyMetadata && parsedMeta ? parsedMeta : undefined);
      setPreviewItems([]);
      setParsedMeta(null);
      setSelectedFile(null);
      setScanFile(null);
      setRawText("");
      setSornorPass("");
      setUserToggled(true);
      setOpen(false);
      toastSuccess(
        `นำเข้าสำเร็จ ${res.imported.length} วิชา${res.skipped_count > 0 ? ` (ข้ามรายการซ้ำ ${res.skipped_count} วิชา)` : ""} และเติมข้อมูลเข้า Tab 1–4 แล้ว`
      );
    } catch (err) {
      toastError(err instanceof Error ? err.message : "นำเข้ารายวิชาไม่สำเร็จ");
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="ledger-panel overflow-hidden border-l-4 border-l-[#1D4ED8] text-xs">
      <div className="ledger-panel-header flex flex-wrap items-center justify-between gap-2 bg-[#F8FAFC]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#1D4ED8] text-xs font-bold text-white">
            1
          </span>
          <div>
            <h2 className="text-sm font-bold text-[#0F172A]">
              ขั้นตอนที่ 1: นำเข้าตารางเรียน / ตารางสอน (รองรับ ศธ.02)
            </h2>
            <p className="text-[11px] text-[#475569]">
              นำเข้าจาก Excel, CSV, HTML/คัดลอกตาราง ศธ.02, PDF/ภาพถ่าย หรือดึงจากเว็บ ศธ.02 เพื่อเติมเข้าทุกแท็บอัตโนมัติ
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
              coursesCount > 0 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
            }`}
          >
            {coursesCount > 0 ? `คลังมี ${coursesCount} วิชา` : "ยังไม่มีรายวิชาในคลัง"}
          </span>
          <a
            href={api.getTimetableTemplateUrl()}
            download="timetable_template.xlsx"
            className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1 font-semibold text-[#0F172A] hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5 text-[#1D4ED8]" />
            เทมเพลต .xlsx
          </a>
          <button
            type="button"
            onClick={() => {
              setUserToggled(true);
              setOpen((v) => !v);
            }}
            className="inline-flex items-center gap-1 rounded-md bg-[#0F172A] px-2.5 py-1 font-semibold text-white hover:bg-[#1E293B]"
          >
            {open ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" /> ซ่อนตัวนำเข้า
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" /> เปิดนำเข้าตาราง
              </>
            )}
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-4 p-4">
          {/* 3-Mode Selector */}
          <div className="flex flex-wrap gap-1.5 border-b border-[#E2E8F0] pb-2">
            {[
              { id: "file_text" as const, label: "1. ไฟล์ / วางตาราง (Excel, CSV, HTML ศธ.02)", icon: FileSpreadsheet },
              { id: "scan_pdf" as const, label: "2. สแกนภาพถ่าย / PDF ตารางสอน", icon: ImagePlus },
              { id: "sornor02_web" as const, label: "3. ดึงจากเว็บ ศธ.02 โดยตรง", icon: Globe },
            ].map((m) => {
              const Icon = m.icon;
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-semibold transition ${
                    active
                      ? "bg-[#1D4ED8] text-white"
                      : "border border-[#CBD5E1] bg-white text-[#475569] hover:bg-slate-50"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {m.label}
                </button>
              );
            })}
          </div>

          {mode === "file_text" && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
              <div className="space-y-2 lg:col-span-4">
                <label className="block font-semibold text-[#0F172A]">อัปโหลดไฟล์ตารางสอน / HTML จาก ศธ.02</label>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-4 text-center hover:border-[#1D4ED8]">
                  <Upload className="mb-1.5 h-5 w-5 text-[#1D4ED8]" />
                  <span className="font-semibold text-[#0F172A]">
                    {selectedFile ? selectedFile.name : "คลิกเลือกไฟล์ .xlsx, .csv, .html"}
                  </span>
                  <span className="mt-0.5 text-[11px] text-[#64748B]">
                    รองรับไฟล์บันทึกหน้าเว็บ ศธ.02 (.html) และ Excel
                  </span>
                  <input
                    type="file"
                    accept=".xlsx,.csv,.html,.htm,.txt,.tsv"
                    className="hidden"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  />
                </label>
              </div>
              <div className="space-y-2 lg:col-span-8">
                <label className="block font-semibold text-[#0F172A]">
                  หรือวางข้อความที่คัดลอกจากตาราง Excel / หน้าเว็บ ศธ.02
                </label>
                <textarea
                  rows={4}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={`ตัวอย่าง: วางตารางจาก ศธ.02 หรือพิมพ์ทีละบรรทัด เช่น\n20100-1001 เขียนแบบเทคนิคเบื้องต้น 1-3-2 ปวช.1/1 จันทร์ 1-4 ห้อง 421 จำนวน 28 คน\n21910-2013 โปรแกรมกราฟิกและการตกแต่งภาพ 1-3-2 ปวช.2/1 พุธ 5-8 ห้อง Lab2 จำนวน 32 คน`}
                  className="ledger-input w-full font-mono text-[11px]"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-[#64748B]">
                    ระบบจับรหัสวิชา (เช่น 20100-1001), ท-ป-น, กลุ่มเรียน, ห้อง, วัน-คาบ และจำนวนนักเรียนให้อัตโนมัติ
                  </span>
                  <button
                    type="button"
                    disabled={parsing}
                    onClick={handleParseFileOrText}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-3 py-1.5 font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {parsing ? "กำลังวิเคราะห์..." : "วิเคราะห์ตารางสอน"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {mode === "scan_pdf" && (
            <div className="flex flex-col items-start justify-between gap-3 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-4 sm:flex-row sm:items-center">
              <div className="space-y-1">
                <label className="block font-semibold text-[#0F172A]">
                  อัปโหลดไฟล์ PDF ตารางสอน (จาก ศธ.02) หรือภาพถ่ายตารางสอน
                </label>
                <p className="text-[11px] text-[#64748B]">
                  รองรับ .pdf (ถอดข้อความอัตโนมัติ) และ .png / .jpg / .webp (ใช้ AI Vision ตามที่ตั้งค่าในระบบ)
                </p>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  onChange={(e) => setScanFile(e.target.files?.[0] || null)}
                  className="mt-1 block text-xs"
                />
              </div>
              <button
                type="button"
                disabled={parsing}
                onClick={handleParseScan}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[#1D4ED8] px-3.5 py-2 font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {parsing ? "กำลังสแกน..." : "สแกนและวิเคราะห์"}
              </button>
            </div>
          )}

          {mode === "sornor02_web" && (
            <div className="space-y-3 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-7">
                  <label className="mb-1 block font-semibold text-[#0F172A]">URL หน้าตารางสอน ศธ.02</label>
                  <input
                    type="url"
                    value={sornorUrl}
                    onChange={(e) => setSornorUrl(e.target.value)}
                    placeholder="https://std2018.vec.go.th/..."
                    className="ledger-input w-full"
                  />
                </div>
                <div className="md:col-span-5">
                  <label className="mb-1 block font-semibold text-[#0F172A]">รูปแบบการยืนยันตัวตน (ไม่บันทึกถาวร)</label>
                  <select
                    value={authMode}
                    onChange={(e) => setAuthMode(e.target.value as "none" | "cookie" | "credentials")}
                    className="ledger-input w-full"
                  >
                    <option value="none">ลิงก์ตรง / ไม่ต้องล็อกอิน</option>
                    <option value="cookie">Session Cookie (จากเบราว์เซอร์ที่ล็อกอินแล้ว)</option>
                    <option value="credentials">Username / Password ชั่วคราว</option>
                  </select>
                </div>
              </div>

              {authMode === "cookie" && (
                <div>
                  <label className="mb-1 block font-semibold text-[#0F172A]">Cookie Header จากเบราว์เซอร์</label>
                  <input
                    type="text"
                    value={sornorCookie}
                    onChange={(e) => setSornorCookie(e.target.value)}
                    placeholder="เช่น PHPSESSID=...; ..."
                    className="ledger-input w-full font-mono text-[11px]"
                  />
                </div>
              )}

              {authMode === "credentials" && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block font-semibold text-[#0F172A]">Username ศธ.02</label>
                    <input
                      type="text"
                      value={sornorUser}
                      onChange={(e) => setSornorUser(e.target.value)}
                      className="ledger-input w-full"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-[#0F172A]">Password ศธ.02</label>
                    <input
                      type="password"
                      value={sornorPass}
                      onChange={(e) => setSornorPass(e.target.value)}
                      className="ledger-input w-full"
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-[#64748B]">
                  หมายเหตุ: หากหน้า ศธ.02 มี CAPTCHA หรือ 2FA แนะนำให้ล็อกอินในเบราว์เซอร์แล้วคัดลอกตารางมาวางในแท็บที่ 1 แทน
                </span>
                <button
                  type="button"
                  disabled={parsing}
                  onClick={handleFetchSornor02}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-3.5 py-1.5 font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-50"
                >
                  <Globe className="h-3.5 w-3.5" />
                  {parsing ? "กำลังเชื่อมต่อ..." : "ดึงตารางจาก ศธ.02"}
                </button>
              </div>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              {warnings.map((w, i) => (
                <div key={i}>• {w}</div>
              ))}
            </div>
          )}

          {/* Detected Header Metadata Banner */}
          {parsedMeta && (
            <div className="rounded-md border border-blue-200 bg-[#EFF6FF] p-3 text-[11px] text-[#1E3A8A]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold">ข้อมูลหัวตารางและผู้ลงนามที่ตรวจพบจากไฟล์</span>
                <label className="inline-flex cursor-pointer items-center gap-1.5 font-semibold">
                  <input
                    type="checkbox"
                    checked={applyMetadata}
                    onChange={(e) => setApplyMetadata(e.target.checked)}
                  />
                  เติมข้อมูลหัวตารางและผู้ลงนามเข้า Tab 1–4 ด้วย
                </label>
              </div>
              <div className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                {parsedMeta.semester && <div>• ภาคเรียน: <strong>{parsedMeta.semester}</strong></div>}
                {parsedMeta.instructor_name && <div>• ผู้สอน: <strong>{parsedMeta.instructor_name}</strong></div>}
                {parsedMeta.department_name && <div>• แผนกวิชา: <strong>{parsedMeta.department_name}</strong></div>}
                {parsedMeta.major_name && <div>• สาขาวิชา: <strong>{parsedMeta.major_name}</strong></div>}
                {parsedMeta.curriculum_head_name && <div>• หัวหน้างานหลักสูตรฯ: <strong>{parsedMeta.curriculum_head_name}</strong></div>}
                {parsedMeta.deputy_academic_name && <div>• รองฯ ฝ่ายวิชาการ: <strong>{parsedMeta.deputy_academic_name}</strong></div>}
              </div>
            </div>
          )}

          {/* Editable Preview Table */}
          {previewItems.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-bold text-[#0F172A]">
                  ตารางพรีวิว ({previewItems.filter((i) => i.selected !== false).length} / {previewItems.length} วิชาที่เลือก)
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewItems((prev) => prev.map((it) => ({ ...it, selected: !it.is_special })))
                    }
                    className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2 py-1 text-[11px] font-semibold text-[#0F172A] hover:bg-slate-50"
                  >
                    เลือกเฉพาะวิชาสอน (ไม่รวม PLC/กิจกรรม)
                  </button>
                  <button
                    type="button"
                    onClick={addEmptyRow}
                    className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2 py-1 text-[11px] font-semibold text-[#0F172A] hover:bg-slate-50"
                  >
                    <Plus className="h-3 w-3" /> เพิ่มแถวเอง
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-md border border-[#CBD5E1]">
                <table className="w-full min-w-[860px] border-collapse text-left text-[11px]">
                  <thead className="bg-[#F1F5F9] text-[#0F172A]">
                    <tr>
                      <th className="w-8 border-b border-[#CBD5E1] px-2 py-1.5 text-center">เลือก</th>
                      <th className="w-32 border-b border-[#CBD5E1] px-2 py-1.5">รหัสวิชา</th>
                      <th className="border-b border-[#CBD5E1] px-2 py-1.5">ชื่อวิชา</th>
                      <th className="w-36 border-b border-[#CBD5E1] px-2 py-1.5">หน่วยกิต</th>
                      <th className="w-20 border-b border-[#CBD5E1] px-2 py-1.5">ระดับ</th>
                      <th className="w-24 border-b border-[#CBD5E1] px-2 py-1.5">ระบบ</th>
                      <th className="w-36 border-b border-[#CBD5E1] px-2 py-1.5">กลุ่มเรียน</th>
                      <th className="w-16 border-b border-[#CBD5E1] px-2 py-1.5">นร.</th>
                      <th className="w-44 border-b border-[#CBD5E1] px-2 py-1.5">วัน-เวลา / ห้อง</th>
                      <th className="w-10 border-b border-[#CBD5E1] px-2 py-1.5 text-center">ลบ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewItems.map((it, idx) => (
                      <tr key={idx} className={`border-b border-[#E2E8F0] last:border-b-0 ${it.is_special ? "bg-amber-50/40" : ""}`}>
                        <td className="px-2 py-1 text-center">
                          <input
                            type="checkbox"
                            checked={it.selected !== false}
                            onChange={(e) => updateItem(idx, { selected: e.target.checked })}
                          />
                        </td>
                        <td className="px-1.5 py-1">
                          <input
                            type="text"
                            value={it.course_code}
                            onChange={(e) => updateItem(idx, { course_code: e.target.value })}
                            className="ledger-input w-full py-1 text-[11px]"
                          />
                          {it.is_special && (
                            <span className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                              กิจกรรม/PLC
                            </span>
                          )}
                        </td>
                        <td className="px-1.5 py-1">
                          <input
                            type="text"
                            value={it.course_name}
                            onChange={(e) => updateItem(idx, { course_name: e.target.value })}
                            className="ledger-input w-full py-1 text-[11px]"
                          />
                        </td>
                        <td className="px-1.5 py-1">
                          <input
                            type="text"
                            value={it.credits}
                            onChange={(e) => updateItem(idx, { credits: e.target.value })}
                            className="ledger-input w-full py-1 text-[11px]"
                          />
                        </td>
                        <td className="px-1.5 py-1">
                          <select
                            value={it.curriculum_level}
                            onChange={(e) => updateItem(idx, { curriculum_level: e.target.value })}
                            className="ledger-input w-full py-1 text-[11px]"
                          >
                            <option value="ปวช.">ปวช.</option>
                            <option value="ปวส.">ปวส.</option>
                          </select>
                        </td>
                        <td className="px-1.5 py-1">
                          <select
                            value={it.system_type || "ปกติ"}
                            onChange={(e) =>
                              updateItem(idx, { system_type: e.target.value === "ทวิภาคี" ? "ทวิภาคี" : "ปกติ" })
                            }
                            className="ledger-input w-full py-1 text-[11px]"
                          >
                            <option value="ปกติ">ปกติ</option>
                            <option value="ทวิภาคี">ทวิภาคี</option>
                          </select>
                        </td>
                        <td className="px-1.5 py-1">
                          <input
                            type="text"
                            value={it.student_group}
                            onChange={(e) => updateItem(idx, { student_group: e.target.value })}
                            className="ledger-input w-full py-1 text-[11px]"
                          />
                        </td>
                        <td className="px-1.5 py-1">
                          <input
                            type="number"
                            min={0}
                            value={it.total_students}
                            onChange={(e) =>
                              updateItem(idx, { total_students: Math.max(0, Number(e.target.value) || 0) })
                            }
                            className="ledger-input w-full py-1 text-[11px]"
                          />
                        </td>
                        <td className="px-1.5 py-1">
                          <input
                            type="text"
                            value={it.schedule_text}
                            onChange={(e) => updateItem(idx, { schedule_text: e.target.value })}
                            className="ledger-input w-full py-1 text-[11px]"
                          />
                        </td>
                        <td className="px-1.5 py-1 text-center">
                          <button
                            type="button"
                            onClick={() => setPreviewItems((prev) => prev.filter((_, i) => i !== idx))}
                            className="text-red-500 hover:text-red-700"
                            title="ลบแถว"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPreviewItems([])}
                  className="rounded-md border border-[#CBD5E1] bg-white px-3 py-1.5 font-semibold text-[#475569] hover:bg-slate-50"
                >
                  ล้างตารางพรีวิว
                </button>
                <button
                  type="button"
                  disabled={importing}
                  onClick={handleConfirmImport}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {importing ? "กำลังนำเข้า..." : "นำเข้าคลังรายวิชา & เติมเข้า Tab 1–4"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
