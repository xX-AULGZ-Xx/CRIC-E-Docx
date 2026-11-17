"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, FileText, Loader2, LogIn, ShieldCheck } from "lucide-react";
import { api, UserProfile } from "@/lib/api";

function LoginContent() {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error") || "";
  const errorDetail = searchParams.get("detail") || "";
  const nextPath = searchParams.get("next") || "/";
  const isLogout = searchParams.get("logout") === "1";
  const isExpired = searchParams.get("expired") === "1";
  const isLocal = searchParams.get("local") === "1";

  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [me, setMe] = useState<UserProfile | null>(null);
  const [panelUrl, setPanelUrl] = useState(
    process.env.NEXT_PUBLIC_CRIC_PORTAL_URL || "https://panel.cric.ac.th"
  );

  const buildPanelLoginUrl = (basePanelUrl: string) => {
    const cleanBase = basePanelUrl.replace(/\/$/, "");
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const callbackUrl = `${origin}/auth/callback${
      nextPath && nextPath !== "/" ? `?next=${encodeURIComponent(nextPath)}` : ""
    }`;
    return `${cleanBase}/login?redirect_uri=${encodeURIComponent(callbackUrl)}&app=edocx`;
  };

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        const [cfg, meRes] = await Promise.all([
          api.getSsoConfig().catch(() => null),
          api.me().catch(() => null),
        ]);
        if (!mounted) return;

        const resolvedPanelUrl =
          cfg?.panel_url ||
          process.env.NEXT_PUBLIC_CRIC_PORTAL_URL ||
          "https://panel.cric.ac.th";
        setPanelUrl(resolvedPanelUrl);

        // If explicit logout/expired/local/error flag, stay on page so user sees notice
        if (isLogout || isExpired || isLocal || errorCode) {
          if (isLogout || isExpired) {
            try {
              window.localStorage.removeItem("cric_user_email");
            } catch {
              // ignore
            }
          }
          setMe(isLogout || isExpired ? null : meRes?.user || null);
          setLoading(false);
          return;
        }

        // If user already has an active real SSO session (not dev_default fallback)
        if (meRes?.user && meRes.auth_source && meRes.auth_source !== "dev_default" && meRes.auth_source !== "dev_switcher") {
          setMe(meRes.user);
          setLoading(false);
          return;
        }

        // Auto-redirect to Central CRIC E-Service Panel Login (same behavior as CRIC Plan)
        setRedirecting(true);
        window.location.replace(buildPanelLoginUrl(resolvedPanelUrl));
      } catch {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    init();
    return () => {
      mounted = false;
    };
  }, [errorCode, isExpired, isLocal, isLogout, nextPath]);

  const panelLoginHref = buildPanelLoginUrl(panelUrl);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F1F5F9] px-4 py-10 text-[#0F172A]">
      <div className="w-full max-w-md space-y-4">
        <div className="ledger-panel overflow-hidden">
          <div className="border-b border-[#E2E8F0] bg-[#0F172A] px-6 py-5 text-white">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-600 bg-slate-800 text-sm font-bold tracking-tight">
                CR
              </div>
              <div>
                <h1 className="text-base font-bold tracking-tight">CRIC E-Docx</h1>
                <p className="text-xs text-slate-300">
                  ระบบร่างเอกสารราชการและสารบรรณออนไลน์ · วิทยาลัยการอาชีพเชียงราย
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4 p-6">
            {isLogout && (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3.5 text-xs text-blue-900">
                ออกจากระบบเรียบร้อยแล้ว ท่านสามารถกดปุ่มด้านล่างเพื่อเข้าสู่ระบบใหม่อีกครั้งผ่าน CRIC E-Service Panel
              </div>
            )}

            {isExpired && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
                เซสชันการเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้งผ่าน CRIC E-Service Panel
              </div>
            )}

            {errorCode && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3.5 text-xs text-[#B91C1C]">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <div className="font-bold">เข้าสู่ระบบผ่าน CRIC Panel ไม่สำเร็จ ({errorCode})</div>
                    <p className="mt-1 leading-relaxed text-red-700">
                      {errorDetail || "กรุณาตรวจสอบสิทธิ์บัญชีผู้ใช้งานหรือลองเข้าสู่ระบบอีกครั้ง"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {loading || redirecting ? (
              <div className="flex flex-col items-center justify-center gap-2.5 py-8 text-center text-xs text-[#475569]">
                <Loader2 className="h-5 w-5 animate-spin text-[#1D4ED8]" />
                <span>
                  {redirecting
                    ? "กำลังพาไปยังหน้าเข้าสู่ระบบกลาง CRIC E-Service Panel..."
                    : "กำลังตรวจสอบสถานะการเข้าสู่ระบบ..."}
                </span>
              </div>
            ) : me ? (
              <div className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900">
                <div className="flex items-center gap-2 font-bold">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  เข้าสู่ระบบเรียบร้อยแล้ว
                </div>
                <p className="text-emerald-800">
                  ผู้ใช้งานปัจจุบัน: <span className="font-semibold">{me.full_name}</span> ({me.email || me.username})
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Link
                    href={nextPath.startsWith("/") ? nextPath : "/"}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3.5 py-2 font-semibold text-white hover:bg-emerald-800"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    เข้าสู่ระบบงานสารบรรณ
                  </Link>
                  <a
                    href={panelLoginHref}
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-white px-3 py-2 font-medium text-emerald-800 hover:bg-emerald-100"
                  >
                    เปลี่ยนบัญชีผู้ใช้ (Panel)
                  </a>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 text-xs text-[#475569]">
                  <div className="flex items-center gap-2 font-semibold text-[#0F172A]">
                    <ShieldCheck className="h-4 w-4 text-[#1D4ED8]" />
                    เข้าสู่ระบบกลางสถาบัน (CRIC E-Service Panel)
                  </div>
                  <p className="mt-1.5 leading-relaxed">
                    ระบบ CRIC E-Docx ใช้ระบบยืนยันตัวตนกลางร่วมกับ <strong>CRIC E-Service Panel</strong>{" "}
                    เช่นเดียวกับระบบแผนงาน (CRIC Plan)
                  </p>
                </div>

                <a
                  href={panelLoginHref}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-[#1D4ED8] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-800"
                >
                  <LogIn className="h-4 w-4" />
                  เข้าสู่ระบบผ่าน CRIC E-Service Panel
                </a>

                <div className="flex items-center justify-between pt-1 text-xs text-[#64748B]">
                  <Link href="/" className="inline-flex items-center gap-1 hover:text-[#0F172A]">
                    <ArrowLeft className="h-3.5 w-3.5" />
                    กลับหน้าหลัก
                  </Link>
                  <span>Realm: cric-college</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#F1F5F9] text-xs text-[#475569]">
          กำลังโหลดหน้าเข้าสู่ระบบ...
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
