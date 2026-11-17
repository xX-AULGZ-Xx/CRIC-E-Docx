"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Bell,
  Check,
  CheckCheck,
  FileBadge,
  FileCheck2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react";
import { api, NotificationRecord } from "@/lib/api";
import { toastError, toastSuccess } from "@/lib/swal";

function renderEventBadge(eventType: string) {
  if (eventType === "approved") {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
        <FileCheck2 className="h-3 w-3" /> อนุมัติแล้ว
      </span>
    );
  }
  if (eventType === "returned") {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-[#B91C1C]">
        <RotateCcw className="h-3 w-3" /> ส่งกลับแก้ไข
      </span>
    );
  }
  if (eventType === "numbered") {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-blue-200 bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-semibold text-[#1E3A8A]">
        <FileBadge className="h-3 w-3" /> ออกเลขสารบรรณ
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
      <Send className="h-3 w-3" /> รอพิจารณา
    </span>
  );
}

function formatDateTime(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return d.toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NotificationsPage() {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listNotifications(filter === "unread", 100);
      setItems(res.notifications);
      setUnreadCount(res.unread_count);
    } catch (err) {
      toastError("โหลดแจ้งเตือนไม่สำเร็จ", err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadList();
    const handler = () => loadList();
    window.addEventListener("cric-user-changed", handler);
    window.addEventListener("cric-notifications-changed", handler);
    return () => {
      window.removeEventListener("cric-user-changed", handler);
      window.removeEventListener("cric-notifications-changed", handler);
    };
  }, [loadList]);

  async function handleMarkRead(id: string) {
    try {
      await api.markNotificationRead(id);
      await loadList();
    } catch {
      // ignore
    }
  }

  async function handleMarkAllRead() {
    setBusy(true);
    try {
      await api.markAllNotificationsRead();
      toastSuccess("ทำเครื่องหมายว่าอ่านทั้งหมดแล้ว");
      await loadList();
    } catch (err) {
      toastError("ดำเนินการไม่สำเร็จ", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteNotification(id);
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch (err) {
      toastError("ลบรายการไม่สำเร็จ", err instanceof Error ? err.message : undefined);
    }
  }

  return (
    <div className="space-y-4">
      <div className="ledger-panel flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              filter === "all"
                ? "bg-[#1D4ED8] text-white"
                : "border border-[#CBD5E1] bg-white text-[#475569] hover:bg-slate-50"
            }`}
          >
            ทั้งหมด
          </button>
          <button
            type="button"
            onClick={() => setFilter("unread")}
            className={`tabular-nums-th rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              filter === "unread"
                ? "bg-[#1D4ED8] text-white"
                : "border border-[#CBD5E1] bg-white text-[#475569] hover:bg-slate-50"
            }`}
          >
            ยังไม่อ่าน ({unreadCount})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => loadList()}
            className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-semibold text-[#0F172A] hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            รีเฟรช
          </button>
          {unreadCount > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={handleMarkAllRead}
              className="inline-flex items-center gap-1 rounded-md bg-[#0F172A] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1E293B] disabled:opacity-50"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              อ่านทั้งหมดแล้ว
            </button>
          )}
        </div>
      </div>

      <section className="ledger-panel overflow-hidden">
        <div className="ledger-panel-header flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-[#1D4ED8]" />
            <h2 className="text-sm font-bold text-[#0F172A]">กล่องแจ้งเตือนของฉัน</h2>
          </div>
          <span className="tabular-nums-th text-xs text-[#475569]">{items.length} รายการ</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-xs text-[#475569]">
            <Loader2 className="h-4 w-4 animate-spin text-[#1D4ED8]" />
            กำลังโหลดการแจ้งเตือน...
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-xs text-[#475569]">
            {filter === "unread" ? "ไม่มีการแจ้งเตือนที่ยังไม่ได้อ่าน" : "ยังไม่มีประวัติการแจ้งเตือนในบัญชีนี้"}
          </div>
        ) : (
          <div className="divide-y divide-[#E2E8F0]">
            {items.map((n) => (
              <div
                key={n.id}
                className={`flex flex-col gap-3 border-l-[3px] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between ${
                  !n.is_read ? "border-[#1D4ED8] bg-[#EFF6FF]/45" : "border-transparent bg-white"
                }`}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {renderEventBadge(n.event_type)}
                    <span className="tabular-nums-th text-[11px] text-[#64748B]">
                      {formatDateTime(n.created_at)}
                    </span>
                    {!n.is_read && (
                      <span className="rounded bg-[#1D4ED8] px-1.5 py-0.5 text-[10px] font-bold text-white">ใหม่</span>
                    )}
                  </div>
                  <div className="text-sm font-semibold text-[#0F172A]">{n.title}</div>
                  {n.message && <p className="text-xs text-[#475569]">{n.message}</p>}
                  {n.actor_email && (
                    <div className="text-[11px] text-[#64748B]">ผู้ดำเนินการ: {n.actor_email}</div>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Link
                    href={n.link_url || "/approvals"}
                    onClick={() => {
                      if (!n.is_read) handleMarkRead(n.id);
                    }}
                    className="inline-flex items-center gap-1 rounded-md bg-[#1D4ED8] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1E40AF]"
                  >
                    เปิดเอกสาร <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                  {!n.is_read && (
                    <button
                      type="button"
                      onClick={() => handleMarkRead(n.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0F172A] hover:bg-slate-50"
                      title="ทำเครื่องหมายว่าอ่านแล้ว"
                    >
                      <Check className="h-3.5 w-3.5 text-emerald-700" />
                      อ่านแล้ว
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(n.id)}
                    className="rounded-md border border-red-200 bg-white p-1.5 text-slate-500 hover:bg-red-50 hover:text-[#B91C1C]"
                    aria-label="ลบการแจ้งเตือนนี้"
                    title="ลบการแจ้งเตือนนี้"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
