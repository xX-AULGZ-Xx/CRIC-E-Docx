"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, FileText, Loader2, ShieldCheck } from "lucide-react";
import { api, getSsoLoginUrl, UserProfile } from "@/lib/api";

function LoginContent() {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error") || "";
  const errorDetail = searchParams.get("detail") || "";
  const nextPath = searchParams.get("next") || "/";

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<UserProfile | null>(null);
  const [ssoCfg, setSsoCfg] = useState<{
    sso_issuer: string;
    sso_realm: string;
    sso_client_id?: string;
    client_configured: boolean;
    allowed_domain: string;
    auth_dev_mode: boolean;
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [cfg, meRes] = await Promise.all([
          api.getSsoConfig().catch(() => null),
          api.me().catch(() => null),
        ]);
        if (!mounted) return;
        setSsoCfg(cfg);
        setMe(meRes?.user || null);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const loginHref = getSsoLoginUrl(nextPath);

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
            {errorCode && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3.5 text-xs text-[#B91C1C]">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <div className="font-bold">เข้าสู่ระบบผ่าน CRIC SSO ไม่สำเร็จ ({errorCode})</div>
                    <p className="mt-1 leading-relaxed text-red-700">
                      {errorDetail || "กรุณาตรวจสอบสิทธิ์บัญชีผู้ใช้งานหรือการตั้งค่า Keycloak Client"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-[#475569]">
                <Loader2 className="h-4 w-4 animate-spin text-[#1D4ED8]" />
                กำลังตรวจสอบสถานะ CRIC SSO...
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
                    href={loginHref}
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-white px-3.5 py-2 font-semibold text-emerald-800 hover:bg-emerald-50"
                  >
                    เข้าสู่ระบบด้วยบัญชีอื่น
                  </a>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <h2 className="text-sm font-bold text-[#0F172A]">ยืนยันตัวตนด้วยบัญชีวิทยาลัยฯ</h2>
                  <p className="text-xs leading-relaxed text-[#475569]">
                    ใช้บัญชีเดียวกับระบบกลาง CRIC E-Service Panel เพื่อเข้าถึงการร่างหนังสือราชการ ตรวจลงนาม และทะเบียนคุมเลขสารบรรณ
                  </p>
                </div>

                {ssoCfg && !ssoCfg.client_configured && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    ระบบยังไม่ได้ระบุ <span className="font-mono font-semibold">SSO_CLIENT_ID</span> กรุณาตั้งค่าที่เมนูตั้งค่าระบบหรือไฟล์สภาพแวดล้อม
                  </div>
                )}

                <div className="space-y-2.5 pt-1">
                  <a
                    href={loginHref}
                    className="flex w-full items-center justify-center gap-2 rounded-md bg-[#1D4ED8] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1E40AF]"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    เข้าสู่ระบบด้วย CRIC SSO
                  </a>
                  <Link
                    href="/"
                    className="flex w-full items-center justify-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-4 py-2 text-xs font-semibold text-[#334155] hover:bg-slate-50"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    เข้าใช้งานแบบผู้เยี่ยมชม (ดูหน้าหลัก)
                  </Link>
                </div>
              </>
            )}

            <div className="border-t border-[#E2E8F0] pt-3 text-[11px] text-[#64748B]">
              <div>
                SSO Realm:{" "}
                <span className="font-mono text-[#334155]">
                  {ssoCfg?.sso_issuer || "https://sso.cric.ac.th/realms/cric-college"}
                </span>
              </div>
              {ssoCfg?.allowed_domain && (
                <div>
                  โดเมนที่อนุญาต: <span className="font-mono text-[#334155]">@{ssoCfg.allowed_domain}</span>
                </div>
              )}
            </div>
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
