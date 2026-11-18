"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileCheck2,
  FileEdit,
  FilePlus2,
  FileText,
  GraduationCap,
  Loader2,
  PackageCheck,
  PenTool,
  Search,
  Settings,
  UserCog,
} from "lucide-react";
import {
  api,
  API_BASE,
  CourseRecord,
  DocumentRecord,
  formatUserSubtitle,
  UserProfile,
} from "@/lib/api";
import { UserAvatar } from "@/components/UserAvatar";
import { ROLE_CONFIG } from "@/lib/personnelConstants";

type StatusFilter = "all" | "draft" | "pending" | "approved";

const DOC_TYPE_LABELS: Record<string, string> = {
  memo: "บันทึกข้อความ",
  external_letter: "หนังสือภายนอก",
  order: "คำสั่ง",
  announcement: "ประกาศ",
  agenda: "ระเบียบวาระ",
  minutes: "รายงานการประชุม",
  circular: "หนังสือเวียน",
  sp_bundle: "ชุดจัดซื้อ / สผ.",
  course_syllabus: "กำหนดการสอน",
  lesson_plan: "แผนการสอน",
  post_teaching_normal: "หลังสอนปกติ (4 สัปดาห์)",
  post_teaching_online: "หลังสอนออนไลน์",
};

const STATUS_META: Record<string, { label: string; badge: string }> = {
  draft: { label: "ฉบับร่าง", badge: "border-slate-300 bg-slate-100 text-slate-700" },
  pending_review: { label: "รอผู้ตรวจ", badge: "border-amber-300 bg-amber-50 text-amber-800" },
  pending_approval: { label: "รออนุมัติ", badge: "border-blue-300 bg-blue-50 text-blue-800" },
  approved: { label: "อนุมัติแล้ว", badge: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  rejected: { label: "ส่งกลับแก้ไข", badge: "border-red-300 bg-red-50 text-red-700" },
};

function fileUrlFromPath(pathStr?: string): string | null {
  if (!pathStr) return null;
  const parts = pathStr.replace(/\\/g, "/").split("/");
  const name = parts[parts.length - 1];
  if (!name) return null;
  return `${API_BASE}/v1/files/rendered/${encodeURIComponent(name)}?download=1`;
}

export default function UserDocumentHubPage() {
  const [me, setMe] = useState<UserProfile | null>(null);
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [courses, setCourses] = useState<CourseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    let mounted = true;
    async function loadHub() {
      setLoading(true);
      try {
        const [meRes, docsRes, coursesRes] = await Promise.all([
          api.me().catch(() => null),
          api.listDocuments().catch(() => ({ documents: [] })),
          api.listCourses(true).catch(() => ({ courses: [] })),
        ]);
        if (!mounted) return;
        setMe(meRes?.user || null);
        setDocs(docsRes.documents || []);
        setCourses(coursesRes.courses || []);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadHub();
    return () => {
      mounted = false;
    };
  }, []);

  const myDocs = useMemo(() => {
    if (!me) return docs;
    const myIdent = (me.email || me.username || me.id || "").toLowerCase();
    const owned = docs.filter((d) => {
      if ((d.created_by || "").toLowerCase() === myIdent) return true;
      return (d.approval_steps || []).some((s) => (s.assignee_email || "").toLowerCase() === myIdent);
    });
    return owned.length > 0 ? owned : docs;
  }, [docs, me]);

  const counts = useMemo(() => {
    const draft = myDocs.filter((d) => d.status === "draft" || d.status === "rejected").length;
    const pending = myDocs.filter((d) => d.status === "pending_review" || d.status === "pending_approval").length;
    const approved = myDocs.filter((d) => d.status === "approved").length;
    return { total: myDocs.length, draft, pending, approved };
  }, [myDocs]);

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return myDocs.filter((d) => {
      if (statusFilter === "draft" && d.status !== "draft" && d.status !== "rejected") return false;
      if (statusFilter === "pending" && d.status !== "pending_review" && d.status !== "pending_approval") return false;
      if (statusFilter === "approved" && d.status !== "approved") return false;
      if (!q) return true;
      return (
        (d.subject || "").toLowerCase().includes(q) ||
        (d.doc_number || "").toLowerCase().includes(q) ||
        (DOC_TYPE_LABELS[d.doc_type] || d.doc_type).toLowerCase().includes(q)
      );
    });
  }, [myDocs, searchQuery, statusFilter]);

  const roleMeta = ROLE_CONFIG[me?.role || "drafter"] || ROLE_CONFIG.drafter;
  const userSubtitle = formatUserSubtitle(me) || "-";
  const primaryUnit = me?.unit_name || (me?.units && me.units[0]) || "-";

  if (loading && !me) {
    return (
      <div className="ledger-panel flex items-center justify-center gap-2 p-12 text-sm text-[#475569]">
        <Loader2 className="h-4 w-4 animate-spin text-[#1D4ED8]" />
        กำลังโหลดศูนย์รวมข้อมูลเอกสาร...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Summary + Direct Profile Settings Split */}
      <div className="ledger-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 bg-[#0F172A] px-5 py-5 text-white">
          <div className="flex flex-wrap items-center gap-4">
            <UserAvatar avatarUrl={me?.avatar_url} fullName={me?.full_name} size="lg" className="ring-2 ring-white/30" />
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight">{me?.full_name || "ผู้ใช้งาน"}</h2>
                <span className="rounded-full border border-white/25 bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  {roleMeta.shortLabel}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-200">
                <span>{userSubtitle}</span>
                <span className="text-slate-500">•</span>
                <span>{me?.position_title || "บุคลากร"}</span>
                <span className="text-slate-500">•</span>
                <span>สังกัดหลัก: {primaryUnit}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link
              href="/profile/settings?tab=signature"
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 font-semibold transition ${
                me?.signature_storage_path
                  ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
                  : "border-amber-400/40 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30"
              }`}
            >
              <BadgeCheck className="h-3.5 w-3.5" />
              <span>{me?.signature_storage_path ? "ลายเซ็นพร้อมใช้" : "ตั้งค่าลายเซ็น"}</span>
            </Link>
            <Link
              href="/profile/settings"
              className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-3.5 py-2 font-semibold text-white shadow-sm hover:bg-[#1E40AF]"
            >
              <Settings className="h-3.5 w-3.5" />
              <span>ตั้งค่าโปรไฟล์</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Document KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "เอกสารของฉันทั้งหมด", val: counts.total, icon: FileText, tone: "text-[#1D4ED8] bg-blue-50 border-blue-200" },
          { label: "ฉบับร่าง / แก้ไข", val: counts.draft, icon: FileEdit, tone: "text-slate-700 bg-slate-50 border-slate-200" },
          { label: "รอตรวจ / รออนุมัติ", val: counts.pending, icon: Clock, tone: "text-amber-700 bg-amber-50 border-amber-200" },
          { label: "อนุมัติแล้ว", val: counts.approved, icon: CheckCircle2, tone: "text-emerald-700 bg-emerald-50 border-emerald-200" },
        ].map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="ledger-panel flex items-center justify-between p-4">
              <div>
                <div className="text-[11px] font-semibold text-[#64748B]">{kpi.label}</div>
                <div className="tabular-nums-th mt-1 text-2xl font-bold text-[#0F172A]">{kpi.val}</div>
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg border ${kpi.tone}`}>
                <Icon className="h-5 w-5" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Content Split: My Documents (8 cols) + Quick Actions & My Courses (4 cols) */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Left: My Document Repository */}
        <section className="ledger-panel overflow-hidden xl:col-span-8">
          <div className="ledger-panel-header flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileCheck2 className="h-4 w-4 text-[#1D4ED8]" />
              <h3 className="text-sm font-bold text-[#0F172A]">ศูนย์รวมเอกสารของฉัน ({filteredDocs.length} รายการ)</h3>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {(
                [
                  { id: "all", label: "ทั้งหมด" },
                  { id: "draft", label: "ฉบับร่าง" },
                  { id: "pending", label: "รอดำเนินการ" },
                  { id: "approved", label: "อนุมัติแล้ว" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`rounded-md border px-2.5 py-1 font-semibold transition ${
                    statusFilter === tab.id
                      ? "border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]"
                      : "border-[#CBD5E1] bg-white text-[#475569] hover:bg-slate-50"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#64748B]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาชื่อเรื่อง, เลขที่หนังสือ, หรือประเภทเอกสาร..."
                className="ledger-input py-1.5 !pl-9 text-xs"
              />
            </div>
          </div>

          {filteredDocs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 p-10 text-center text-xs text-[#64748B]">
              <FileText className="h-8 w-8 text-slate-300" />
              <p className="font-semibold text-[#334155]">ยังไม่มีเอกสารในหมวดนี้</p>
              <Link
                href="/draft"
                className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-3.5 py-2 font-semibold text-white hover:bg-[#1E40AF]"
              >
                <FilePlus2 className="h-3.5 w-3.5" />
                <span>เริ่มร่างเอกสารใหม่</span>
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-[#E2E8F0]">
              {filteredDocs.slice(0, 20).map((doc) => {
                const st = STATUS_META[doc.status] || { label: doc.status, badge: "border-slate-200 bg-slate-50 text-slate-700" };
                const docxUrl = fileUrlFromPath(doc.docx_path);
                const pdfUrl = fileUrlFromPath(doc.pdf_path);
                const openHref =
                  doc.status === "pending_review" || doc.status === "pending_approval"
                    ? "/approvals"
                    : `/draft?id=${encodeURIComponent(doc.id)}`;
                return (
                  <div key={doc.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs hover:bg-slate-50/70">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-[#334155]">
                          {DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}
                        </span>
                        {doc.doc_number && (
                          <span className="tabular-nums-th font-mono text-[11px] font-semibold text-[#1D4ED8]">{doc.doc_number}</span>
                        )}
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${st.badge}`}>{st.label}</span>
                      </div>
                      <div className="truncate font-semibold text-[#0F172A]">{doc.subject || "(ไม่มีชื่อเรื่อง)"}</div>
                      <div className="text-[11px] text-[#64748B]">
                        อัปเดตเมื่อ {doc.updated_at ? new Date(doc.updated_at).toLocaleDateString("th-TH") : "-"}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {docxUrl && (
                        <a
                          href={docxUrl}
                          className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2 py-1 text-[11px] font-semibold text-[#0F172A] hover:bg-slate-50"
                        >
                          <Download className="h-3 w-3" />
                          <span>.DOCX</span>
                        </a>
                      )}
                      {pdfUrl && (
                        <a
                          href={pdfUrl}
                          className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2 py-1 text-[11px] font-semibold text-[#0F172A] hover:bg-slate-50"
                        >
                          <Download className="h-3 w-3" />
                          <span>.PDF</span>
                        </a>
                      )}
                      <Link
                        href={openHref}
                        className="inline-flex items-center gap-1 rounded bg-[#EFF6FF] px-2.5 py-1 text-[11px] font-semibold text-[#1D4ED8] hover:bg-[#DBEAFE]"
                      >
                        <span>เปิด</span>
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Right: Quick Shortcuts + Courses + Profile Settings Link */}
        <div className="space-y-4 xl:col-span-4">
          <div className="ledger-panel overflow-hidden">
            <div className="ledger-panel-header flex items-center gap-2">
              <FilePlus2 className="h-4 w-4 text-[#1D4ED8]" />
              <h3 className="text-sm font-bold text-[#0F172A]">ทางลัดสร้างเอกสาร</h3>
            </div>
            <div className="space-y-2 p-4 text-xs">
              <Link href="/draft" className="flex items-center justify-between rounded-md border border-[#E2E8F0] bg-white px-3 py-2.5 font-semibold text-[#0F172A] hover:border-[#93C5FD] hover:bg-[#EFF6FF]">
                <span className="flex items-center gap-2">
                  <FileEdit className="h-4 w-4 text-[#1D4ED8]" />
                  <span>ร่างบันทึกข้อความ / หนังสือราชการ</span>
                </span>
                <ExternalLink className="h-3.5 w-3.5 text-[#64748B]" />
              </Link>
              <Link href="/procurement" className="flex items-center justify-between rounded-md border border-[#E2E8F0] bg-white px-3 py-2.5 font-semibold text-[#0F172A] hover:border-[#93C5FD] hover:bg-[#EFF6FF]">
                <span className="flex items-center gap-2">
                  <PackageCheck className="h-4 w-4 text-emerald-600" />
                  <span>จัดซื้อวัสดุฝึก / ชุดเอกสาร สผ.</span>
                </span>
                <ExternalLink className="h-3.5 w-3.5 text-[#64748B]" />
              </Link>
              <Link href="/teaching" className="flex items-center justify-between rounded-md border border-[#E2E8F0] bg-white px-3 py-2.5 font-semibold text-[#0F172A] hover:border-[#93C5FD] hover:bg-[#EFF6FF]">
                <span className="flex items-center gap-2">
                  <GraduationCap className="h-4 w-4 text-amber-600" />
                  <span>แผนการสอน / บันทึกหลังสอน</span>
                </span>
                <ExternalLink className="h-3.5 w-3.5 text-[#64748B]" />
              </Link>
            </div>
          </div>

          <div className="ledger-panel overflow-hidden">
            <div className="ledger-panel-header flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-[#1D4ED8]" />
                <h3 className="text-sm font-bold text-[#0F172A]">คลังรายวิชาของฉัน ({courses.length})</h3>
              </div>
              <Link href="/teaching" className="text-[11px] font-semibold text-[#1D4ED8] hover:underline">
                จัดการรายวิชา
              </Link>
            </div>
            <div className="p-4 text-xs">
              {courses.length === 0 ? (
                <p className="text-[#64748B]">ยังไม่มีรายวิชาในคลัง กด &ldquo;จัดการรายวิชา&rdquo; เพื่อเพิ่มรายวิชาประจำตัว</p>
              ) : (
                <ul className="space-y-1.5">
                  {courses.slice(0, 5).map((c) => (
                    <li key={c.id || c.course_code} className="flex items-center justify-between gap-2 rounded border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-1.5">
                      <span className="truncate font-medium text-[#0F172A]">
                        <span className="font-mono text-[#1D4ED8]">{c.course_code}</span> {c.course_name}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="ledger-panel overflow-hidden">
            <div className="ledger-panel-header flex items-center gap-2">
              <UserCog className="h-4 w-4 text-[#1D4ED8]" />
              <h3 className="text-sm font-bold text-[#0F172A]">โซนการตั้งค่าโปรไฟล์</h3>
            </div>
            <div className="space-y-2 p-4 text-xs text-[#475569]">
              <p>จัดการข้อมูลส่วนตัว ตำแหน่ง สังกัดหลายฝ่าย/งาน รูปโปรไฟล์ และลายเซ็นอิเล็กทรอนิกส์แยกจากศูนย์รวมเอกสาร</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Link
                  href="/profile/settings"
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#0F172A] px-3 py-2 font-semibold text-white hover:bg-slate-800"
                >
                  <Settings className="h-3.5 w-3.5" />
                  <span>ไปที่ตั้งค่าโปรไฟล์</span>
                </Link>
                <Link
                  href="/profile/settings?tab=signature"
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-3 py-2 font-semibold text-[#0F172A] hover:bg-slate-50"
                >
                  <PenTool className="h-3.5 w-3.5 text-[#1D4ED8]" />
                  <span>ลายเซ็น</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
