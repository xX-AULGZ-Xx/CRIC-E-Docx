"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle, Download, Eye, FileBadge, RotateCcw, Search, Upload, UserCog } from "lucide-react";
import { DocumentPreviewPanel } from "@/components/DocumentPreviewPanel";
import { ResponsivePreviewModal } from "@/components/ResponsivePreviewModal";
import { api, API_BASE, BundleFileInfo, DocumentRecord, UserProfile } from "@/lib/api";
import { confirmAction, promptRevisionReason, toastError, toastSuccess } from "@/lib/swal";

const DIVISION_TABS = [
  { code: "ALL", label: "ทั้งหมด" },
  { code: "ฝบ.", label: "ฝ่ายบริหารทรัพย์ (ฝบ.)" },
  { code: "ฝว.", label: "ฝ่ายวิชาการ (ฝว.)" },
  { code: "ฝก.", label: "ฝ่ายพัฒนา (ฝก.)" },
  { code: "ฝย.", label: "ฝ่ายแผน (ฝย.)" },
] as const;

const DOC_TYPE_THAI: Record<string, string> = {
  memo: "บันทึกข้อความ",
  external: "หนังสือภายนอก",
  order: "คำสั่ง",
  announcement: "ประกาศ",
  agenda: "ระเบียบวาระ",
  minutes: "รายงานประชุม",
  sp_bundle: "ชุดจัดซื้อ / สผ.",
  course_syllabus: "กำหนดการสอน",
  lesson_plan: "แผนการสอน",
  post_teaching_normal: "หลังสอนปกติ",
  post_teaching_online: "หลังสอนออนไลน์",
  custom_template: "แม่แบบกำหนดเอง",
  vehicle_request: "ขอใช้รถ",
  official_travel: "ขอไปราชการ",
  repair_request: "แจ้งซ่อม",
  overload_teaching: "เบิกค่าสอนเกิน",
  internship_supervision: "นิเทศฝึกงาน",
  home_visit: "เยี่ยมบ้านนักเรียน",
  project_summary: "สรุปโครงการ",
  single_plan_summary: "สรุปแผนเดี่ยว",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "ร่าง",
  pending_review: "รอตรวจทาน",
  needs_revision: "ต้องแก้ไข",
  pending_approval: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  numbered: "ออกเลขแล้ว",
};

const STATUS_BADGES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  pending_review: "bg-amber-100 text-amber-800",
  needs_revision: "bg-red-100 text-red-800",
  pending_approval: "bg-indigo-100 text-indigo-800",
  approved: "bg-emerald-100 text-emerald-800",
  numbered: "bg-blue-100 text-blue-900",
};

export default function ApprovalsPage() {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [selected, setSelected] = useState<DocumentRecord | null>(null);
  const [me, setMe] = useState<UserProfile | null>(null);
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(1);
  const [selectedBundleIdx, setSelectedBundleIdx] = useState(0);
  const [mobileReviewOpen, setMobileReviewOpen] = useState(false);
  const [activeDivision, setActiveDivision] = useState<string>("ALL");
  const [divisionInitialized, setDivisionInitialized] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [divisionCounts, setDivisionCounts] = useState<Record<string, { total: number; pending: number }>>({});

  const selectedBundleFiles = ((selected?.payload_json?.bundle_files as BundleFileInfo[] | undefined) || []);
  const selectedZipUrl = (selected?.payload_json?.zip_url as string | undefined) || "";
  const activeBundleFile = selectedBundleFiles[selectedBundleIdx] || null;

  const isGlobalViewer = me?.role === "director" || me?.role === "saraban_admin";
  const allowedDivisions = useMemo(() => {
    if (!me || isGlobalViewer) return new Set(["ฝบ.", "ฝว.", "ฝก.", "ฝย."]);
    const s = new Set<string>(me.division_codes || []);
    if (me.division_code) s.add(me.division_code);
    return s;
  }, [me, isGlobalViewer]);

  const visibleDivisionTabs = useMemo(() => {
    if (!me || isGlobalViewer) return DIVISION_TABS;
    return DIVISION_TABS.filter(
      (t) => (t.code === "ALL" && allowedDivisions.size !== 1) || allowedDivisions.has(t.code)
    );
  }, [me, isGlobalViewer, allowedDivisions]);

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const myIdents = new Set([me?.email?.toLowerCase(), me?.username?.toLowerCase()].filter(Boolean) as string[]);
    return docs.filter((d) => {
      if (activeDivision !== "ALL" && (d.division_code || "") !== activeDivision) return false;
      if (statusFilter === "MY_QUEUE") {
        const isPending = d.status === "pending_review" || d.status === "pending_approval";
        const assignedToMe = (d.approval_steps || []).some(
          (st) => st.action === "pending" && myIdents.has((st.assignee_email || "").toLowerCase())
        );
        if (!isPending && !assignedToMe) return false;
        if ((d.approval_steps || []).length > 0 && !assignedToMe && !isGlobalViewer) return false;
      } else if (statusFilter === "approved_done") {
        if (d.status !== "approved" && d.status !== "numbered") return false;
      } else if (statusFilter !== "ALL" && d.status !== statusFilter) {
        return false;
      }
      if (q) {
        const hay = `${d.subject} ${d.doc_number || ""} ${d.created_by || ""} ${DOC_TYPE_THAI[d.doc_type] || d.doc_type}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [docs, activeDivision, statusFilter, searchQuery, me, isGlobalViewer]);

  async function refresh() {
    try {
      const [meRes, docsRes] = await Promise.all([api.me(), api.listDocuments()]);
      setMe(meRes.user);
      setDocs(docsRes.documents);
      if (docsRes.division_counts) setDivisionCounts(docsRes.division_counts);

      let queryDiv: string | null = null;
      let queryDocId: string | null = null;
      try {
        const sp = new URLSearchParams(window.location.search);
        queryDocId = sp.get("doc");
        queryDiv = sp.get("division");
      } catch {
        // ignore
      }

      let initialDiv = activeDivision;
      if (!divisionInitialized) {
        const u = meRes.user;
        const isGlobal = u.role === "director" || u.role === "saraban_admin";
        const userDivs = Array.from(new Set([...(u.division_codes || []), ...(u.division_code ? [u.division_code] : [])].filter(Boolean)));
        if (queryDiv && (isGlobal || userDivs.includes(queryDiv))) {
          initialDiv = queryDiv;
        } else if (!isGlobal && userDivs.length === 1) {
          initialDiv = userDivs[0];
        } else {
          initialDiv = "ALL";
        }
        setActiveDivision(initialDiv);
        setDivisionInitialized(true);
      }

      if (queryDocId && !selected) {
        const deepLinked = docsRes.documents.find((d) => d.id === queryDocId) || null;
        if (deepLinked) {
          setSelected(deepLinked);
          if (typeof window !== "undefined" && window.innerWidth < 1280) {
            setMobileReviewOpen(true);
          }
          return;
        }
      }

      if (selected) {
        const updated = docsRes.documents.find((d) => d.id === selected.id) || null;
        setSelected(updated);
      } else if (docsRes.documents.length > 0) {
        const firstInDiv = docsRes.documents.find((d) => initialDiv === "ALL" || d.division_code === initialDiv) || docsRes.documents[0];
        setSelected(firstInDiv);
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    refresh();
    const handler = () => refresh();
    window.addEventListener("cric-user-changed", handler);
    window.addEventListener("cric-profile-updated", handler);
    return () => {
      window.removeEventListener("cric-user-changed", handler);
      window.removeEventListener("cric-profile-updated", handler);
    };
  }, []);

  async function handleSignatureUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await api.uploadSignature(file);
      const successText = "อัปโหลดภาพลายเซ็น PNG สำเร็จ พร้อมใช้สำหรับกดอนุมัติ";
      setMsg(successText);
      toastSuccess("อัปโหลดลายเซ็นสำเร็จ", successText);
      await refresh();
    } catch (err) {
      const errText = err instanceof Error ? err.message : "อัปโหลดลายเซ็นไม่สำเร็จ";
      setMsg(errText);
      toastError("อัปโหลดลายเซ็นไม่สำเร็จ", errText);
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    if (!selected) return;
    const ok = await confirmAction({
      title: "ยืนยันการอนุมัติและประทับลายเซ็น",
      text: `เรื่อง "${selected.subject}" — ระบบจะประทับลายเซ็นอิเล็กทรอนิกส์ลงบนเอกสารฉบับจริง`,
      confirmText: "อนุมัติและประทับลายเซ็น",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await api.approveDocument(selected.id, comment, true);
      setSelected(res.document);
      setPreviewVersion((v) => v + 1);
      const successText = "อนุมัติและประทับลายเซ็นเรียบร้อยแล้ว";
      setMsg(successText);
      toastSuccess("อนุมัติเอกสารสำเร็จ", selected.subject);
      await refresh();
    } catch (err) {
      const errText = err instanceof Error ? err.message : "อนุมัติไม่สำเร็จ";
      setMsg(errText);
      toastError("อนุมัติไม่สำเร็จ", errText);
    } finally {
      setBusy(false);
    }
  }

  async function handleReturn() {
    if (!selected) return;
    const reason = comment.trim()
      ? (await confirmAction({
          title: "ยืนยันส่งกลับแก้ไข?",
          text: `หมายเหตุ: ${comment.trim()}`,
          confirmText: "ส่งกลับแก้ไข",
          icon: "warning",
        }))
        ? comment.trim()
        : null
      : await promptRevisionReason();
    if (!reason) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await api.returnDocument(selected.id, reason);
      setSelected(res.document);
      setComment("");
      setMsg("ส่งกลับเอกสารให้ผู้ร่างแก้ไขแล้ว");
      toastSuccess("ส่งกลับแก้ไขเรียบร้อย", reason);
      await refresh();
    } catch (err) {
      const errText = err instanceof Error ? err.message : "ส่งกลับไม่สำเร็จ";
      setMsg(errText);
      toastError("ส่งกลับไม่สำเร็จ", errText);
    } finally {
      setBusy(false);
    }
  }

  async function handleNumbering() {
    if (!selected) return;
    const ok = await confirmAction({
      title: "ยืนยันออกเลขสารบรรณจริง?",
      text: `ระบบจะรันเลขทะเบียนคุมถัดไปและประทับเลขลงบน "${selected.subject}" ทันที`,
      confirmText: "ออกเลขสารบรรณ",
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await api.numberDocument(selected.id);
      setSelected(res.document);
      setPreviewVersion((v) => v + 1);
      const successText = `ออกเลขสารบรรณสำเร็จ: ${res.document.doc_number}`;
      setMsg(successText);
      toastSuccess("ออกเลขสารบรรณแล้ว", res.document.doc_number || undefined);
      await refresh();
    } catch (err) {
      const errText = err instanceof Error ? err.message : "ออกเลขไม่สำเร็จ";
      setMsg(errText);
      toastError("ออกเลขไม่สำเร็จ", errText);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="ledger-panel flex flex-wrap items-center justify-between gap-4 px-5 py-3.5">
        <div>
          <h2 className="text-sm font-bold text-[#0F172A]">กล่องตรวจร่าง เสนอลงนาม และออกเลขสารบรรณ</h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-[#475569]">
            <span>
              ผู้ใช้งาน: <strong className="font-semibold text-[#0F172A]">{me?.full_name || "-"}</strong> ({me?.position_title || "-"})
            </span>
            <span
              className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold ${
                me?.signature_storage_path
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              {me?.signature_storage_path ? "ลายเซ็นอิเล็กทรอนิกส์พร้อมใช้งาน" : "ยังไม่ได้อัปโหลดภาพลายเซ็น"}
            </span>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Link
            href="/profile"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs font-semibold text-[#0F172A] hover:bg-slate-50 sm:flex-initial sm:py-1.5"
          >
            <UserCog className="h-3.5 w-3.5 text-[#1D4ED8]" />
            โปรไฟล์ &amp; ดูลายเซ็น
          </Link>
          <label className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border border-[#CBD5E1] bg-[#F8FAFC] px-3 py-2 text-xs font-semibold text-[#0F172A] hover:bg-slate-100 sm:flex-initial sm:py-1.5">
            <Upload className="h-3.5 w-3.5 text-[#1D4ED8]" />
            อัปโหลดภาพลายเซ็น (.PNG โปร่งใส)
            <input type="file" accept="image/png,image/jpeg" onChange={handleSignatureUpload} className="hidden" />
          </label>
        </div>
      </div>

      {msg && (
        <div className="rounded-md border border-blue-300 bg-[#EFF6FF] px-4 py-2.5 text-sm font-medium text-[#1E3A8A]">
          {msg}
        </div>
      )}

      {/* Division Tabs Bar */}
      <div className="ledger-panel flex items-center gap-1.5 overflow-x-auto px-3 py-2.5">
        {visibleDivisionTabs.map((dt) => {
          const active = activeDivision === dt.code;
          const totalCount =
            dt.code === "ALL"
              ? docs.length
              : divisionCounts[dt.code]?.total ?? docs.filter((d) => d.division_code === dt.code).length;
          const pendingCount =
            dt.code === "ALL"
              ? docs.filter((d) => d.status === "pending_review" || d.status === "pending_approval").length
              : divisionCounts[dt.code]?.pending ??
                docs.filter((d) => d.division_code === dt.code && (d.status === "pending_review" || d.status === "pending_approval")).length;
          return (
            <button
              key={dt.code}
              type="button"
              onClick={() => {
                setActiveDivision(dt.code);
                const nextInTab = docs.find((d) => dt.code === "ALL" || d.division_code === dt.code) || null;
                setSelected(nextInTab);
                setSelectedBundleIdx(0);
              }}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                active
                  ? "bg-[#1D4ED8] text-white shadow-xs"
                  : "border border-[#E2E8F0] bg-[#F8FAFC] text-[#334155] hover:bg-slate-100"
              }`}
            >
              <span>{dt.label}</span>
              <span
                className={`tabular-nums-th rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  active ? "bg-white/20 text-white" : "bg-slate-200 text-[#0F172A]"
                }`}
              >
                {totalCount}
              </span>
              {pendingCount > 0 && (
                <span
                  className={`tabular-nums-th rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    active ? "bg-amber-300 text-[#0F172A]" : "bg-amber-100 text-amber-800"
                  }`}
                  title="รอดำเนินการ"
                >
                  รอ {pendingCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="ledger-panel overflow-hidden xl:col-span-5">
          <div className="ledger-panel-header flex items-center justify-between">
            <span className="text-xs font-bold text-[#0F172A]">
              รายการเอกสาร ({DIVISION_TABS.find((t) => t.code === activeDivision)?.label || "ทั้งหมด"})
            </span>
            <span className="tabular-nums-th text-xs text-[#475569]">{filteredDocs.length} ฉบับ</span>
          </div>
          <div className="space-y-2 border-b border-[#E2E8F0] bg-[#F8FAFC] p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[#64748B]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาชื่อเรื่อง, เลขที่หนังสือ, ผู้ร่าง..."
                className="ledger-input w-full py-1.5 pl-8 text-xs"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {[
                { id: "ALL", label: "ทั้งหมด" },
                { id: "MY_QUEUE", label: "คิวงานของฉัน" },
                { id: "pending_review", label: "รอตรวจทาน" },
                { id: "pending_approval", label: "รออนุมัติ" },
                { id: "needs_revision", label: "ต้องแก้ไข" },
                { id: "approved_done", label: "อนุมัติแล้ว" },
              ].map((sf) => (
                <button
                  key={sf.id}
                  type="button"
                  onClick={() => setStatusFilter(sf.id)}
                  className={`rounded px-2 py-1 text-[11px] font-semibold transition ${
                    statusFilter === sf.id
                      ? "bg-[#0F172A] text-white"
                      : "border border-[#CBD5E1] bg-white text-[#475569] hover:bg-slate-50"
                  }`}
                >
                  {sf.label}
                </button>
              ))}
            </div>
          </div>
          {filteredDocs.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#475569]">
              ไม่พบเอกสารในหมวด/ตัวกรองนี้ ไปที่หน้า{" "}
              <Link href="/draft" className="font-semibold text-[#1D4ED8] hover:underline">
                &ldquo;ร่างเอกสาร&rdquo;
              </Link>{" "}
              หรือ{" "}
              <Link href="/divisions" className="font-semibold text-[#1D4ED8] hover:underline">
                &ldquo;เอกสารประจำ 4 ฝ่าย&rdquo;
              </Link>{" "}
              เพื่อสร้างและส่งเอกสาร
            </div>
          ) : (
            <div className="divide-y divide-[#E2E8F0]">
              {filteredDocs.map((doc) => {
                const isSelected = selected?.id === doc.id;
                return (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => {
                      setSelected(doc);
                      setSelectedBundleIdx(0);
                      setMobileReviewOpen(true);
                    }}
                    className={`w-full border-l-[3px] px-4 py-3 text-left transition-colors ${
                      isSelected
                        ? "border-[#1D4ED8] bg-[#EFF6FF]/60"
                        : "border-transparent bg-white hover:bg-[#F8FAFC]"
                    }`}
                  >
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {doc.division_code && (
                          <span className="rounded bg-[#0F172A] px-1.5 py-0.5 text-[10px] font-bold text-white">
                            {doc.division_code}
                          </span>
                        )}
                        <span className="rounded border border-[#CBD5E1] bg-[#F8FAFC] px-1.5 py-0.5 text-[11px] font-semibold text-[#334155]">
                          {DOC_TYPE_THAI[doc.doc_type] || doc.doc_type}
                        </span>
                      </div>
                      <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGES[doc.status] || "bg-slate-100"}`}>
                        {STATUS_LABELS[doc.status] || doc.status}
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-[#0F172A]">{doc.subject}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-[#475569]">
                      <span>ผู้ร่าง: {doc.created_by}</span>
                      {doc.doc_number && <span className="tabular-nums-th font-semibold text-[#1E3A8A]">เลขที่ {doc.doc_number}</span>}
                    </div>
                    {isSelected && (
                      <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-[#1D4ED8] xl:hidden">
                        <Eye className="h-3 w-3" />
                        แตะเพื่อเปิดตรวจและลงนาม
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selected ? (
          <ResponsivePreviewModal
            open={mobileReviewOpen}
            onOpenChange={setMobileReviewOpen}
            desktopColClass="xl:col-span-7"
            title={selected.subject}
            triggerLabel="ตรวจเอกสารที่เลือก"
            pageCount={(activeBundleFile ? activeBundleFile.page_image_urls : selected.page_image_urls)?.length || 0}
            hasPreview={Boolean(activeBundleFile ? activeBundleFile.file_url : selected.docx_path)}
            topContent={
              <div className="ledger-panel overflow-hidden">
                <div className="ledger-panel-header flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-[#0F172A] sm:text-base">{selected.subject}</h3>
                    <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-[#475569]">
                      <span>ฟอนต์ {selected.font_family}</span>
                      <span className="tabular-nums-th font-semibold text-[#0F172A]">
                        เลขที่หนังสือ: {selected.doc_number || "รอออกเลขสารบรรณ"}
                      </span>
                    </div>
                  </div>
                  {selectedZipUrl && (
                    <a
                      href={`${API_BASE}${selectedZipUrl}?download=1`}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[#0F172A] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1E293B]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      ดาวน์โหลดทั้งชุด (.ZIP)
                    </a>
                  )}
                </div>

                {selectedBundleFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 border-t border-[#E2E8F0] p-3">
                    {selectedBundleFiles.map((bf, idx) => (
                      <button
                        key={bf.key}
                        type="button"
                        onClick={() => setSelectedBundleIdx(idx)}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                          idx === selectedBundleIdx
                            ? "bg-[#1D4ED8] text-white"
                            : "border border-[#CBD5E1] bg-[#F8FAFC] text-[#334155] hover:bg-slate-100"
                        }`}
                      >
                        {bf.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            }
            footerSlot={
              <div className="ledger-panel space-y-3 p-3.5 sm:p-4">
                <input
                  type="text"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="บันทึกความเห็นหรือหมายเหตุการตรวจร่าง..."
                  className="ledger-input"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleApprove}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 sm:flex-initial sm:text-sm"
                  >
                    <CheckCircle className="h-4 w-4" />
                    อนุมัติและประทับลายเซ็น
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleReturn}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[#B91C1C] bg-white px-3.5 py-2 text-xs font-semibold text-[#B91C1C] hover:bg-red-50 disabled:opacity-50 sm:flex-initial sm:text-sm"
                  >
                    <RotateCcw className="h-4 w-4" />
                    ส่งกลับแก้ไข
                  </button>
                  {(me?.role === "saraban_admin" || me?.role === "director") && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleNumbering}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[#1D4ED8] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-50 sm:w-auto sm:text-sm"
                    >
                      <FileBadge className="h-4 w-4" />
                      ออกเลขสารบรรณอัตโนมัติ
                    </button>
                  )}
                </div>
              </div>
            }
          >
            <DocumentPreviewPanel
              fontFamily={selected.font_family}
              docxUrl={activeBundleFile ? activeBundleFile.file_url : selected.docx_path}
              pdfUrl={activeBundleFile ? activeBundleFile.pdf_url : selected.pdf_path}
              pageImageUrls={activeBundleFile ? activeBundleFile.page_image_urls : selected.page_image_urls}
              versionKey={previewVersion}
            />
          </ResponsivePreviewModal>
        ) : (
          <div className="hidden xl:block xl:col-span-7">
            <div className="ledger-panel p-12 text-center text-sm text-[#475569]">
              เลือกรายการเอกสารจากคิวด้านซ้ายเพื่อตรวจทานและลงนาม
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
