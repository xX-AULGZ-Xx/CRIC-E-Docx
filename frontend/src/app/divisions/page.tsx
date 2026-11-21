"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  ExternalLink,
  FilePlus2,
  FileText,
  Globe,
  GraduationCap,
  HeartHandshake,
  Target,
} from "lucide-react";
import { api } from "@/lib/api";
import { DIVISION_GROUPS, DivisionExternalLinkKey, DivisionKey } from "@/lib/divisionDocuments";

const DIVISION_ICONS: Record<DivisionKey, typeof Building2> = {
  resource: Building2,
  academic: GraduationCap,
  development: HeartHandshake,
  planning: Target,
};

const DIVISION_ACCENT: Record<DivisionKey, string> = {
  resource: "border-blue-200 bg-blue-50 text-[#1E3A8A]",
  academic: "border-indigo-200 bg-indigo-50 text-indigo-900",
  development: "border-emerald-200 bg-emerald-50 text-emerald-900",
  planning: "border-amber-200 bg-amber-50 text-amber-900",
};

export default function DivisionsHubPage() {
  const [extLinks, setExtLinks] = useState<Partial<Record<DivisionExternalLinkKey, string>>>({
    project_system_url: "https://plan.cric.ac.th",
  });

  useEffect(() => {
    api
      .getDivisionLinks()
      .then((res) => setExtLinks(res.links || {}))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      <div className="ledger-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0F172A] px-5 py-4 text-white">
          <div className="space-y-1">
            <h2 className="text-base font-bold tracking-tight sm:text-lg">ศูนย์รวมเอกสารและระบบงานประจำ 4 ฝ่าย</h2>
            <p className="text-xs text-slate-300">
              เลือกสร้างแบบฟอร์มเอกสารราชการ (.DOCX / .PDF) หรือเชื่อมโยงเข้าสู่ระบบงานเฉพาะทางของแต่ละฝ่าย
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/qa-tools"
              className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1E40AF]"
            >
              <FileText className="h-3.5 w-3.5" />
              <span>เครื่องมือ QA (32 ตัวชี้วัด)</span>
            </Link>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
            >
              <Globe className="h-3.5 w-3.5" />
              <span>ตั้งค่าลิงก์ระบบภายนอก</span>
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {DIVISION_GROUPS.map((div) => {
          const Icon = DIVISION_ICONS[div.key];
          return (
            <section key={div.key} className="ledger-panel overflow-hidden">
              <div className="ledger-panel-header flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5">
                  <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${DIVISION_ACCENT[div.key]}`}>
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-[#0F172A]">{div.label}</h3>
                      <span className="rounded border border-[#CBD5E1] bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-[#475569]">
                        {div.code}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-[#64748B]">{div.description}</p>
                  </div>
                </div>
                <Link
                  href={`/approvals?division=${encodeURIComponent(div.code)}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#1D4ED8] hover:bg-[#EFF6FF]"
                >
                  <span>ตรวจเอกสารฝ่ายนี้</span>
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>

              <div className="divide-y divide-[#E2E8F0]">
                {div.items.map((item) => {
                  const extUrl = item.externalKey ? (extLinks[item.externalKey] || "").trim() : "";

                  if (item.kind === "external") {
                    return (
                      <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-xs hover:bg-slate-50/70">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-[#0F172A]">{item.label}</span>
                            <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                              ระบบเชื่อมโยง
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-[#64748B]">{item.subtitle}</p>
                        </div>
                        {extUrl ? (
                          <a
                            href={extUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-1.5 font-semibold text-[#1D4ED8] hover:bg-[#DBEAFE]"
                          >
                            <span>เปิดระบบ</span>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : (
                          <Link
                            href="/settings"
                            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#CBD5E1] bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-[#475569] hover:bg-slate-100"
                          >
                            <span>ยังไม่ได้ตั้งค่าลิงก์</span>
                          </Link>
                        )}
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={item.id}
                      href={item.href || "/"}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-xs transition hover:bg-[#F8FAFC]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {item.kind === "form" ? (
                            <FilePlus2 className="h-3.5 w-3.5 shrink-0 text-[#1D4ED8]" />
                          ) : (
                            <FileText className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          )}
                          <span className="font-semibold text-[#0F172A]">{item.label}</span>
                          {item.kind === "form" ? (
                            <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-[#1D4ED8]">
                              แบบฟอร์ม .DOCX
                            </span>
                          ) : (
                            <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                              พร้อมใช้งาน
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-[#64748B]">{item.subtitle}</p>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-[#64748B]" />
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
