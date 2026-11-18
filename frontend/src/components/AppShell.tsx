"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  BookOpenCheck,
  CheckSquare,
  ChevronDown,
  FileText,
  GraduationCap,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Lock,
  LogIn,
  LogOut,
  Menu,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  UserCog,
  X,
} from "lucide-react";
import {
  api,
  ApiError,
  formatUserSubtitle,
  getActiveUserEmail,
  getSsoLoginUrl,
  setActiveUserEmail,
  UserProfile,
} from "@/lib/api";
import { NotificationBell } from "@/components/NotificationBell";
import { UserAvatar } from "@/components/UserAvatar";
import { AppLauncher } from "@/components/launcher/AppLauncher";

const ROLE_LABELS: Record<string, string> = {
  drafter: "ผู้ร่างเอกสาร",
  unit_head: "หัวหน้างาน",
  deputy_director: "รองผู้อำนวยการ",
  director: "ผู้อำนวยการ",
  saraban_admin: "งานสารบรรณกลาง",
};

interface NavEntry {
  href: string;
  label: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  groupLabel: string;
  items: NavEntry[];
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [activeIdentifier, setActiveIdentifier] = useState<string>("");
  const [me, setMe] = useState<UserProfile | null>(null);
  const [authSource, setAuthSource] = useState<string>("");
  const [authDevMode, setAuthDevMode] = useState<boolean>(false);
  const [authLoaded, setAuthLoaded] = useState<boolean>(false);
  const [clientConfigured, setClientConfigured] = useState<boolean>(true);
  const [loggingOut, setLoggingOut] = useState<boolean>(false);

  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [mobileOpen, setMobileOpen] = useState<boolean>(false);
  const [userMenuOpen, setUserMenuOpen] = useState<boolean>(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("cric_sidebar_collapsed");
      if (saved === "1") setCollapsed(true);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!userMenuOpen) return;
    const onOutsideClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", onOutsideClick);
    window.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onOutsideClick);
      window.removeEventListener("keydown", onEsc);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    const load = async () => {
      const ident = getActiveUserEmail();
      setActiveIdentifier(ident);
      const ssoRes = await api.getSsoConfig().catch(() => null);
      if (ssoRes) {
        setAuthDevMode(Boolean(ssoRes.auth_dev_mode));
        setClientConfigured(Boolean(ssoRes.client_configured));
      }

      if (ident === "guest") {
        setMe(null);
        setAuthSource("guest");
        if (ssoRes?.auth_dev_mode) {
          const usersRes = await api.listUsers().catch(() => ({ users: [] }));
          setUsers(usersRes.users || []);
        } else {
          setUsers([]);
        }
        setAuthLoaded(true);
        return;
      }

      try {
        const meRes = await api.me();
        setMe(meRes.user);
        setAuthSource(meRes.auth_source || "");
        setAuthDevMode(Boolean(meRes.auth_dev_mode));
        if (meRes.auth_dev_mode || meRes.user.role === "saraban_admin" || meRes.user.role === "director") {
          const usersRes = await api.listUsers().catch(() => ({ users: [] }));
          setUsers(usersRes.users || []);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setMe(null);
          setAuthSource("guest");
          if (ssoRes?.auth_dev_mode) {
            const usersRes = await api.listUsers().catch(() => ({ users: [] }));
            setUsers(usersRes.users || []);
          } else if (pathname !== "/login" && pathname !== "/auth/callback") {
            const nextParam = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
            window.location.replace(`/login${nextParam}`);
            return;
          }
        }
      } finally {
        setAuthLoaded(true);
      }
    };
    load();
    const handler = () => {
      setActiveIdentifier(getActiveUserEmail());
      load();
    };
    window.addEventListener("cric-user-changed", handler);
    window.addEventListener("cric-profile-updated", handler);
    return () => {
      window.removeEventListener("cric-user-changed", handler);
      window.removeEventListener("cric-profile-updated", handler);
    };
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

  function toggleCollapse() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("cric_sidebar_collapsed", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  const isAdmin = me?.role === "saraban_admin" || me?.role === "director";

  const navGroups: NavGroup[] = useMemo(() => {
    const groups: NavGroup[] = [
      {
        groupLabel: "งานสารบรรณ",
        items: [
          {
            href: "/",
            label: "แดชบอร์ด",
            subtitle: "ภาพรวมสถิติ คิวงานรอตรวจสอบ เลขสารบรรณ และทางลัดเริ่มร่าง",
            icon: LayoutDashboard,
          },
          {
            href: "/draft",
            label: "ร่างเอกสาร",
            subtitle: "บันทึกข้อความ หนังสือภายนอก คำสั่ง ประกาศ และรายงานประชุม",
            icon: FileText,
          },
          {
            href: "/templates",
            label: "แม่แบบเอกสาร",
            subtitle: "สร้างเอกสารจากแม่แบบกำหนดเองและส่งออกชุด Batch ZIP",
            icon: Layers,
          },
        ],
      },
      {
        groupLabel: "พัสดุและการสอน",
        items: [
          {
            href: "/procurement",
            label: "จัดซื้อ / สผ.",
            subtitle: "ชุดเอกสารขออนุมัติจัดซื้อวัสดุฝึก (สผ.1 / แผนฝึก / TOR)",
            icon: PackageCheck,
          },
          {
            href: "/teaching",
            label: "แผนการสอน / หลังสอน",
            subtitle: "โครงการสอน 18 สัปดาห์ แผนรายหน่วย และรายงานหลังสอน",
            icon: GraduationCap,
          },
        ],
      },
      {
        groupLabel: "ตรวจลงนาม & ทะเบียน",
        items: [
          {
            href: "/approvals",
            label: "ตรวจร่าง & ลงนาม",
            subtitle: "คิวตรวจทาน ประทับลายเซ็น และส่งออกเลขสารบรรณ",
            icon: CheckSquare,
          },
          {
            href: "/registry",
            label: "ทะเบียนคุม & คลัง",
            subtitle: "สมุดทะเบียนเลขรัน หนังสือรับ-ส่ง และคลังเอกสาร",
            icon: BookOpenCheck,
          },
        ],
      },
      {
        groupLabel: "บัญชีของฉัน",
        items: [
          {
            href: "/notifications",
            label: "แจ้งเตือน",
            subtitle: "กล่องข้อความแจ้งเตือนสถานะงานสารบรรณแบบเรียลไทม์",
            icon: Bell,
          },
          {
            href: "/profile",
            label: "โปรไฟล์ (ศูนย์เอกสาร)",
            subtitle: "ศูนย์รวมข้อมูลเอกสารของฉัน คลังรายวิชา และสถานะล่าสุด",
            icon: FileText,
          },
          {
            href: "/profile/settings",
            label: "ตั้งค่าโปรไฟล์",
            subtitle: "ข้อมูลส่วนตัว ตำแหน่ง สังกัด รูปโปรไฟล์ และลายเซ็น PNG",
            icon: UserCog,
          },
        ],
      },
    ];
    if (isAdmin) {
      groups.push({
        groupLabel: "ผู้ดูแลระบบ",
        items: [
          {
            href: "/settings",
            label: "ตั้งค่าระบบ",
            subtitle: "หน่วยงาน บุคลากร AI แม่แบบเอกสาร และบันทึกการใช้งาน",
            icon: Settings,
          },
        ],
      });
    }
    return groups;
  }, [isAdmin]);

  const activeEntry = useMemo(() => {
    for (const g of navGroups) {
      for (const item of g.items) {
        if (item.href === pathname) return item;
      }
    }
    return navGroups[0].items[0];
  }, [navGroups, pathname]);

  const userSubtitle = me ? formatUserSubtitle(me) : activeIdentifier || "guest";
  const effectiveDevValue = me ? (activeIdentifier || me.email || me.username || "guest") : "guest";
  const ssoStartUrl = `/login${pathname && pathname !== "/login" && pathname !== "/auth/callback" && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : ""}`;
  const isSsoSession = authSource === "sso" || authSource === "panel_jwt" || authSource === "panel_sso_sync";

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      const res = await api.logout().catch(() => null);
      try {
        window.localStorage.removeItem("cric_user_email");
        window.localStorage.removeItem("cric_sso_token");
      } catch {
        // ignore storage errors
      }
      if (authDevMode) {
        setActiveUserEmail("guest");
      }
      setMe(null);
      setAuthSource("guest");

      if (!authDevMode && isSsoSession && res?.sso_logout_url) {
        window.location.replace(res.sso_logout_url);
        return;
      }
      window.location.replace("/login?logout=1");
    } finally {
      setLoggingOut(false);
    }
  }

  if (pathname === "/login" || pathname === "/auth/callback") {
    return <>{children}</>;
  }

  const sidebarContent = (isMobileDrawer = false) => (
    <div className="flex h-full flex-col bg-white">
      {/* Brand Bar */}
      <div
        className={`flex h-14 items-center border-b border-[#E2E8F0] ${
          collapsed && !isMobileDrawer ? "justify-center px-2" : "justify-between px-3"
        }`}
      >
        {(!collapsed || isMobileDrawer) && (
          <Link href="/" className="flex items-center gap-2.5 overflow-hidden">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#1E293B] bg-[#0F172A] text-sm font-bold tracking-tight text-white">
              CR
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold tracking-tight text-[#0F172A]">CRIC E-Docx</div>
              <div className="truncate text-[11px] text-[#475569]">วิทยาลัยการอาชีพเชียงราย</div>
            </div>
          </Link>
        )}

        {isMobileDrawer ? (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="ปิดเมนู"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={toggleCollapse}
            title={collapsed ? "ขยายแถบเมนู" : "ย่อแถบเมนู"}
            className={`hidden text-slate-600 hover:bg-slate-100 hover:text-[#0F172A] lg:inline-flex ${
              collapsed
                ? "h-9 w-9 items-center justify-center rounded-md border border-[#CBD5E1] bg-[#F8FAFC]"
                : "rounded-md p-1.5"
            }`}
            aria-label={collapsed ? "ขยายแถบเมนู" : "ย่อแถบเมนู"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Grouped Navigation */}
      <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-4" aria-label="เมนูหลัก">
        {navGroups.map((group) => (
          <div key={group.groupLabel}>
            {(!collapsed || isMobileDrawer) && (
              <div className="mb-1.5 px-2.5 text-[11px] font-semibold text-[#64748B]">
                {group.groupLabel}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed && !isMobileDrawer ? item.label : undefined}
                    className={`flex items-center gap-2.5 border-l-[3px] px-2.5 py-2 text-sm transition-colors ${
                      active
                        ? "border-[#1D4ED8] bg-[#EFF6FF] font-semibold text-[#1E3A8A]"
                        : "border-transparent font-medium text-[#334155] hover:bg-[#F8FAFC] hover:text-[#0F172A]"
                    } ${collapsed && !isMobileDrawer ? "justify-center px-1" : "rounded-r-md"}`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${active ? "text-[#1D4ED8]" : "text-[#64748B]"}`} />
                    {(!collapsed || isMobileDrawer) && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom Utility Links & Mobile User Switcher */}
      <div className="space-y-2 border-t border-[#E2E8F0] p-2.5">
        {isMobileDrawer && (me || authDevMode) && (
          <div className="space-y-2 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-2.5">
            {me && (
              <Link
                href="/profile"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2.5 rounded p-1 transition-colors hover:bg-white"
              >
                <UserAvatar avatarUrl={me.avatar_url} fullName={me.full_name} size="sm" />
                <div className="min-w-0 leading-tight">
                  <div className="truncate text-xs font-bold text-[#0F172A]">{me.full_name}</div>
                  <div className="truncate text-[11px] text-[#475569]">
                    {ROLE_LABELS[me.role] || me.role}
                    {userSubtitle ? ` · ${userSubtitle}` : ""}
                  </div>
                </div>
              </Link>
            )}
            {authDevMode && (
              <select
                aria-label="เลือกบัญชีผู้ใช้งานทดสอบ (Drawer)"
                value={effectiveDevValue}
                onChange={(e) => setActiveUserEmail(e.target.value)}
                className="w-full rounded-md border border-[#CBD5E1] bg-white px-2.5 py-2 text-xs font-medium text-[#0F172A] focus:border-[#1D4ED8] focus:outline-none"
              >
                <option value="guest">ผู้เยี่ยมชมทั่วไป (Guest)</option>
                {users.length > 0 ? (
                  users.map((u) => {
                    const val = u.email || u.username || u.id;
                    const handle = u.username ? `@${u.username}` : u.email || "";
                    return (
                      <option key={u.id} value={val}>
                        {u.full_name} ({ROLE_LABELS[u.role] || u.role}){handle ? ` [${handle}]` : ""}
                      </option>
                    );
                  })
                ) : (
                  effectiveDevValue !== "guest" && (
                    <option value={effectiveDevValue}>{me?.full_name || effectiveDevValue}</option>
                  )
                )}
              </select>
            )}
          </div>
        )}
        <a
          href="http://localhost:3000"
          title="กลับสู่ CRIC E-Service Panel"
          className={`flex items-center gap-2 rounded-md border border-[#CBD5E1] bg-[#F8FAFC] px-2.5 py-1.5 text-xs font-medium text-[#334155] hover:bg-slate-100 hover:text-[#0F172A] ${
            collapsed && !isMobileDrawer ? "justify-center px-1" : ""
          }`}
        >
          <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-[#1D4ED8]" />
          {(!collapsed || isMobileDrawer) && <span>กลับสู่ CRIC Panel</span>}
        </a>
        {me ? (
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            title="ออกจากระบบ"
            className={`flex w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-[#334155] hover:border-red-200 hover:bg-red-50 hover:text-[#B91C1C] ${
              collapsed && !isMobileDrawer ? "justify-center px-1" : ""
            }`}
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            {(!collapsed || isMobileDrawer) && <span>{loggingOut ? "กำลังออกจากระบบ..." : "ออกจากระบบ"}</span>}
          </button>
        ) : (
          <a
            href={ssoStartUrl}
            title="เข้าสู่ระบบด้วย CRIC SSO (sso.cric.ac.th)"
            className={`flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 ${
              collapsed && !isMobileDrawer ? "justify-center px-1" : ""
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
            {(!collapsed || isMobileDrawer) && <span>เข้าสู่ระบบ CRIC SSO</span>}
          </a>
        )}
      </div>
    </div>
  );

  const requiresAuthOnRoute = pathname !== "/";
  const showGuestGate = authLoaded && !me && requiresAuthOnRoute;

  return (
    <div className="flex min-h-screen overflow-x-clip bg-[#F1F5F9] text-[#0F172A]">
      {/* Desktop Sticky Sidebar */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 border-r border-[#CBD5E1] bg-white transition-[width] duration-150 lg:block ${
          collapsed ? "w-[68px]" : "w-[248px]"
        }`}
      >
        {sidebarContent(false)}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[70] flex lg:hidden">
          <div className="fixed inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="relative z-10 h-full w-[264px] border-r border-[#CBD5E1] bg-white shadow-xl">
            {sidebarContent(true)}
          </aside>
        </div>
      )}

      {/* Main Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Compact Top Utility Bar */}
        <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-2 border-b border-[#CBD5E1] bg-white px-3 py-1.5 sm:px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#CBD5E1] text-[#334155] hover:bg-slate-50 lg:hidden"
              aria-label="เปิดเมนูนำทาง"
            >
              <Menu className="h-4 w-4" />
            </button>
            <h1 className="shrink-0 whitespace-nowrap text-sm font-bold text-[#0F172A] sm:text-base">{activeEntry.label}</h1>
            <span className="hidden h-4 w-px bg-[#CBD5E1] xl:inline-block" />
            <p className="hidden truncate text-xs text-[#475569] xl:block">{activeEntry.subtitle}</p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <AppLauncher
              currentRole={me ? me.role : "guest"}
              isLoggedIn={Boolean(me)}
            />
            {me && <NotificationBell />}
            {me ? (
              <div ref={userMenuRef} className="relative flex items-center pl-1 sm:border-l sm:border-[#E2E8F0] sm:pl-3">
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((prev) => !prev)}
                  aria-expanded={userMenuOpen}
                  aria-haspopup="menu"
                  aria-label="เปิดเมนูโปรไฟล์ผู้ใช้งาน"
                  className="flex items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
                >
                  <UserAvatar avatarUrl={me.avatar_url} fullName={me.full_name} size="sm" />
                  <div className="hidden min-w-0 leading-tight sm:block">
                    <div className="max-w-[160px] truncate text-xs font-semibold text-[#0F172A]">
                      {me.full_name}
                    </div>
                    <div className="max-w-[160px] truncate text-[11px] text-[#64748B]">
                      {userSubtitle}
                    </div>
                  </div>
                  <ChevronDown
                    className={`h-3.5 w-3.5 shrink-0 text-[#64748B] transition-transform duration-150 ${
                      userMenuOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {userMenuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-lg border border-[#CBD5E1] bg-white shadow-lg"
                  >
                    <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
                      <div className="flex items-center gap-3">
                        <UserAvatar avatarUrl={me.avatar_url} fullName={me.full_name} size="md" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold text-[#0F172A]">{me.full_name}</div>
                          <div className="truncate text-xs text-[#475569]">{userSubtitle}</div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="rounded border border-[#CBD5E1] bg-white px-2 py-0.5 text-[10px] font-semibold text-[#334155]">
                              {ROLE_LABELS[me.role] || me.role}
                            </span>
                            {isSsoSession && (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                                SSO
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-0.5 p-1.5 text-xs font-medium text-[#334155]">
                      <Link
                        href="/profile"
                        role="menuitem"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2.5 rounded-md px-3 py-2 hover:bg-slate-100 hover:text-[#0F172A]"
                      >
                        <FileText className="h-4 w-4 text-[#1D4ED8]" />
                        <span>ศูนย์รวมเอกสารของฉัน</span>
                      </Link>
                      <Link
                        href="/profile/settings"
                        role="menuitem"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2.5 rounded-md px-3 py-2 hover:bg-slate-100 hover:text-[#0F172A]"
                      >
                        <UserCog className="h-4 w-4 text-indigo-600" />
                        <span>ตั้งค่าโปรไฟล์ &amp; ลายเซ็น</span>
                      </Link>
                      <Link
                        href="/notifications"
                        role="menuitem"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2.5 rounded-md px-3 py-2 hover:bg-slate-100 hover:text-[#0F172A]"
                      >
                        <Bell className="h-4 w-4 text-amber-600" />
                        <span>กล่องแจ้งเตือนของฉัน</span>
                      </Link>
                      {isAdmin && (
                        <Link
                          href="/settings"
                          role="menuitem"
                          onClick={() => setUserMenuOpen(false)}
                          className="flex items-center gap-2.5 rounded-md px-3 py-2 hover:bg-slate-100 hover:text-[#0F172A]"
                        >
                          <Settings className="h-4 w-4 text-[#475569]" />
                          <span>ตั้งค่าระบบ</span>
                        </Link>
                      )}
                    </div>

                    <div className="border-t border-[#E2E8F0] p-1.5">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setUserMenuOpen(false);
                          handleLogout();
                        }}
                        disabled={loggingOut}
                        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-xs font-semibold text-[#B91C1C] hover:bg-red-50 disabled:opacity-50"
                      >
                        <LogOut className="h-4 w-4" />
                        <span>{loggingOut ? "กำลังออกจากระบบ..." : "ออกจากระบบ"}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              authLoaded && (
                <a
                  href={ssoStartUrl}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#1E40AF]"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  <span>เข้าสู่ระบบ CRIC SSO</span>
                </a>
              )
            )}

            {authDevMode && (
              <select
                aria-label="เลือกบัญชีผู้ใช้งานทดสอบ (Dev Mode)"
                value={effectiveDevValue}
                onChange={(e) => setActiveUserEmail(e.target.value)}
                className="hidden max-w-[210px] rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#0F172A] focus:border-[#1D4ED8] focus:outline-none sm:block"
                title="Dev Mode Switcher: สลับบทบาทผู้ใช้จำลองเพื่อทดสอบ"
              >
                <option value="guest">ผู้เยี่ยมชมทั่วไป (Guest)</option>
                {users.length > 0 ? (
                  users.map((u) => {
                    const val = u.email || u.username || u.id;
                    const handle = u.username ? `@${u.username}` : u.email || "";
                    return (
                      <option key={u.id} value={val}>
                        {u.full_name} ({ROLE_LABELS[u.role] || u.role}){handle ? ` [${handle}]` : ""}
                      </option>
                    );
                  })
                ) : (
                  effectiveDevValue !== "guest" && (
                    <option value={effectiveDevValue}>{me?.full_name || effectiveDevValue}</option>
                  )
                )}
              </select>
            )}
          </div>
        </header>

        {/* Workspace Content */}
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-3 pt-4 pb-24 sm:px-4 sm:pt-5 lg:px-6 xl:pb-5 2xl:max-w-[1680px]">
          {!authLoaded && requiresAuthOnRoute ? (
            <div className="ledger-panel flex items-center justify-center p-10 text-xs text-[#475569]">
              กำลังตรวจสอบสถานะการเข้าสู่ระบบ...
            </div>
          ) : showGuestGate ? (
            <div className="mx-auto mt-6 max-w-lg">
              <div className="ledger-panel overflow-hidden">
                <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-5 py-4">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md border border-blue-200 bg-[#EFF6FF] text-[#1D4ED8]">
                      <Lock className="h-4 w-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-[#0F172A]">
                        กรุณาเข้าสู่ระบบเพื่อใช้งาน &ldquo;{activeEntry.label}&rdquo;
                      </h2>
                      <p className="text-xs text-[#475569]">
                        ขณะนี้คุณกำลังเข้าชมในสถานะผู้เยี่ยมชม (Guest)
                      </p>
                    </div>
                  </div>
                </div>
                <div className="space-y-4 p-5 text-sm text-[#334155]">
                  <p className="text-xs leading-relaxed text-[#475569]">
                    การร่างหนังสือราชการ ตรวจลงนาม ออกเลขสารบรรณ และจัดการโปรไฟล์ต้องยืนยันตัวตนผ่านบัญชีวิทยาลัยฯ
                    (<span className="font-mono text-[#0F172A]">sso.cric.ac.th</span>) เพื่อบันทึกชื่อ–ตำแหน่งและลายเซ็นอิเล็กทรอนิกส์อย่างถูกต้อง
                  </p>
                  {!clientConfigured && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      หมายเหตุ: ระบบยังไม่ได้ตั้งค่า SSO Client ID กรุณาติดต่อผู้ดูแลระบบสารบรรณ
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2.5">
                    <a
                      href={ssoStartUrl}
                      className="inline-flex items-center gap-2 rounded-md bg-[#1D4ED8] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E40AF]"
                    >
                      <ShieldCheck className="h-4 w-4" />
                      เข้าสู่ระบบด้วย CRIC SSO
                    </a>
                    <Link
                      href="/"
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-4 py-2 text-xs font-semibold text-[#334155] hover:bg-slate-50"
                    >
                      กลับหน้าแดชบอร์ด
                    </Link>
                  </div>
                  {authDevMode && (
                    <p className="border-t border-[#E2E8F0] pt-3 text-[11px] text-[#64748B]">
                      โหมดพัฒนา (Dev Mode) เปิดอยู่: สามารถกดปุ่ม CRIC SSO ด้านบน หรือเลือกบัญชีทดสอบจากตัวเลือกมุมขวาบนได้ทันที
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
