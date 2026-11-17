"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { api, setActiveUserEmail } from "@/lib/api";

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ssoToken = searchParams.get("sso_token") || searchParams.get("token");
    const authError = searchParams.get("error") || searchParams.get("error_description");
    const nextPath = searchParams.get("next") || "/";
    const safeNext = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";

    if (authError) {
      setError(authError);
      return;
    }

    if (!ssoToken) {
      setError("ไม่พบรหัสยืนยันตัวตน (sso_token) จากระบบ CRIC E-Service Panel");
      return;
    }

    api
      .syncSsoSession(ssoToken)
      .then((res) => {
        if (!res.success || !res.user) {
          throw new Error("การยืนยันเซสชันร่วมกับ Central SSO ล้มเหลว");
        }

        const identifier = res.user.email || res.user.username || res.user.id;
        if (identifier) {
          setActiveUserEmail(identifier);
        }

        try {
          if (typeof window !== "undefined" && "BroadcastChannel" in window) {
            const channel = new BroadcastChannel("cric_sso_channel");
            channel.postMessage({ type: "LOGIN" });
            channel.close();
          }
          window.localStorage.setItem("cric_sso_login_event", Date.now().toString());
        } catch {
          // ignore
        }

        router.replace(safeNext);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์";
        setError(msg);
      });
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F1F5F9] px-4 py-10 text-[#0F172A]">
      <div className="w-full max-w-md rounded-lg border border-[#CBD5E1] bg-white p-6 shadow-sm">
        {error ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 p-3.5 text-xs text-[#B91C1C]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-bold">เข้าสู่ระบบไม่สำเร็จ</div>
                <p className="mt-1 leading-relaxed text-red-700">{error}</p>
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <Link
                href="/login?local=1"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#475569] hover:text-[#0F172A]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                กลับหน้าเข้าสู่ระบบ
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800"
              >
                ลองเข้าสู่ระบบอีกครั้ง
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center space-y-3 py-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-[#1D4ED8]">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div className="flex items-center gap-2 text-sm font-semibold text-[#0F172A]">
              <Loader2 className="h-4 w-4 animate-spin text-[#1D4ED8]" />
              กำลังซิงค์เซสชันกับ CRIC E-Service Panel...
            </div>
            <p className="text-xs text-[#64748B]">กรุณารอสักครู่ ระบบกำลังพาท่านเข้าสู่ CRIC E-Docx</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#F1F5F9] text-xs text-[#475569]">
          กำลังตรวจสอบข้อมูลการเข้าสู่ระบบ...
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
