"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Download, Eye, FileCheck2, Loader2, Send } from "lucide-react";
import { DocumentPreviewPanel } from "@/components/DocumentPreviewPanel";
import { ResponsivePreviewModal } from "@/components/ResponsivePreviewModal";
import { api, API_BASE, UserProfile } from "@/lib/api";
import { toastError, toastSuccess } from "@/lib/swal";

interface QaCellSchema {
  key: string;
  c_idx: number;
  type: "checkbox" | "text";
  value: string;
  editable: boolean;
}

interface QaTableSchema {
  t_idx: number;
  caption: string;
  headers: string[];
  col_types: string[];
  rows: Array<{ r_idx: number; cells: QaCellSchema[] }>;
}

interface QaSchemaResponse {
  code: string;
  title: string;
  division_code: string;
  division_name: string;
  unit_name: string;
  table_count: number;
  tables: QaTableSchema[];
}

export default function QaToolEditorPage() {
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(String(params?.code || ""));

  const [schema, setSchema] = useState<QaSchemaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [cellValues, setCellValues] = useState<Record<string, string>>({});
  const [reporterName, setReporterName] = useState("");
  const [reporterTitle, setReporterTitle] = useState("ผู้รับผิดชอบตัวชี้วัด");
  const [academicYear, setAcademicYear] = useState("ปีการศึกษา 2569");
  const [docDate, setDocDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [reviewerEmail, setReviewerEmail] = useState("");
  const [approverEmail, setApproverEmail] = useState("director@cric.ac.th");
  const [savedDocId, setSavedDocId] = useState<string | null>(null);

  const previewKeyRef = useRef(Math.random().toString(36).slice(2, 10));
  const [busy, setBusy] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(1);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const [renderResult, setRenderResult] = useState<{
    docx_url: string;
    pdf_url: string | null;
    page_image_urls: string[];
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      api.getQaToolSchema(code).catch(() => null),
      api.me().catch(() => null),
      api.listUsers().catch(() => ({ users: [] })),
    ]).then(([sch, meRes, usersRes]) => {
      if (!mounted) return;
      setSchema(sch);
      if (sch) {
        const init: Record<string, string> = {};
        for (const tbl of sch.tables) {
          for (const row of tbl.rows) {
            for (const c of row.cells) {
              if (c.editable && c.value && c.value !== "-") {
                init[c.key] = c.value;
              }
            }
          }
        }
        setCellValues(init);
      }
      const list = usersRes?.users || [];
      setUsers(list);
      const u = meRes?.user;
      if (u) {
        setReporterName((p) => p || u.full_name || "");
        setReporterTitle((p) => p || u.position_title || "ผู้รับผิดชอบตัวชี้วัด");
        if (u.default_reviewer_email) setReviewerEmail(u.default_reviewer_email);
      }
      const dir = list.find((x) => x.role === "director");
      if (dir?.email) setApproverEmail(dir.email);
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [code]);

  function buildPayload(): Record<string, unknown> {
    return {
      cell_values: cellValues,
      reporter_name: reporterName,
      reporter_title: reporterTitle,
      academic_year: academicYear,
      doc_date: docDate,
    };
  }

  async function handleRender() {
    if (!schema) return;
    setBusy(true);
    try {
      const res = await api.renderQaTool(schema.code, buildPayload(), true, previewKeyRef.current);
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
    if (!schema) return;
    setBusy(true);
    try {
      const res = await api.saveQaTool(schema.code, `${schema.code} ${schema.title}`, buildPayload(), true);
      setSavedDocId(res.document.id);
      toastSuccess("บันทึกร่างเอกสารแล้ว", "สามารถส่งตรวจ/ลงนาม หรือดูได้ที่ศูนย์รวมเอกสารของฉัน");
    } catch (e: unknown) {
      toastError("บันทึกไม่สำเร็จ", e instanceof Error ? e.message : "เกิดข้อผิดพลาด");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitWorkflow() {
    if (!schema) return;
    setBusy(true);
    try {
      let docId = savedDocId;
      if (!docId) {
        const res = await api.saveQaTool(schema.code, `${schema.code} ${schema.title}`, buildPayload(), true);
        docId = res.document.id;
        setSavedDocId(docId);
      }
      await api.submitBundle(docId, reviewerEmail, approverEmail);
      toastSuccess("ส่งตรวจ / ลงนามเรียบร้อยแล้ว");
    } catch (e: unknown) {
      toastError("ส่งตรวจไม่สำเร็จ", e instanceof Error ? e.message : "เกิดข้อผิดพลาด");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="ledger-panel flex items-center justify-center gap-2 p-12 text-sm text-[#475569]">
        <Loader2 className="h-4 w-4 animate-spin text-[#1D4ED8]" />
        <span>กำลังอ่านโครงสร้างตารางจากแม่แบบ {code}...</span>
      </div>
    );
  }

  if (!schema) {
    return (
      <div className="ledger-panel space-y-3 p-8 text-center text-sm">
        <p className="font-bold text-[#0F172A]">ไม่พบเครื่องมือตัวชี้วัดรหัส {code}</p>
        <Link href="/qa-tools" className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-4 py-2 text-xs font-semibold text-white">
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>กลับไปคลัง 32 ตัวชี้วัด</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Banner */}
      <div className="ledger-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0F172A] px-5 py-4 text-white">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded border border-white/25 bg-white/10 px-2 py-0.5 text-[10px] font-bold">
                {schema.division_name} · {schema.unit_name}
              </span>
              <span className="rounded bg-blue-500/30 px-2 py-0.5 font-mono text-xs font-bold text-blue-100">{schema.code}</span>
            </div>
            <h2 className="mt-1 text-base font-bold">{schema.title}</h2>
            <p className="text-xs text-slate-300">พบ {schema.table_count} ตารางจัดเก็บข้อมูลจากแม่แบบต้นฉบับ</p>
          </div>
          <Link
            href="/qa-tools"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>คลัง 32 ตัวชี้วัด</span>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Left: Dynamic Tables + Reporter Info */}
        <div className="space-y-4 xl:col-span-7">
          {/* Reporter Metadata */}
          <section className="ledger-panel overflow-hidden text-xs">
            <div className="ledger-panel-header">
              <h3 className="text-sm font-bold text-[#0F172A]">ข้อมูลผู้รายงานและปีการศึกษา</h3>
            </div>
            <div className="grid grid-cols-1 gap-2.5 p-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">ชื่อผู้รายงานข้อมูล</label>
                <input type="text" value={reporterName} onChange={(e) => setReporterName(e.target.value)} className="ledger-input py-1.5 text-xs" />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">ตำแหน่ง</label>
                <input type="text" value={reporterTitle} onChange={(e) => setReporterTitle(e.target.value)} className="ledger-input py-1.5 text-xs" />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">ปีการศึกษา</label>
                <input type="text" value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} className="ledger-input py-1.5 text-xs" />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">วันที่จัดทำรายงาน</label>
                <input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className="ledger-input py-1.5 text-xs" />
              </div>
            </div>
          </section>

          {/* Dynamic Tables */}
          <div className="space-y-3">
            {schema.tables.map((tbl, idx) => (
              <details key={tbl.t_idx} open={idx < 2} className="ledger-panel overflow-hidden text-xs">
                <summary className="ledger-panel-header cursor-pointer select-none font-bold text-[#0F172A]">
                  <span>
                    ตารางที่ {idx + 1}: {tbl.caption}
                  </span>
                </summary>
                <div className="overflow-x-auto p-3">
                  <table className="w-full min-w-[460px] border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-[#334155]">
                        {tbl.headers.map((h, hIdx) => (
                          <th key={hIdx} className="border border-[#CBD5E1] px-2 py-1.5 text-center font-semibold">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tbl.rows.map((row) => (
                        <tr key={row.r_idx} className="hover:bg-slate-50/70">
                          {row.cells.map((cell) => {
                            const val = cellValues[cell.key] ?? cell.value ?? "";
                            if (cell.type === "checkbox") {
                              const checked = val.trim() === "✓";
                              return (
                                <td key={cell.key} className="border border-[#CBD5E1] p-1 text-center">
                                  <button
                                    type="button"
                                    aria-pressed={checked}
                                    onClick={() =>
                                      setCellValues((prev) => ({
                                        ...prev,
                                        [cell.key]: checked ? "" : "✓",
                                      }))
                                    }
                                    className={`mx-auto flex h-6 w-6 items-center justify-center rounded border text-xs font-bold transition ${
                                      checked
                                        ? "border-[#1D4ED8] bg-[#1D4ED8] text-white"
                                        : "border-[#CBD5E1] bg-white text-transparent hover:border-[#93C5FD]"
                                    }`}
                                  >
                                    ✓
                                  </button>
                                </td>
                              );
                            }
                            if (!cell.editable) {
                              return (
                                <td key={cell.key} className="border border-[#CBD5E1] px-2 py-1.5 font-medium text-[#0F172A]">
                                  {cell.value}
                                </td>
                              );
                            }
                            return (
                              <td key={cell.key} className="border border-[#CBD5E1] p-1">
                                <input
                                  type="text"
                                  value={cellValues[cell.key] ?? ""}
                                  placeholder={cell.value || "กรอกข้อมูล..."}
                                  onChange={(e) => setCellValues((prev) => ({ ...prev, [cell.key]: e.target.value }))}
                                  className="ledger-input py-1 text-xs"
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>

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
              emptyMessage="กรอกข้อมูล/ติ๊ก PDCA ในตารางด้านซ้าย แล้วกด 'สร้างเอกสารและพรีวิว'"
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
      <ResponsivePreviewModal open={mobilePreviewOpen} onOpenChange={setMobilePreviewOpen} title={`${schema.code} ${schema.title}`}>
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
