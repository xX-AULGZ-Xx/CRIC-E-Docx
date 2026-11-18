"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, ClipboardList, FileSpreadsheet, Loader2, Search } from "lucide-react";
import { api } from "@/lib/api";

interface QaToolItem {
  code: string;
  title: string;
  filename: string;
  division_code: string;
  division_name: string;
  unit_name: string;
}

const DIV_FILTERS = [
  { code: "ALL", label: "ทั้งหมด (32 ตัวชี้วัด)" },
  { code: "ฝบ.", label: "ฝ่ายบริหารทรัพยากร (ฝบ.)" },
  { code: "ฝว.", label: "ฝ่ายวิชาการ (ฝว.)" },
  { code: "ฝก.", label: "ฝ่ายพัฒนากิจการฯ (ฝก.)" },
  { code: "ฝย.", label: "ฝ่ายแผนงานฯ (ฝย.)" },
] as const;

function QaToolsCatalogContent() {
  const searchParams = useSearchParams();
  const initialDiv = searchParams.get("div") || "ALL";

  const [tools, setTools] = useState<QaToolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [divFilter, setDivFilter] = useState<string>(initialDiv);
  const [query, setQuery] = useState("");

  useEffect(() => {
    api
      .listQaTools()
      .then((res) => setTools(res.tools || []))
      .catch(() => setTools([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tools.filter((t) => {
      if (divFilter !== "ALL" && t.division_code !== divFilter) return false;
      if (!q) return true;
      return (
        t.code.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        t.unit_name.toLowerCase().includes(q) ||
        t.division_name.toLowerCase().includes(q)
      );
    });
  }, [tools, divFilter, query]);

  const groupedByUnit = useMemo(() => {
    const map = new Map<string, { divisionName: string; divisionCode: string; unitName: string; items: QaToolItem[] }>();
    for (const item of filtered) {
      const key = `${item.division_code}::${item.unit_name}`;
      if (!map.has(key)) {
        map.set(key, {
          divisionName: item.division_name,
          divisionCode: item.division_code,
          unitName: item.unit_name,
          items: [],
        });
      }
      map.get(key)!.items.push(item);
    }
    return Array.from(map.values());
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="ledger-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0F172A] px-5 py-4 text-white">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-blue-300" />
              <h2 className="text-base font-bold tracking-tight sm:text-lg">เครื่องมือจัดเก็บข้อมูลประกันคุณภาพ (32 ตัวชี้วัด)</h2>
            </div>
            <p className="text-xs text-slate-300">
              กรอกข้อมูลและติ๊กแบบประเมิน PDCA ลงในแม่แบบ .DOCX จริงของแต่ละฝ่าย/งาน พร้อมพรีวิว A4 และส่งตรวจลงนาม
            </p>
          </div>
          <Link
            href="/divisions"
            className="inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
          >
            <span>กลับไปเอกสารประจำ 4 ฝ่าย</span>
          </Link>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="ledger-panel space-y-3 p-4">
        <div className="flex flex-wrap gap-1.5 text-xs">
          {DIV_FILTERS.map((f) => (
            <button
              key={f.code}
              type="button"
              onClick={() => setDivFilter(f.code)}
              className={`rounded-md border px-3 py-1.5 font-semibold transition ${
                divFilter === f.code
                  ? "border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]"
                  : "border-[#CBD5E1] bg-white text-[#475569] hover:bg-slate-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#64748B]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหารหัสตัวชี้วัด (เช่น 2.2.6), ชื่อเรื่อง, หรือชื่องาน..."
            className="ledger-input py-1.5 !pl-9 text-xs"
          />
        </div>
      </div>

      {loading ? (
        <div className="ledger-panel flex items-center justify-center gap-2 p-10 text-sm text-[#475569]">
          <Loader2 className="h-4 w-4 animate-spin text-[#1D4ED8]" />
          <span>กำลังโหลดรายการเครื่องมือ 32 ตัวชี้วัด...</span>
        </div>
      ) : groupedByUnit.length === 0 ? (
        <div className="ledger-panel p-8 text-center text-xs text-[#64748B]">ไม่พบตัวชี้วัดที่ตรงกับคำค้นหา</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {groupedByUnit.map((grp) => (
            <section key={`${grp.divisionCode}-${grp.unitName}`} className="ledger-panel overflow-hidden">
              <div className="ledger-panel-header flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-[#1D4ED8]" />
                  <h3 className="text-sm font-bold text-[#0F172A]">{grp.unitName}</h3>
                </div>
                <span className="rounded border border-[#CBD5E1] bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-[#475569]">
                  {grp.divisionCode} · {grp.items.length} ตัวชี้วัด
                </span>
              </div>
              <div className="divide-y divide-[#E2E8F0]">
                {grp.items.map((item) => (
                  <Link
                    key={item.code}
                    href={`/qa-tools/${encodeURIComponent(item.code)}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 text-xs transition hover:bg-[#F8FAFC]"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="mr-2 inline-block rounded border border-blue-200 bg-[#EFF6FF] px-1.5 py-0.5 font-mono text-[11px] font-bold text-[#1D4ED8]">
                        {item.code}
                      </span>
                      <span className="font-semibold text-[#0F172A]">{item.title}</span>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-[#64748B]" />
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export default function QaToolsPage() {
  return (
    <Suspense
      fallback={
        <div className="ledger-panel flex items-center justify-center gap-2 p-10 text-sm text-[#475569]">
          <Loader2 className="h-4 w-4 animate-spin text-[#1D4ED8]" />
          <span>กำลังโหลดเครื่องมือประกันคุณภาพ...</span>
        </div>
      }
    >
      <QaToolsCatalogContent />
    </Suspense>
  );
}
