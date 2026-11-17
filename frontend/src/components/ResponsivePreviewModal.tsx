"use client";

import { useEffect } from "react";
import { Eye, Loader2, X } from "lucide-react";

interface ResponsivePreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  triggerLabel?: string;
  pageCount?: number;
  loading?: boolean;
  hasPreview?: boolean;
  desktopColClass?: string;
  triggerBadge?: string;
  hideFloatingTrigger?: boolean;
  topContent?: React.ReactNode;
  footerSlot?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Displays preview/review content in a sticky right column on desktop (>= xl)
 * and inside a responsive full-height modal below xl (< 1280px), avoiding
 * cramped side-by-side panels or endless scrolling on phones and tablets.
 */
export function ResponsivePreviewModal({
  open,
  onOpenChange,
  title = "ตัวอย่างเอกสารก่อนพิมพ์ (A4)",
  triggerLabel = "ดูตัวอย่าง A4",
  pageCount = 0,
  loading = false,
  hasPreview = false,
  desktopColClass = "xl:col-span-5",
  triggerBadge,
  hideFloatingTrigger = false,
  topContent,
  footerSlot,
  children,
}: ResponsivePreviewModalProps) {
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  const badgeText =
    triggerBadge ??
    (loading ? "กำลังสร้าง..." : pageCount > 0 ? `${pageCount} หน้า` : hasPreview ? "พร้อมดู" : undefined);

  return (
    <>
      {/* Desktop (>= 1280px) Inline Sticky Column */}
      <div className={`hidden space-y-4 xl:block ${desktopColClass}`}>
        {topContent}
        <div className="xl:sticky xl:top-[72px] space-y-4">
          {children}
          {footerSlot}
        </div>
      </div>

      {/* Mobile & Tablet (< 1280px) Floating Trigger */}
      {!hideFloatingTrigger && !open && (
        <div className="fixed bottom-4 right-4 z-10 xl:hidden">
          <button
            type="button"
            onClick={() => onOpenChange(true)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#1E3A8A]/20 bg-[#0F172A] px-4 py-2.5 text-xs font-bold text-white shadow-lg transition-transform hover:bg-[#1E293B] active:scale-[0.98]"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-blue-300" /> : <Eye className="h-4 w-4 text-blue-300" />}
            <span>{triggerLabel}</span>
            {badgeText && (
              <span className="tabular-nums-th rounded-full bg-[#1D4ED8] px-2 py-0.5 text-[11px] font-semibold text-white">
                {badgeText}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Mobile & Tablet (< 1280px) Modal Sheet */}
      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/60 backdrop-blur-[1px] sm:items-center sm:p-4 xl:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(e) => {
            if (e.target === e.currentTarget) onOpenChange(false);
          }}
        >
          <div className="flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-xl border border-[#CBD5E1] bg-[#F1F5F9] shadow-2xl sm:max-h-[90dvh] sm:rounded-lg">
            {/* Sticky Modal Header */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#CBD5E1] bg-white px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <Eye className="h-4 w-4 shrink-0 text-[#1D4ED8]" />
                <h2 className="truncate text-sm font-bold text-[#0F172A]">{title}</h2>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#CBD5E1] bg-[#F8FAFC] text-[#334155] hover:bg-slate-100 hover:text-[#0F172A]"
                aria-label="ปิดหน้าต่างตัวอย่าง"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
              {topContent}
              {children}
            </div>

            {/* Optional Sticky Footer (e.g., Approval decision buttons) */}
            {footerSlot && (
              <div className="shrink-0 border-t border-[#CBD5E1] bg-white px-4 py-3">
                {footerSlot}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
