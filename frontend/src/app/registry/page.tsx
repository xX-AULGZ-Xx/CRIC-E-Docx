"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Download, Plus, Save, Settings } from "lucide-react";
import { api, API_BASE, DocumentRecord, NumberSequence } from "@/lib/api";
import { toastError, toastSuccess } from "@/lib/swal";

export default function RegistryAndArchivePage() {
  const [sequences, setSequences] = useState<NumberSequence[]>([]);
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [search, setSearch] = useState("");

  // New registry book form
  const [newKey, setNewKey] = useState("");
  const [newName, setNewName] = useState("");
  const [newPrefix, setNewPrefix] = useState("");
  const [newYear, setNewYear] = useState(2570);
  const [newLastNum, setNewLastNum] = useState(0);

  const [msg, setMsg] = useState("");

  async function loadAll() {
    try {
      const [seqRes, docRes] = await Promise.all([api.listSequences(), api.listDocuments()]);
      setSequences(seqRes.sequences);
      setDocs(docRes.documents);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleSaveSeq(seq: NumberSequence) {
    try {
      await api.updateSequence(seq.id, {
        registry_name: seq.registry_name,
        prefix: seq.prefix,
        year_be: seq.year_be,
        last_number: seq.last_number,
      });
      const m = `บันทึกเลขตั้งต้น "${seq.registry_name}" เรียบร้อยแล้ว`;
      setMsg(m);
      toastSuccess("บันทึกเลขทะเบียนคุมแล้ว", seq.registry_name);
      await loadAll();
    } catch (err) {
      const m = err instanceof Error ? err.message : "บันทึกเลขรันไม่สำเร็จ";
      setMsg(m);
      toastError("บันทึกเลขรันไม่สำเร็จ", m);
    }
  }

  async function handleAddSeq(e: React.FormEvent) {
    e.preventDefault();
    if (!newKey.trim() || !newName.trim()) return;
    try {
      await api.createSequence({
        registry_key: newKey.trim(),
        registry_name: newName.trim(),
        prefix: newPrefix,
        year_be: Number(newYear),
        last_number: Number(newLastNum),
      });
      setNewKey("");
      setNewName("");
      setNewPrefix("");
      setMsg("เพิ่มสมุดทะเบียนคุมใหม่เรียบร้อยแล้ว");
      toastSuccess("เพิ่มสมุดทะเบียนคุมใหม่แล้ว", newName.trim());
      await loadAll();
    } catch (err) {
      const m = err instanceof Error ? err.message : "เพิ่มทะเบียนไม่สำเร็จ";
      setMsg(m);
      toastError("เพิ่มทะเบียนไม่สำเร็จ", m);
    }
  }

  const filteredDocs = docs.filter(
    (d) =>
      d.subject.toLowerCase().includes(search.toLowerCase()) ||
      (d.doc_number || "").toLowerCase().includes(search.toLowerCase()) ||
      d.created_by.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      {msg && (
        <div className="rounded-md border border-blue-300 bg-[#EFF6FF] px-4 py-2.5 text-sm font-medium text-[#1E3A8A]">
          {msg}
        </div>
      )}

      {/* Admin Settings Reference Strip */}
      <div className="ledger-panel flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-2 text-xs text-[#475569] sm:text-sm">
          <Settings className="h-4 w-4 text-[#1D4ED8]" />
          <span>
            การตั้งค่า AI, รายชื่อบุคลากร, ข้อมูลหน่วยงาน และ Audit Log จัดการได้ที่{" "}
            <strong className="font-semibold text-[#0F172A]">ศูนย์ตั้งค่าระบบ</strong>
          </span>
        </div>
        <Link
          href="/settings"
          className="rounded-md border border-[#CBD5E1] bg-[#F8FAFC] px-3 py-1.5 text-xs font-semibold text-[#0F172A] hover:bg-slate-100"
        >
          เปิดหน้าตั้งค่าระบบ
        </Link>
      </div>

      {/* 1. Registry Running Number Config */}
      <section className="ledger-panel overflow-hidden">
        <div className="ledger-panel-header flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-[#0F172A]">ตั้งค่าเลขรันทะเบียนคุมหนังสือ</h2>
            <p className="text-xs text-[#475569]">
              ปรับแก้เลขล่าสุด คำนำหน้า (Prefix) หรือปี พ.ศ. ได้โดยตรง (เลขถัดไปจะบวกต่อจากค่าที่ตั้งไว้)
            </p>
          </div>
          <a
            href={`${API_BASE}/v1/registry/export`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
          >
            <Download className="h-3.5 w-3.5" />
            ส่งออกทะเบียนคุม (.XLSX)
          </a>
        </div>

        <div className="p-3 sm:p-4">
          {/* Mobile (< md) Adaptive Running Number Cards */}
          <div className="space-y-3 md:hidden">
            {sequences.map((seq) => (
              <div key={seq.id} className="space-y-2.5 rounded-md border border-[#CBD5E1] bg-[#F8FAFC] p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded bg-slate-200 px-2 py-0.5 font-mono text-[11px] font-bold text-[#0F172A]">
                    {seq.registry_key}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleSaveSeq(seq)}
                    className="inline-flex items-center gap-1 rounded-md bg-[#1D4ED8] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1E40AF]"
                  >
                    <Save className="h-3.5 w-3.5" />
                    บันทึก
                  </button>
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] font-semibold text-[#475569]">ชื่อสมุดทะเบียน</label>
                  <input
                    type="text"
                    value={seq.registry_name}
                    onChange={(e) =>
                      setSequences((prev) =>
                        prev.map((x) => (x.id === seq.id ? { ...x, registry_name: e.target.value } : x))
                      )
                    }
                    className="ledger-input py-1.5 text-xs"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="mb-0.5 block text-[11px] font-semibold text-[#475569]">Prefix</label>
                    <input
                      type="text"
                      value={seq.prefix}
                      onChange={(e) =>
                        setSequences((prev) => prev.map((x) => (x.id === seq.id ? { ...x, prefix: e.target.value } : x)))
                      }
                      className="ledger-input py-1 text-xs"
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[11px] font-semibold text-[#475569]">ปี พ.ศ.</label>
                    <input
                      type="number"
                      value={seq.year_be}
                      onChange={(e) =>
                        setSequences((prev) =>
                          prev.map((x) => (x.id === seq.id ? { ...x, year_be: Number(e.target.value) } : x))
                        )
                      }
                      className="ledger-input tabular-nums-th py-1 text-xs"
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[11px] font-semibold text-[#475569]">เลขล่าสุด</label>
                    <input
                      type="number"
                      min={0}
                      value={seq.last_number}
                      onChange={(e) =>
                        setSequences((prev) =>
                          prev.map((x) => (x.id === seq.id ? { ...x, last_number: Number(e.target.value) } : x))
                        )
                      }
                      className="ledger-input tabular-nums-th py-1 text-xs font-bold"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop (>= md) Running Number Table */}
          <div className="hidden overflow-x-auto rounded-md border border-[#E2E8F0] md:block">
            <table className="ledger-table text-sm">
              <thead>
                <tr>
                  <th>รหัสทะเบียน</th>
                  <th>ชื่อสมุดทะเบียน</th>
                  <th>คำนำหน้า (Prefix)</th>
                  <th>ปี พ.ศ.</th>
                  <th>เลขล่าสุด</th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {sequences.map((seq) => (
                  <tr key={seq.id}>
                    <td className="font-mono text-xs text-[#475569]">{seq.registry_key}</td>
                    <td>
                      <input
                        type="text"
                        value={seq.registry_name}
                        onChange={(e) =>
                          setSequences((prev) =>
                            prev.map((x) => (x.id === seq.id ? { ...x, registry_name: e.target.value } : x))
                          )
                        }
                        className="ledger-input py-1 text-xs"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={seq.prefix}
                        onChange={(e) =>
                          setSequences((prev) => prev.map((x) => (x.id === seq.id ? { ...x, prefix: e.target.value } : x)))
                        }
                        className="ledger-input w-28 py-1 text-xs"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={seq.year_be}
                        onChange={(e) =>
                          setSequences((prev) =>
                            prev.map((x) => (x.id === seq.id ? { ...x, year_be: Number(e.target.value) } : x))
                          )
                        }
                        className="ledger-input tabular-nums-th w-20 py-1 text-xs"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={seq.last_number}
                        onChange={(e) =>
                          setSequences((prev) =>
                            prev.map((x) => (x.id === seq.id ? { ...x, last_number: Number(e.target.value) } : x))
                          )
                        }
                        className="ledger-input tabular-nums-th w-24 py-1 text-xs font-bold"
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => handleSaveSeq(seq)}
                        className="inline-flex items-center gap-1 rounded-md bg-[#1D4ED8] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#1E40AF]"
                      >
                        <Save className="h-3.5 w-3.5" />
                        บันทึก
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form onSubmit={handleAddSeq} className="mt-4 grid grid-cols-1 items-end gap-2.5 border-t border-[#E2E8F0] pt-4 text-xs sm:grid-cols-2 lg:grid-cols-6">
            <div>
              <label className="mb-1 block font-semibold text-[#475569]">รหัสทะเบียนใหม่</label>
              <input
                type="text"
                placeholder="เช่น order"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                className="ledger-input py-1.5 text-xs"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="mb-1 block font-semibold text-[#475569]">ชื่อสมุดทะเบียน</label>
              <input
                type="text"
                placeholder="เช่น ทะเบียนคำสั่ง ปี 2570"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="ledger-input py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-[#475569]">Prefix</label>
              <input
                type="text"
                value={newPrefix}
                onChange={(e) => setNewPrefix(e.target.value)}
                className="ledger-input py-1.5 text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">ปี พ.ศ.</label>
                <input
                  type="number"
                  value={newYear}
                  onChange={(e) => setNewYear(Number(e.target.value))}
                  className="ledger-input tabular-nums-th py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">เลขเริ่มต้น</label>
                <input
                  type="number"
                  min={0}
                  value={newLastNum}
                  onChange={(e) => setNewLastNum(Number(e.target.value))}
                  className="ledger-input tabular-nums-th py-1.5 text-xs"
                />
              </div>
            </div>
            <button type="submit" className="inline-flex w-full items-center justify-center gap-1 rounded-md bg-[#0F172A] px-3 py-2 font-semibold text-white hover:bg-[#1E293B]">
              <Plus className="h-3.5 w-3.5" />
              เพิ่มทะเบียนปีใหม่
            </button>
          </form>
        </div>
      </section>

      {/* 2. Searchable Document Archive */}
      <section className="ledger-panel overflow-hidden">
        <div className="ledger-panel-header flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-[#0F172A]">คลังเอกสารราชการทั้งหมด ({filteredDocs.length} ฉบับ)</h2>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อเรื่อง เลขที่หนังสือ หรือผู้ร่าง..."
            className="ledger-input w-full py-1.5 text-xs sm:w-72"
          />
        </div>
        {/* Mobile (< md) Adaptive Document Cards */}
        <div className="divide-y divide-[#E2E8F0] md:hidden">
          {filteredDocs.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#475569]">ไม่พบเอกสารที่ตรงกับคำค้นหา</div>
          ) : (
            filteredDocs.map((d) => (
              <div key={d.id} className="space-y-1.5 p-3.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="tabular-nums-th font-bold text-[#1E3A8A]">{d.doc_number || "รอออกเลข"}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="rounded border border-[#CBD5E1] bg-[#F8FAFC] px-1.5 py-0.5 text-[11px] font-medium text-[#334155]">
                      {d.doc_type}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-[#475569]">{d.status}</span>
                  </div>
                </div>
                <div className="font-semibold text-[#0F172A]">{d.subject}</div>
                <div className="flex flex-wrap gap-3 pt-1">
                  {d.docx_path && (
                    <a
                      href={`${API_BASE}${d.docx_path}?download=1`}
                      className="inline-flex items-center gap-1 rounded border border-blue-200 bg-[#EFF6FF] px-2.5 py-1 font-semibold text-[#1D4ED8]"
                    >
                      <Download className="h-3 w-3" />
                      {d.docx_path.toLowerCase().endsWith(".xlsx") ? ".XLSX" : ".DOCX"}
                    </a>
                  )}
                  {typeof d.payload_json?.zip_url === "string" && d.payload_json.zip_url && (
                    <a
                      href={`${API_BASE}${d.payload_json.zip_url}?download=1`}
                      className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700"
                    >
                      <Download className="h-3 w-3" />
                      .ZIP (ทั้งชุด)
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Desktop (>= md) Archive Table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="ledger-table text-xs">
            <thead>
              <tr>
                <th>เลขที่หนังสือ</th>
                <th>ประเภท</th>
                <th>เรื่อง</th>
                <th>สถานะ</th>
                <th>ดาวน์โหลด</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#475569]">
                    ไม่พบเอกสารที่ตรงกับคำค้นหา
                  </td>
                </tr>
              ) : (
                filteredDocs.map((d) => (
                  <tr key={d.id}>
                    <td className="tabular-nums-th font-semibold text-[#0F172A]">{d.doc_number || "-"}</td>
                    <td>
                      <span className="rounded border border-[#CBD5E1] bg-[#F8FAFC] px-1.5 py-0.5 text-[11px] font-medium text-[#334155]">
                        {d.doc_type}
                      </span>
                    </td>
                    <td className="font-medium text-[#0F172A]">{d.subject}</td>
                    <td className="text-[#475569]">{d.status}</td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        {d.docx_path && (
                          <a href={`${API_BASE}${d.docx_path}?download=1`} className="font-semibold text-[#1D4ED8] hover:underline">
                            {d.docx_path.toLowerCase().endsWith(".xlsx") ? ".XLSX" : ".DOCX"}
                          </a>
                        )}
                        {typeof d.payload_json?.zip_url === "string" && d.payload_json.zip_url && (
                          <a href={`${API_BASE}${d.payload_json.zip_url}?download=1`} className="font-semibold text-emerald-700 hover:underline">
                            .ZIP (ทั้งชุด)
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
