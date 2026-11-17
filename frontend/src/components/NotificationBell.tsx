"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, FileCheck2, FileBadge, RotateCcw, Send } from "lucide-react";
import { api, NotificationRecord } from "@/lib/api";
import { toastInfo } from "@/lib/swal";

function eventIcon(eventType: string) {
  if (eventType === "approved") return <FileCheck2 className="h-4 w-4 text-emerald-700" />;
  if (eventType === "returned") return <RotateCcw className="h-4 w-4 text-[#B91C1C]" />;
  if (eventType === "numbered") return <FileBadge className="h-4 w-4 text-[#1D4ED8]" />;
  return <Send className="h-4 w-4 text-amber-700" />;
}

function formatShortTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return d.toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [busyAll, setBusyAll] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const refreshList = useCallback(async () => {
    try {
      const res = await api.listNotifications(false, 15);
      setUnreadCount(res.unread_count);
      setItems(res.notifications);
      for (const n of res.notifications) seenIdsRef.current.add(n.id);
    } catch {
      // ignore transient error
    }
  }, []);

  useEffect(() => {
    let closeStream = () => {};

    const startStream = () => {
      closeStream();
      seenIdsRef.current = new Set();
      closeStream = api.subscribeNotificationStream({
        onSnapshot: (snap) => {
          setUnreadCount(snap.unread_count);
          setItems(snap.notifications);
          for (const n of snap.notifications) seenIdsRef.current.add(n.id);
        },
        onNotification: (ev) => {
          setUnreadCount(ev.unread_count);
          const n = ev.notification;
          setItems((prev) => {
            const withoutDup = prev.filter((x) => x.id !== n.id);
            return [n, ...withoutDup].slice(0, 15);
          });
          if (!seenIdsRef.current.has(n.id)) {
            seenIdsRef.current.add(n.id);
            toastInfo(n.title, n.message || undefined);
          }
        },
      });
    };

    startStream();

    const onUserChanged = () => {
      setOpen(false);
      startStream();
    };
    const onNotifsChanged = () => refreshList();

    window.addEventListener("cric-user-changed", onUserChanged);
    window.addEventListener("cric-notifications-changed", onNotifsChanged);
    return () => {
      closeStream();
      window.removeEventListener("cric-user-changed", onUserChanged);
      window.removeEventListener("cric-notifications-changed", onNotifsChanged);
    };
  }, [refreshList]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    window.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  async function handleOpenItem(n: NotificationRecord) {
    setOpen(false);
    if (!n.is_read) {
      try {
        const res = await api.markNotificationRead(n.id);
        setUnreadCount(res.unread_count);
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      } catch {
        // ignore
      }
    }
    router.push(n.link_url || "/approvals");
  }

  async function handleMarkAllRead() {
    setBusyAll(true);
    try {
      await api.markAllNotificationsRead();
      setUnreadCount(0);
      setItems((prev) => prev.map((x) => ({ ...x, is_read: true })));
    } catch {
      // ignore
    } finally {
      setBusyAll(false);
    }
  }

  const badgeLabel = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="การแจ้งเตือน"
        aria-expanded={open}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#CBD5E1] bg-white text-[#334155] transition-colors hover:bg-slate-50 hover:text-[#0F172A]"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="tabular-nums-th absolute -right-1.5 -top-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-[#B91C1C] px-1 text-[10px] font-bold leading-4 text-white shadow-sm">
            {badgeLabel}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-x-3 top-16 z-40 overflow-hidden rounded-lg border border-[#CBD5E1] bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96"
          role="dialog"
          aria-label="รายการแจ้งเตือนล่าสุด"
        >
          <div className="flex items-center justify-between border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#0F172A]">การแจ้งเตือน</span>
              {unreadCount > 0 && (
                <span className="tabular-nums-th rounded bg-[#EFF6FF] px-1.5 py-0.5 text-[11px] font-bold text-[#1E3A8A]">
                  ใหม่ {unreadCount}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                disabled={busyAll}
                onClick={handleMarkAllRead}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1D4ED8] hover:underline disabled:opacity-50"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                อ่านทั้งหมด
              </button>
            )}
          </div>

          <div className="max-h-[60dvh] divide-y divide-[#E2E8F0] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-[#64748B]">ยังไม่มีการแจ้งเตือน</div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleOpenItem(n)}
                  className={`flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-[#F8FAFC] ${
                    !n.is_read ? "bg-[#EFF6FF]/50" : "bg-white"
                  }`}
                >
                  <div className="mt-0.5 shrink-0">{eventIcon(n.event_type)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className={`text-xs leading-snug ${!n.is_read ? "font-bold text-[#0F172A]" : "font-medium text-[#334155]"}`}>
                        {n.title}
                      </span>
                      {!n.is_read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#1D4ED8]" />}
                    </div>
                    {n.message && <p className="mt-0.5 line-clamp-2 text-[11px] text-[#475569]">{n.message}</p>}
                    <div className="tabular-nums-th mt-1 text-[10px] text-[#64748B]">
                      {formatShortTime(n.created_at)}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="border-t border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2 text-center">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-[#1D4ED8] hover:underline"
            >
              ดูประวัติแจ้งเตือนทั้งหมด &rarr;
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
