"use client";

import { useState } from "react";
import { Download, ExternalLink, FileText, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { API_BASE } from "@/lib/api";

interface DocumentPreviewPanelProps {
  fontFamily: string;
  docxUrl?: string;
  pdfUrl?: string;
  pageImageUrls?: string[];
  pdfError?: string;
  loading?: boolean;
  versionKey?: number;
  emptyMessage?: string;
}

const ZOOM_STEPS = [75, 100, 125] as const;

export function DocumentPreviewPanel({
  fontFamily,
  docxUrl,
  pdfUrl,
  pageImageUrls = [],
  pdfError,
  loading = false,
  versionKey = 0,
  emptyMessage = "ยังไม่มีตัวอย่างเอกสาร กรอกข้อมูลแล้วกดปุ่มอัปเดตตัวอย่างเพื่อดูหน้ากระดาษ A4",
}: DocumentPreviewPanelProps) {
  const [zoomMode, setZoomMode] = useState<"fit" | 75 | 100 | 125>("fit");
  const totalPages = pageImageUrls.length;
  const hasAnyFile = Boolean(docxUrl || pdfUrl || totalPages > 0);

  function stepZoom(delta: -1 | 1) {
    if (zoomMode === "fit") {
      setZoomMode(delta > 0 ? 100 : 75);
      return;
    }
    const idx = ZOOM_STEPS.indexOf(zoomMode);
    const next = ZOOM_STEPS[idx + delta];
    if (next) setZoomMode(next);
  }

  return (
    <section className="overflow-hidden rounded-lg border border-[#CBD5E1] bg-white">
      {/* Crisp Ledger Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#CBD5E1] bg-[#F8FAFC] px-3 py-2 sm:px-3.5 sm:py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-[#0F172A]">ตัวอย่างก่อนพิมพ์</span>
          <span className="rounded border border-[#CBD5E1] bg-white px-1.5 py-0.5 text-[11px] font-medium text-[#475569]">
            {fontFamily}
          </span>
          {totalPages > 0 && (
            <span className="tabular-nums-th rounded border border-blue-200 bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-semibold text-[#1E3A8A]">
              {totalPages} หน้า A4
            </span>
          )}
          {loading && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#1D4ED8]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              กำลังสร้างตัวอย่าง
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {totalPages > 0 && (
            <div className="tabular-nums-th mr-1 flex items-center rounded-md border border-[#CBD5E1] bg-white p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => stepZoom(-1)}
                title="ย่อ"
                className="rounded px-1.5 py-1 text-[#475569] hover:bg-slate-100 hover:text-[#0F172A]"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoomMode("fit")}
                className={`rounded px-2 py-0.5 font-semibold ${
                  zoomMode === "fit" ? "bg-[#0F172A] text-white" : "text-[#475569] hover:bg-slate-100"
                }`}
              >
                พอดีกรอบ
              </button>
              {ZOOM_STEPS.map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => setZoomMode(z)}
                  className={`rounded px-1.5 py-0.5 font-semibold ${
                    zoomMode === z ? "bg-[#0F172A] text-white" : "text-[#475569] hover:bg-slate-100"
                  }`}
                >
                  {z}%
                </button>
              ))}
              <button
                type="button"
                onClick={() => stepZoom(1)}
                title="ขยาย"
                className="rounded px-1.5 py-1 text-[#475569] hover:bg-slate-100 hover:text-[#0F172A]"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {docxUrl && (
            <a
              href={`${API_BASE}${docxUrl}?download=1`}
              title={
                docxUrl.toLowerCase().endsWith(".xlsx")
                  ? "ดาวน์โหลดไฟล์ Excel ต้นฉบับพร้อมสูตรคำนวณ (=SUM, =BAHTTEXT)"
                  : "ดาวน์โหลดเอกสารต้นฉบับ"
              }
              className="inline-flex items-center gap-1 rounded-md bg-[#0F172A] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#1E293B]"
            >
              <Download className="h-3.5 w-3.5" />
              {docxUrl.toLowerCase().endsWith(".xlsx") ? ".XLSX" : docxUrl.toLowerCase().endsWith(".zip") ? ".ZIP" : ".DOCX"}
            </a>
          )}
          {pdfUrl && (
            <>
              <a
                href={`${API_BASE}${pdfUrl}?download=1`}
                className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#0F172A] hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" />
                .PDF
              </a>
              <a
                href={`${API_BASE}${pdfUrl}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-[#EFF6FF] px-2.5 py-1.5 text-[11px] font-semibold text-[#1E3A8A] hover:bg-blue-100"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                เปิดเต็มจอ
              </a>
            </>
          )}
        </div>
      </div>

      {/* Architectural Drafting Canvas */}
      <div className="drafting-grid relative max-h-[65dvh] overflow-auto p-2.5 sm:max-h-[720px] sm:p-5 xl:max-h-[760px]">
        {totalPages > 0 ? (
          <div className="flex flex-col items-center gap-3 sm:gap-5">
            {pageImageUrls.map((url, idx) => (
              <div
                key={`${url}-${versionKey}`}
                className="relative overflow-hidden border border-[#94A3B8] bg-white shadow-[0_3px_12px_rgba(15,23,42,0.12)]"
                style={
                  zoomMode === "fit"
                    ? { width: "100%", maxWidth: "680px" }
                    : { width: `${Math.round((680 * zoomMode) / 100)}px` }
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${API_BASE}${url}?v=${versionKey}`}
                  alt={`หน้า ${idx + 1}`}
                  className="block h-auto w-full select-none"
                />
                {totalPages > 1 && (
                  <div className="tabular-nums-th border-t border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1 text-right text-[11px] font-medium text-[#475569]">
                    หน้า {idx + 1} / {totalPages}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : pdfUrl ? (
          <iframe
            title="PDF Preview"
            src={`${API_BASE}${pdfUrl}?v=${versionKey}#toolbar=0`}
            className="h-[420px] w-full border border-[#94A3B8] bg-white shadow-[0_3px_12px_rgba(15,23,42,0.12)] sm:h-[600px]"
          />
        ) : (
          <div className="flex h-[280px] flex-col items-center justify-center gap-2.5 rounded-md border border-dashed border-[#94A3B8] bg-white/75 p-5 text-center text-sm text-[#475569] sm:h-[420px] sm:p-6">
            {loading ? (
              <>
                <Loader2 className="h-7 w-7 animate-spin text-[#1D4ED8]" />
                <span className="font-medium text-[#0F172A]">กำลังจัดหน้าเอกสารตัวอย่าง...</span>
              </>
            ) : (
              <>
                <FileText className="h-8 w-8 text-[#64748B]" />
                <span className="max-w-sm leading-relaxed">
                  {pdfError
                    ? `ไม่สามารถแสดงตัวอย่าง PDF ได้ (${pdfError})${hasAnyFile ? " สามารถดาวน์โหลดไฟล์ต้นฉบับด้านบนได้ทันที" : ""}`
                    : emptyMessage}
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
