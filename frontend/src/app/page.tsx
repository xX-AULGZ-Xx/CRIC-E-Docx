"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  CheckCircle2,
  ClipboardList,
  Clock,
  Download,
  FileBadge,
  FileCheck2,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  Layers,
  Loader2,
  LogIn,
  PackageCheck,
  PenTool,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Sparkles,
  UserCog,
} from "lucide-react";
import {
  api,
  ApiError,
  API_BASE,
  DashboardDocItem,
  DashboardSummaryResponse,
  getSsoLoginUrl,
  UserProfile,
} from "@/lib/api";

const ROLE_LABELS: Record<string, string> = {
  drafter: "ผู้ร่างเอกสาร",
  unit_head: "หัวหน้างาน",
  deputy_director: "รองผู้อำนวยการ",
  director: "ผู้อำนวยการ",
  saraban_admin: "เจ้าหน้าที่สารบรรณกลาง",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  memo: "บันทึกข้อความ",
  external: "หนังสือภายนอก",
  order: "คำสั่ง",
  announcement: "ประกาศ",
  agenda: "ระเบียบวาระ",
  minutes: "รายงานประชุม",
  sp_bundle: "จัดซื้อ / สผ.",
  course_syllabus: "โครงการสอน",
  lesson_plan: "แผนการสอน",
  post_teaching_normal: "หลังสอนปกติ",
  post_teaching_online: "หลังสอนออนไลน์",
  custom_template: "แม่แบบกำหนดเอง",
};

const STATUS_META: Record<string, { label: string; badge: string }> = {
  draft: { label: "ฉบับร่าง", badge: "bg-slate-100 text-slate-700 border-slate-200" },
  pending_review: { label: "รอตรวจทาน", badge: "bg-amber-50 text-amber-800 border-amber-200" },
  needs_revision: { label: "ส่งกลับแก้ไข", badge: "bg-red-50 text-[#B91C1C] border-red-200" },
  pending_approval: { label: "รออนุมัติ", badge: "bg-indigo-50 text-indigo-800 border-indigo-200" },
  approved: { label: "อนุมัติแล้ว", badge: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  numbered: { label: "ออกเลขแล้ว", badge: "bg-[#EFF6FF] text-[#1E3A8A] border-blue-200" },
};

const EVENT_LABELS: Record<string, string> = {
  saved_draft: "บันทึกร่าง",
  submitted: "ส่งตรวจ/ลงนาม",
  approved: "อนุมัติเอกสาร",
  returned: "ส่งกลับแก้ไข",
  numbered: "ออกเลขสารบรรณ",
  profile_updated: "อัปเดตโปรไฟล์",
  signature_uploaded: "อัปโหลดลายเซ็น",
  signature_deleted: "ลบลายเซ็น",
  ai_copilot_toggled: "สลับสถานะ AI",
  sequence_updated: "ตั้งค่าเลขรัน",
  custom_template_created: "เพิ่มแม่แบบ",
};

const QUICK_LAUNCH = [
  { href: "/draft?type=memo", label: "บันทึกข้อความ", sub: "ร่างเอกสารราชการ", icon: FileText },
  { href: "/draft?type=external", label: "หนังสือภายนอก", sub: "ตราครุฑส่งภายนอก", icon: ScrollText },
  { href: "/draft?type=order", label: "คำสั่ง / ประกาศ", sub: "ออกคำสั่งและประกาศ", icon: FilePlus2 },
  { href: "/procurement", label: "จัดซื้อ / สผ.", sub: "สผ.1 · แผนฝึก · TOR", icon: PackageCheck },
  { href: "/teaching", label: "แผนการสอน 18 สัปดาห์", sub: "โครงการ & หลังสอน", icon: GraduationCap },
  { href: "/templates", label: "แม่แบบ / Batch ZIP", sub: "กรอกแม่แบบหรือชุด Excel", icon: Layers },
];

type QueueTab = "waiting_my_action" | "my_drafts_or_revisions" | "waiting_numbering";

function formatShortDate(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return d.toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DashboardPage() {
  const [me, setMe] = useState<UserProfile | null>(null);
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [queueTab, setQueueTab] = useState<QueueTab>("waiting_my_action");
  const [errMsg, setErrMsg] = useState("");

  const loadDashboard = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);
    setErrMsg("");
    try {
      const [meRes, dashRes] = await Promise.all([api.me(), api.getDashboardSummary()]);
      setIsGuest(false);
      setMe(meRes.user);
      setSummary(dashRes);
      if (
        dashRes.action_queue.waiting_my_action.length === 0 &&
        dashRes.action_queue.my_drafts_or_revisions.length > 0
      ) {
        setQueueTab("my_drafts_or_revisions");
      } else if (
        dashRes.action_queue.waiting_my_action.length === 0 &&
        dashRes.action_queue.waiting_numbering.length > 0
      ) {
        setQueueTab("waiting_numbering");
      } else {
        setQueueTab("waiting_my_action");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setIsGuest(true);
        setMe(null);
        setSummary(null);
        setErrMsg("");
      } else {
        setErrMsg(err instanceof Error ? err.message : "โหลดข้อมูลแดชบอร์ดไม่สำเร็จ");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard(false);
    const handler = () => loadDashboard(false);
    window.addEventListener("cric-user-changed", handler);
    window.addEventListener("cric-profile-updated", handler);
    return () => {
      window.removeEventListener("cric-user-changed", handler);
      window.removeEventListener("cric-profile-updated", handler);
    };
  }, [loadDashboard]);

  if (loading && !summary && !isGuest) {
    return (
      <div className="ledger-panel flex items-center justify-center gap-2 p-12 text-sm text-[#475569]">
        <Loader2 className="h-4 w-4 animate-spin text-[#1D4ED8]" />
        กำลังโหลดภาพรวมแดชบอร์ด...
      </div>
    );
  }

  if (isGuest) {
    return (
      <div className="space-y-5">
        <section className="ledger-panel overflow-hidden">
          <div className="border-b border-[#E2E8F0] bg-[#0F172A] px-5 py-6 text-white sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="max-w-2xl space-y-2">
                <div className="inline-flex items-center gap-1.5 rounded border border-slate-600 bg-slate-800 px-2.5 py-0.5 text-[11px] font-semibold text-slate-200">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                  สถานะผู้เยี่ยมชม (Guest) · CRIC E-Docx
                </div>
                <h2 className="text-lg font-bold tracking-tight sm:text-xl">
                  ระบบร่างหนังสือราชการและงานสารบรรณอิเล็กทรอนิกส์
                </h2>
                <p className="text-xs leading-relaxed text-slate-300 sm:text-sm">
                  วิทยาลัยการอาชีพเชียงราย — รองรับการร่างบันทึกข้อความ หนังสือภายนอก คำสั่ง ประกาศ เอกสารจัดซื้อ สผ.1 โครงการสอน และสายงานตรวจลงนามตามระเบียบสำนักนายกรัฐมนตรีว่าด้วยงานสารบรรณ
                </p>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <a
                  href={getSsoLoginUrl("/")}
                  className="inline-flex items-center gap-2 rounded-md bg-[#1D4ED8] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1E40AF]"
                >
                  <LogIn className="h-4 w-4" />
                  เข้าสู่ระบบด้วย CRIC SSO
                </a>
                <a
                  href="http://localhost:3000"
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-500 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-100 hover:bg-slate-700"
                >
                  กลับสู่ CRIC Panel
                </a>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 sm:p-5">
            {QUICK_LAUNCH.map((tile) => {
              const Icon = tile.icon;
              return (
                <Link
                  key={tile.href}
                  href={tile.href}
                  className="group flex items-center gap-3 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 transition-colors hover:border-[#1D4ED8] hover:bg-white"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#CBD5E1] bg-white text-[#1D4ED8] group-hover:border-[#1D4ED8]">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#0F172A]">{tile.label}</div>
                    <div className="truncate text-[11px] text-[#64748B]">{tile.sub}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  const counts = summary?.counts || {
    total: 0,
    draft: 0,
    pending_review: 0,
    needs_revision: 0,
    pending_approval: 0,
    approved: 0,
    numbered: 0,
  };
  const queue = summary?.action_queue || {
    waiting_my_action: [],
    my_drafts_or_revisions: [],
    waiting_numbering: [],
  };
  const myPendingTotal = queue.waiting_my_action.length + queue.waiting_numbering.length;
  const activeQueueItems: DashboardDocItem[] = queue[queueTab] || [];
  const isAdminOrDirector = me?.role === "saraban_admin" || me?.role === "director";

  const profileChecks = [
    { label: "ชื่อ–ตำแหน่ง", ok: Boolean(me?.full_name && me?.position_title) },
    { label: "ฝ่าย/แผนกงาน", ok: Boolean(me?.division_code || me?.unit_name) },
    { label: "เบอร์โทรศัพท์", ok: Boolean(me?.phone) },
    { label: "ผู้ตรวจประจำ", ok: Boolean(me?.default_reviewer_email) },
    { label: "ลายเซ็น PNG", ok: Boolean(me?.signature_storage_path) },
  ];
  const completedChecks = profileChecks.filter((c) => c.ok).length;

  return (
    <div className="space-y-5">
      {errMsg && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-medium text-[#B91C1C]">
          {errMsg}
        </div>
      )}

      {/* 1. Welcome Strip & Quick Launch */}
      <section className="ledger-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-[#0F172A]">
                สวัสดี, {me?.full_name || "ผู้ใช้งาน"}
              </h2>
              <span className="rounded border border-[#CBD5E1] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#334155]">
                {me ? ROLE_LABELS[me.role] || me.role : "-"}
              </span>
              {me?.division_code && (
                <span className="rounded bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-bold text-[#1E3A8A]">
                  {me.division_code}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-[#475569]">
              {[me?.position_title, me?.unit_name].filter(Boolean).join(" · ") || "ระบบร่างเอกสารและสารบรรณอิเล็กทรอนิกส์ วิทยาลัยการอาชีพเชียงราย"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 font-semibold ${
                summary?.resources.ai_copilot_enabled
                  ? "border-blue-200 bg-[#EFF6FF] text-[#1E3A8A]"
                  : "border-slate-300 bg-slate-100 text-slate-600"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              AI Co-pilot: {summary?.resources.ai_copilot_enabled ? "เปิดใช้งาน" : "ปิดชั่วคราว"}
            </span>
            <Link
              href="/profile"
              className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 font-semibold ${
                me?.signature_storage_path
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
              }`}
            >
              <PenTool className="h-3.5 w-3.5" />
              {me?.signature_storage_path ? "ลายเซ็นพร้อมใช้" : "ยังไม่อัปโหลดลายเซ็น"}
            </Link>
            <button
              type="button"
              onClick={() => loadDashboard(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1 font-semibold text-[#0F172A] hover:bg-slate-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              รีเฟรช
            </button>
          </div>
        </div>

        {/* Quick Start Action Tiles */}
        <div className="p-3.5 sm:p-4">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-xs font-bold text-[#475569]">ทางลัดเริ่มสร้างเอกสารใหม่</span>
            <span className="tabular-nums-th text-[11px] text-[#64748B]">
              คลังรายวิชา {summary?.resources.courses_count || 0} วิชา · แม่แบบกำหนดเอง {summary?.resources.custom_templates_count || 0} แบบ
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            {QUICK_LAUNCH.map((q) => {
              const Icon = q.icon;
              return (
                <Link
                  key={q.href}
                  href={q.href}
                  className="group flex flex-col justify-between rounded-md border border-[#CBD5E1] bg-white p-3 transition-colors hover:border-[#1D4ED8] hover:bg-[#EFF6FF]/40"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex h-8 w-8 items-center justify-center rounded border border-[#E2E8F0] bg-[#F8FAFC] text-[#1D4ED8] group-hover:border-blue-200 group-hover:bg-white">
                      <Icon className="h-4 w-4" />
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-[#94A3B8] transition-transform group-hover:translate-x-0.5 group-hover:text-[#1D4ED8]" />
                  </div>
                  <div className="mt-2.5">
                    <div className="text-xs font-bold text-[#0F172A]">{q.label}</div>
                    <div className="mt-0.5 truncate text-[11px] text-[#64748B]">{q.sub}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* 2. KPI Summary Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="ledger-panel p-4">
          <div className="flex items-center justify-between text-xs font-semibold text-[#475569]">
            <span>เอกสารทั้งหมด</span>
            <FileSpreadsheet className="h-4 w-4 text-[#64748B]" />
          </div>
          <div className="tabular-nums-th mt-2 text-2xl font-bold text-[#0F172A]">{counts.total}</div>
          <div className="tabular-nums-th mt-1 text-[11px] text-[#64748B]">
            รอตรวจ {counts.pending_review} · รออนุมัติ {counts.pending_approval}
          </div>
        </div>

        <Link
          href="/approvals"
          className={`ledger-panel block p-4 transition-colors hover:border-[#1D4ED8] ${
            myPendingTotal > 0 ? "border-blue-300 bg-[#EFF6FF]/40" : ""
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-[#1E3A8A]">
            <span>รอฉันดำเนินการ</span>
            <Clock className="h-4 w-4 text-[#1D4ED8]" />
          </div>
          <div className="tabular-nums-th mt-2 text-2xl font-bold text-[#1E3A8A]">{myPendingTotal}</div>
          <div className="tabular-nums-th mt-1 text-[11px] text-[#475569]">
            ตรวจ/อนุมัติ {queue.waiting_my_action.length} · รอออกเลข {queue.waiting_numbering.length}
          </div>
        </Link>

        <div
          className={`ledger-panel p-4 ${
            counts.needs_revision > 0 ? "border-amber-300 bg-amber-50/40" : ""
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-[#475569]">
            <span>ร่าง / แก้ไขของฉัน</span>
            <ClipboardList className="h-4 w-4 text-amber-700" />
          </div>
          <div className="tabular-nums-th mt-2 text-2xl font-bold text-[#0F172A]">
            {queue.my_drafts_or_revisions.length}
          </div>
          <div className="tabular-nums-th mt-1 text-[11px] text-[#64748B]">
            ส่งกลับแก้ไขทั้งระบบ {counts.needs_revision} ฉบับ
          </div>
        </div>

        <Link href="/registry" className="ledger-panel block p-4 transition-colors hover:border-emerald-600">
          <div className="flex items-center justify-between text-xs font-semibold text-emerald-800">
            <span>อนุมัติ &amp; ออกเลขแล้ว</span>
            <FileCheck2 className="h-4 w-4 text-emerald-700" />
          </div>
          <div className="tabular-nums-th mt-2 text-2xl font-bold text-emerald-800">
            {counts.approved + counts.numbered}
          </div>
          <div className="tabular-nums-th mt-1 text-[11px] text-[#475569]">
            ออกเลขแล้ว {counts.numbered} · รอออกเลข {counts.approved}
          </div>
        </Link>
      </div>

      {/* 3. Main 2-Column Ledger Grid */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* Left: Action Queue + Recent Documents */}
        <div className="space-y-5 xl:col-span-7">
          {/* Role Action Queue */}
          <section className="ledger-panel overflow-hidden">
            <div className="ledger-panel-header flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[#1D4ED8]" />
                <h3 className="text-sm font-bold text-[#0F172A]">คิวงานรอฉันดำเนินการ</h3>
              </div>
              <Link href="/approvals" className="text-xs font-semibold text-[#1D4ED8] hover:underline">
                เปิดหน้าตรวจลงนาม &rarr;
              </Link>
            </div>

            {/* Filter Strip */}
            <div className="flex flex-wrap gap-1.5 border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2 text-xs">
              <button
                type="button"
                onClick={() => setQueueTab("waiting_my_action")}
                className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${
                  queueTab === "waiting_my_action"
                    ? "bg-[#1D4ED8] text-white"
                    : "border border-[#CBD5E1] bg-white text-[#475569] hover:bg-slate-50"
                }`}
              >
                รอตรวจ/อนุมัติ ({queue.waiting_my_action.length})
              </button>
              <button
                type="button"
                onClick={() => setQueueTab("my_drafts_or_revisions")}
                className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${
                  queueTab === "my_drafts_or_revisions"
                    ? "bg-[#1D4ED8] text-white"
                    : "border border-[#CBD5E1] bg-white text-[#475569] hover:bg-slate-50"
                }`}
              >
                ร่าง / ส่งกลับแก้ไข ({queue.my_drafts_or_revisions.length})
              </button>
              {(isAdminOrDirector || queue.waiting_numbering.length > 0) && (
                <button
                  type="button"
                  onClick={() => setQueueTab("waiting_numbering")}
                  className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${
                    queueTab === "waiting_numbering"
                      ? "bg-[#1D4ED8] text-white"
                      : "border border-[#CBD5E1] bg-white text-[#475569] hover:bg-slate-50"
                  }`}
                >
                  รอออกเลขสารบรรณ ({queue.waiting_numbering.length})
                </button>
              )}
            </div>

            {activeQueueItems.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#475569]">
                ไม่มีเอกสารค้างในหมวดนี้ — สามารถเริ่มสร้างเอกสารใหม่ได้จากทางลัดด้านบน
              </div>
            ) : (
              <div className="divide-y divide-[#E2E8F0]">
                {activeQueueItems.map((item) => {
                  const st = STATUS_META[item.status] || {
                    label: item.status,
                    badge: "bg-slate-100 text-slate-700 border-slate-200",
                  };
                  return (
                    <Link
                      key={item.id}
                      href={`/approvals?doc=${encodeURIComponent(item.id)}`}
                      className="flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-[#F8FAFC] sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded border border-[#CBD5E1] bg-[#F8FAFC] px-1.5 py-0.5 text-[11px] font-semibold text-[#334155]">
                            {DOC_TYPE_LABELS[item.doc_type] || item.doc_type}
                          </span>
                          <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${st.badge}`}>
                            {st.label}
                          </span>
                          {item.division_code && (
                            <span className="text-[11px] font-semibold text-[#475569]">{item.division_code}</span>
                          )}
                        </div>
                        <div className="mt-1 truncate text-sm font-semibold text-[#0F172A]">{item.subject}</div>
                        <div className="mt-0.5 text-[11px] text-[#64748B]">
                          ผู้ร่าง: {item.created_by} · อัปเดต {formatShortDate(item.updated_at)}
                        </div>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#1D4ED8]">
                        เปิดจัดการ <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          {/* Recent Documents */}
          <section className="ledger-panel overflow-hidden">
            <div className="ledger-panel-header flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-[#1D4ED8]" />
                <h3 className="text-sm font-bold text-[#0F172A]">เอกสารล่าสุดในระบบ</h3>
              </div>
              <Link href="/registry" className="text-xs font-semibold text-[#1D4ED8] hover:underline">
                คลังเอกสารทั้งหมด &rarr;
              </Link>
            </div>

            {!summary?.recent_documents.length ? (
              <div className="p-8 text-center text-xs text-[#475569]">ยังไม่มีเอกสารที่บันทึกไว้ในระบบ</div>
            ) : (
              <>
                {/* Mobile (< md) Adaptive Cards */}
                <div className="divide-y divide-[#E2E8F0] md:hidden">
                  {summary.recent_documents.map((doc) => {
                    const st = STATUS_META[doc.status] || {
                      label: doc.status,
                      badge: "bg-slate-100 text-slate-700 border-slate-200",
                    };
                    return (
                      <div key={doc.id} className="space-y-1.5 p-3.5 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span className="rounded border border-[#CBD5E1] bg-[#F8FAFC] px-1.5 py-0.5 text-[11px] font-semibold text-[#334155]">
                            {DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}
                          </span>
                          <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${st.badge}`}>
                            {st.label}
                          </span>
                        </div>
                        <Link
                          href={`/approvals?doc=${encodeURIComponent(doc.id)}`}
                          className="block font-semibold text-[#0F172A] hover:text-[#1D4ED8]"
                        >
                          {doc.subject}
                        </Link>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#64748B]">
                          <span className="tabular-nums-th">
                            {doc.doc_number ? `เลขที่ ${doc.doc_number}` : "รอออกเลข"} · {formatShortDate(doc.updated_at)}
                          </span>
                          {doc.docx_path && (
                            <a
                              href={`${API_BASE}${doc.docx_path}?download=1`}
                              className="inline-flex items-center gap-1 font-semibold text-[#1D4ED8]"
                            >
                              <Download className="h-3 w-3" />
                              ดาวน์โหลด
                            </a>
                          )}
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
                        <th>ประเภท</th>
                        <th>เรื่อง / เลขที่</th>
                        <th>สถานะ</th>
                        <th>อัปเดต</th>
                        <th className="text-right">จัดการ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.recent_documents.map((doc) => {
                        const st = STATUS_META[doc.status] || {
                          label: doc.status,
                          badge: "bg-slate-100 text-slate-700 border-slate-200",
                        };
                        return (
                          <tr key={doc.id}>
                            <td>
                              <span className="rounded border border-[#CBD5E1] bg-[#F8FAFC] px-1.5 py-0.5 text-[11px] font-medium text-[#334155]">
                                {DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}
                              </span>
                            </td>
                            <td>
                              <Link
                                href={`/approvals?doc=${encodeURIComponent(doc.id)}`}
                                className="font-semibold text-[#0F172A] hover:text-[#1D4ED8] hover:underline"
                              >
                                {doc.subject}
                              </Link>
                              {doc.doc_number && (
                                <div className="tabular-nums-th text-[11px] font-semibold text-[#1E3A8A]">
                                  {doc.doc_number}
                                </div>
                              )}
                            </td>
                            <td>
                              <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${st.badge}`}>
                                {st.label}
                              </span>
                            </td>
                            <td className="tabular-nums-th whitespace-nowrap text-[#64748B]">
                              {formatShortDate(doc.updated_at)}
                            </td>
                            <td className="text-right">
                              <div className="flex justify-end gap-2">
                                {doc.docx_path && (
                                  <a
                                    href={`${API_BASE}${doc.docx_path}?download=1`}
                                    className="font-semibold text-[#475569] hover:text-[#0F172A]"
                                  >
                                    ไฟล์
                                  </a>
                                )}
                                <Link
                                  href={`/approvals?doc=${encodeURIComponent(doc.id)}`}
                                  className="font-semibold text-[#1D4ED8] hover:underline"
                                >
                                  ตรวจ
                                </Link>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </div>

        {/* Right: Breakdown, Running Sequences, Profile Readiness & Activity */}
        <div className="space-y-5 xl:col-span-5">
          {/* Document Breakdown */}
          <section className="ledger-panel overflow-hidden">
            <div className="ledger-panel-header">
              <h3 className="text-sm font-bold text-[#0F172A]">สัดส่วนเอกสารแยกตามประเภท</h3>
            </div>
            <div className="space-y-3 p-4 text-xs">
              {!summary?.by_type.length ? (
                <div className="py-4 text-center text-[#475569]">ยังไม่มีสถิติเอกสาร</div>
              ) : (
                summary.by_type.slice(0, 6).map((row) => {
                  const pct = counts.total > 0 ? Math.round((row.count / counts.total) * 100) : 0;
                  return (
                    <div key={row.key}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="font-semibold text-[#0F172A]">{row.label}</span>
                        <span className="tabular-nums-th text-[#475569]">
                          {row.count} ฉบับ ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[#E2E8F0]">
                        <div
                          className="h-full rounded-full bg-[#1D4ED8]"
                          style={{ width: `${Math.max(pct, 4)}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}

              {summary?.by_division.length ? (
                <div className="border-t border-[#E2E8F0] pt-3">
                  <div className="mb-2 text-[11px] font-bold text-[#475569]">จำแนกตามฝ่ายงาน</div>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.by_division.map((d) => (
                      <span
                        key={d.code}
                        className="tabular-nums-th rounded border border-[#CBD5E1] bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-semibold text-[#0F172A]"
                      >
                        {d.code}: {d.count}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          {/* Latest Registry Running Numbers */}
          <section className="ledger-panel overflow-hidden">
            <div className="ledger-panel-header flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BookOpenCheck className="h-4 w-4 text-[#1D4ED8]" />
                <h3 className="text-sm font-bold text-[#0F172A]">เลขสารบรรณล่าสุด &amp; เลขถัดไป</h3>
              </div>
              <Link href="/registry" className="text-xs font-semibold text-[#1D4ED8] hover:underline">
                ตั้งค่าเลขรัน &rarr;
              </Link>
            </div>
            <div className="divide-y divide-[#E2E8F0] text-xs">
              {(summary?.sequences || []).slice(0, 6).map((seq) => (
                <div key={seq.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-[#0F172A]">{seq.registry_name}</div>
                    <div className="tabular-nums-th text-[11px] text-[#64748B]">
                      ออกไปแล้ว {seq.last_number} (พ.ศ. {seq.year_be})
                    </div>
                  </div>
                  <span className="tabular-nums-th shrink-0 rounded border border-blue-200 bg-[#EFF6FF] px-2 py-1 font-bold text-[#1E3A8A]">
                    ถัดไป: {seq.next_formatted}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Profile Readiness Card */}
          <section className="ledger-panel overflow-hidden">
            <div className="ledger-panel-header flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <UserCog className="h-4 w-4 text-[#1D4ED8]" />
                <h3 className="text-sm font-bold text-[#0F172A]">ความพร้อมข้อมูลโปรไฟล์</h3>
              </div>
              <span className="tabular-nums-th text-xs font-bold text-[#1E3A8A]">
                {completedChecks}/{profileChecks.length}
              </span>
            </div>
            <div className="space-y-2.5 p-4 text-xs">
              <div className="flex flex-wrap gap-1.5">
                {profileChecks.map((item) => (
                  <span
                    key={item.label}
                    className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-semibold ${
                      item.ok
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 bg-slate-50 text-[#64748B]"
                    }`}
                  >
                    <BadgeCheck className="h-3 w-3" />
                    {item.label}
                  </span>
                ))}
              </div>
              <Link
                href="/profile"
                className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-[#F8FAFC] px-3 py-1.5 font-semibold text-[#0F172A] hover:bg-slate-100"
              >
                <FileBadge className="h-3.5 w-3.5 text-[#1D4ED8]" />
                จัดการโปรไฟล์และลายเซ็น PNG
              </Link>
            </div>
          </section>

          {/* Recent Audit Activity */}
          <section className="ledger-panel overflow-hidden">
            <div className="ledger-panel-header flex items-center gap-2">
              <Activity className="h-4 w-4 text-[#1D4ED8]" />
              <h3 className="text-sm font-bold text-[#0F172A]">กิจกรรมล่าสุด</h3>
            </div>
            {!summary?.recent_activity.length ? (
              <div className="p-6 text-center text-xs text-[#475569]">ยังไม่มีบันทึกกิจกรรมล่าสุด</div>
            ) : (
              <div className="divide-y divide-[#E2E8F0] text-xs">
                {summary.recent_activity.slice(0, 6).map((act) => (
                  <div key={act.id} className="flex items-start justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0">
                      <span className="font-semibold text-[#1E3A8A]">
                        {EVENT_LABELS[act.event_type] || act.event_type}
                      </span>
                      <div className="truncate text-[11px] text-[#475569]">{act.actor_email}</div>
                    </div>
                    <span className="tabular-nums-th shrink-0 text-[11px] text-[#64748B]">
                      {formatShortDate(act.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
