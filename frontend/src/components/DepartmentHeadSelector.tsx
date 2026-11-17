"use client";

import { useState } from "react";
import { Briefcase, Building, Building2, GraduationCap, Plus, ShieldCheck, UserCheck } from "lucide-react";
import { PersonnelType, STAFF_POSITIONS, TEACHER_POSITIONS } from "@/lib/personnelConstants";

export interface DivisionCatalogItem {
  name: string;
  deputy_title: string;
  units?: string[];
}

export interface DepartmentHeadValue {
  personnelType: PersonnelType;
  positionTitle: string;
  divisionCodes: string[];
  primaryDivisionCode: string;
  units: string[];
  primaryUnit: string;
  headUnits: string[];
}

interface DepartmentHeadSelectorProps {
  divisions: Record<string, DivisionCatalogItem>;
  value: DepartmentHeadValue;
  onChange: (next: DepartmentHeadValue) => void;
  compact?: boolean;
}

export function DepartmentHeadSelector({ divisions, value, onChange, compact = false }: DepartmentHeadSelectorProps) {
  const [customUnitInput, setCustomUnitInput] = useState("");
  const presets = value.personnelType === "TEACHER" ? TEACHER_POSITIONS : STAFF_POSITIONS;
  const isCustomPosition = Boolean(value.positionTitle) && !presets.includes(value.positionTitle);
  const [forceOther, setForceOther] = useState(false);
  const showOtherInput = forceOther || isCustomPosition;
  const selectPositionValue = showOtherInput ? "__other__" : (presets.includes(value.positionTitle) ? value.positionTitle : presets[0]);

  function handlePersonnelTypeChange(nextType: PersonnelType) {
    const nextPresets = nextType === "TEACHER" ? TEACHER_POSITIONS : STAFF_POSITIONS;
    const isDefaultOther = TEACHER_POSITIONS.includes(value.positionTitle) || STAFF_POSITIONS.includes(value.positionTitle) || !value.positionTitle;
    const nextPosition = isDefaultOther ? nextPresets[0] : value.positionTitle;
    setForceOther(false);

    let nextDivs = value.divisionCodes;
    let nextPrimaryDiv = value.primaryDivisionCode;
    if (nextDivs.length === 0) {
      const preferred = nextType === "TEACHER" ? "ฝว." : "ฝบ.";
      const fallbackDiv = divisions[preferred] ? preferred : Object.keys(divisions)[0] || "";
      if (fallbackDiv) {
        nextDivs = [fallbackDiv];
        nextPrimaryDiv = fallbackDiv;
      }
    }
    onChange({
      ...value,
      personnelType: nextType,
      positionTitle: nextPosition,
      divisionCodes: nextDivs,
      primaryDivisionCode: nextPrimaryDiv,
    });
  }

  function handleToggleDivision(code: string) {
    const exists = value.divisionCodes.includes(code);
    const nextDivs = exists ? value.divisionCodes.filter((d) => d !== code) : [...value.divisionCodes, code];
    const nextPrimaryDiv = nextDivs.includes(value.primaryDivisionCode) ? value.primaryDivisionCode : (nextDivs[0] || "");
    onChange({
      ...value,
      divisionCodes: nextDivs,
      primaryDivisionCode: nextPrimaryDiv,
    });
  }

  function handleToggleUnit(unitName: string) {
    const exists = value.units.includes(unitName);
    const nextUnits = exists ? value.units.filter((u) => u !== unitName) : [...value.units, unitName];
    const nextPrimaryUnit = nextUnits.includes(value.primaryUnit) ? value.primaryUnit : (nextUnits[0] || "");
    const nextHeads = value.headUnits.filter((h) => nextUnits.includes(h));
    onChange({
      ...value,
      units: nextUnits,
      primaryUnit: nextPrimaryUnit,
      headUnits: nextHeads,
    });
  }

  function handleToggleHeadUnit(unitName: string, e: React.MouseEvent) {
    e.stopPropagation();
    const isSelected = value.units.includes(unitName);
    const nextUnits = isSelected ? value.units : [...value.units, unitName];
    const nextPrimaryUnit = nextUnits.includes(value.primaryUnit) ? value.primaryUnit : (nextUnits[0] || "");
    const isHead = value.headUnits.includes(unitName);
    const nextHeads = isHead ? value.headUnits.filter((h) => h !== unitName) : [...value.headUnits, unitName];
    onChange({
      ...value,
      units: nextUnits,
      primaryUnit: nextPrimaryUnit,
      headUnits: nextHeads,
    });
  }

  function handleAddCustomUnit() {
    const clean = customUnitInput.trim();
    if (!clean) return;
    if (!value.units.includes(clean)) {
      const nextUnits = [...value.units, clean];
      onChange({
        ...value,
        units: nextUnits,
        primaryUnit: value.primaryUnit || clean,
      });
    }
    setCustomUnitInput("");
  }

  const allCatalogUnits = new Set<string>();
  const activeDivEntries = Object.entries(divisions).filter(([code]) => value.divisionCodes.includes(code));
  for (const [, info] of activeDivEntries) {
    for (const u of info.units || []) allCatalogUnits.add(u);
  }
  const extraAssignedUnits = value.units.filter((u) => !allCatalogUnits.has(u));

  return (
    <div className="space-y-4 text-xs">
      {/* 1. Personnel Type Selector */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 font-bold text-[#334155]">
          <Briefcase className="h-3.5 w-3.5 text-[#64748B]" />
          <span>ประเภทบุคลากร</span>
          <span className="text-[#B91C1C]">*</span>
        </label>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => handlePersonnelTypeChange("TEACHER")}
            className={`flex items-center gap-3 rounded-md border p-3 text-left transition-all ${
              value.personnelType === "TEACHER"
                ? "border-[#1D4ED8] bg-[#EFF6FF] text-[#0F172A] ring-1 ring-[#1D4ED8]"
                : "border-[#CBD5E1] bg-white text-[#334155] hover:bg-slate-50"
            }`}
          >
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                value.personnelType === "TEACHER" ? "bg-[#1D4ED8] text-white" : "bg-slate-100 text-[#64748B]"
              }`}
            >
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-[#0F172A]">ครู / สายผู้สอน</div>
              <div className="text-[11px] text-[#64748B]">แผนกวิชา / ช่วยงานฝ่าย</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handlePersonnelTypeChange("STAFF")}
            className={`flex items-center gap-3 rounded-md border p-3 text-left transition-all ${
              value.personnelType === "STAFF"
                ? "border-emerald-600 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-600"
                : "border-[#CBD5E1] bg-white text-[#334155] hover:bg-slate-50"
            }`}
          >
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                value.personnelType === "STAFF" ? "bg-emerald-600 text-white" : "bg-slate-100 text-[#64748B]"
              }`}
            >
              <Building className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-[#0F172A]">เจ้าหน้าที่ / สายสนับสนุน</div>
              <div className="text-[11px] text-[#64748B]">งานตามฝ่ายต่างๆ / สารบรรณ</div>
            </div>
          </button>
        </div>
      </div>

      {/* 2. Position Dropdown + Custom Other */}
      <div className="space-y-1.5">
        <label className="block font-bold text-[#334155]">
          ตำแหน่งทางการ <span className="text-[#B91C1C]">*</span>
        </label>
        <select
          value={selectPositionValue}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "__other__") {
              setForceOther(true);
              if (presets.includes(value.positionTitle)) {
                onChange({ ...value, positionTitle: "" });
              }
            } else {
              setForceOther(false);
              onChange({ ...value, positionTitle: val });
            }
          }}
          className="ledger-input bg-white text-xs sm:text-sm"
        >
          {presets.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          <option value="__other__">ระบุตำแหน่งอื่นๆ...</option>
        </select>

        {showOtherInput && (
          <input
            type="text"
            required
            value={value.positionTitle}
            onChange={(e) => onChange({ ...value, positionTitle: e.target.value })}
            placeholder="พิมพ์ระบุตำแหน่ง เช่น พนักงานราชการ, รองผู้อำนวยการฝ่าย..."
            className="ledger-input mt-2 text-xs sm:text-sm"
          />
        )}
      </div>

      {/* 3. Multi-Division Checkboxes */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 font-bold text-[#334155]">
            <Building2 className="h-3.5 w-3.5 text-[#64748B]" />
            <span>ฝ่ายงานที่ปฏิบัติหน้าที่ (เลือกได้มากกว่า 1 ฝ่าย)</span>
          </label>
          <span className="rounded-full border border-blue-200 bg-[#EFF6FF] px-2.5 py-0.5 text-[11px] font-bold text-[#1E3A8A]">
            เลือกแล้ว {value.divisionCodes.length} ฝ่าย
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Object.entries(divisions).map(([code, info]) => {
            const checked = value.divisionCodes.includes(code);
            const isPrimaryDiv = value.primaryDivisionCode === code;
            return (
              <div
                key={code}
                onClick={() => handleToggleDivision(code)}
                className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border p-2.5 transition ${
                  checked
                    ? "border-[#1D4ED8] bg-[#EFF6FF] font-semibold text-[#0F172A] ring-1 ring-[#1D4ED8]/40"
                    : "border-[#CBD5E1] bg-white text-[#334155] hover:bg-slate-50"
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {}}
                    className="pointer-events-none h-4 w-4 accent-[#1D4ED8]"
                  />
                  <span className="truncate">{info.name}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {checked && !isPrimaryDiv && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onChange({ ...value, primaryDivisionCode: code });
                      }}
                      className="rounded border border-blue-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-[#1D4ED8] hover:bg-blue-50"
                    >
                      ตั้งฝ่ายหลัก
                    </button>
                  )}
                  {checked && isPrimaryDiv && (
                    <span className="rounded bg-[#1D4ED8] px-1.5 py-0.5 text-[9px] font-bold text-white">ฝ่ายหลัก</span>
                  )}
                  <span className="font-mono text-[10px] text-[#64748B]">{code}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Departments / Works Multi-Select with Primary + Head Toggle */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 font-bold text-[#334155]">
            <UserCheck className="h-3.5 w-3.5 text-[#64748B]" />
            <span>{value.personnelType === "TEACHER" ? "แผนกวิชา / งานที่รับผิดชอบ" : "งานที่รับผิดชอบในฝ่าย"}</span>
          </label>
          <span className="rounded-full border border-blue-200 bg-[#EFF6FF] px-2.5 py-0.5 text-[11px] font-bold text-[#1E3A8A]">
            เลือก {value.units.length} งาน / หัวหน้างาน {value.headUnits.length} งาน
          </span>
        </div>

        <div className={`${compact ? "max-h-56" : "max-h-72"} space-y-3 overflow-y-auto rounded-md border border-[#CBD5E1] bg-[#F8FAFC] p-3`}>
          {activeDivEntries.length === 0 && extraAssignedUnits.length === 0 ? (
            <div className="py-5 text-center text-xs text-[#64748B]">
              กรุณาเลือกฝ่ายงานด้านบนเพื่อแสดงรายการงาน/แผนกวิชา
            </div>
          ) : (
            <>
              {activeDivEntries.map(([code, info]) => {
                const unitItems = info.units || [];
                return (
                  <div key={code} className="space-y-1.5">
                    <div className="flex items-center justify-between rounded bg-slate-200/80 px-2.5 py-1 text-[11px] font-bold text-[#334155]">
                      <span>{info.name}</span>
                      <span className="font-mono text-[10px] text-[#64748B]">{code}</span>
                    </div>
                    {unitItems.length === 0 ? (
                      <div className="px-2 py-1 text-[11px] text-[#64748B]">ยังไม่มีรายการงานในฝ่ายนี้ (เพิ่มเองด้านล่างได้)</div>
                    ) : (
                      <div className="space-y-1.5 pl-0.5">
                        {unitItems.map((unitName) => {
                          const isChecked = value.units.includes(unitName);
                          const isPrimary = value.primaryUnit === unitName;
                          const isHead = value.headUnits.includes(unitName);
                          return (
                            <div
                              key={`${code}-${unitName}`}
                              onClick={() => handleToggleUnit(unitName)}
                              className={`flex cursor-pointer flex-col justify-between gap-2 rounded-md border p-2 transition sm:flex-row sm:items-center ${
                                isChecked
                                  ? "border-[#1D4ED8]/50 bg-white font-semibold text-[#0F172A] ring-1 ring-[#1D4ED8]/20"
                                  : "border-[#E2E8F0] bg-white/80 text-[#334155] hover:bg-white"
                              }`}
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {}}
                                  className="pointer-events-none h-4 w-4 shrink-0 accent-[#1D4ED8]"
                                />
                                <span className="truncate">{unitName}</span>
                                {isPrimary && (
                                  <span className="shrink-0 rounded bg-[#1D4ED8] px-1.5 py-0.5 text-[9px] font-bold text-white">
                                    งานหลัก
                                  </span>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-center">
                                {isChecked && !isPrimary && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onChange({ ...value, primaryUnit: unitName });
                                    }}
                                    className="rounded border border-[#CBD5E1] bg-[#F8FAFC] px-2 py-0.5 text-[10px] font-semibold text-[#475569] hover:border-[#1D4ED8]/40 hover:bg-[#EFF6FF] hover:text-[#1D4ED8]"
                                  >
                                    ตั้งเป็นงานหลัก
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => handleToggleHeadUnit(unitName, e)}
                                  className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-bold transition ${
                                    isHead
                                      ? "border-amber-600 bg-amber-500 text-white"
                                      : "border-[#CBD5E1] bg-slate-100 text-[#475569] hover:border-amber-300 hover:bg-amber-50 hover:text-amber-900"
                                  }`}
                                  title="ระบุว่าดำรงตำแหน่งหัวหน้างาน/หัวหน้าแผนกนี้"
                                >
                                  <ShieldCheck className="h-3 w-3" />
                                  <span>{isHead ? "✓ เป็นหัวหน้างาน" : "+ เป็นหัวหน้างาน"}</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {extraAssignedUnits.length > 0 && (
                <div className="space-y-1.5">
                  <div className="rounded bg-slate-200/80 px-2.5 py-1 text-[11px] font-bold text-[#334155]">
                    งานที่ระบุเพิ่มเติม
                  </div>
                  {extraAssignedUnits.map((unitName) => {
                    const isPrimary = value.primaryUnit === unitName;
                    const isHead = value.headUnits.includes(unitName);
                    return (
                      <div
                        key={`extra-${unitName}`}
                        onClick={() => handleToggleUnit(unitName)}
                        className="flex cursor-pointer flex-col justify-between gap-2 rounded-md border border-[#1D4ED8]/50 bg-white p-2 font-semibold text-[#0F172A] sm:flex-row sm:items-center"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <input type="checkbox" checked onChange={() => {}} className="pointer-events-none h-4 w-4 accent-[#1D4ED8]" />
                          <span className="truncate">{unitName}</span>
                          {isPrimary && (
                            <span className="shrink-0 rounded bg-[#1D4ED8] px-1.5 py-0.5 text-[9px] font-bold text-white">
                              งานหลัก
                            </span>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-center">
                          {!isPrimary && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onChange({ ...value, primaryUnit: unitName });
                              }}
                              className="rounded border border-[#CBD5E1] bg-[#F8FAFC] px-2 py-0.5 text-[10px] font-semibold text-[#475569] hover:bg-[#EFF6FF] hover:text-[#1D4ED8]"
                            >
                              ตั้งเป็นงานหลัก
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => handleToggleHeadUnit(unitName, e)}
                            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-bold ${
                              isHead
                                ? "border-amber-600 bg-amber-500 text-white"
                                : "border-[#CBD5E1] bg-slate-100 text-[#475569] hover:bg-amber-50"
                            }`}
                          >
                            <ShieldCheck className="h-3 w-3" />
                            <span>{isHead ? "✓ เป็นหัวหน้างาน" : "+ เป็นหัวหน้างาน"}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Add Custom Work/Unit inline */}
        <div className="flex gap-2">
          <input
            type="text"
            value={customUnitInput}
            onChange={(e) => setCustomUnitInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddCustomUnit();
              }
            }}
            placeholder="หากไม่มีชื่องานในรายการ สามารถพิมพ์เพิ่มเองที่นี่..."
            className="ledger-input flex-1 py-1.5 text-xs"
          />
          <button
            type="button"
            onClick={handleAddCustomUnit}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-semibold text-[#0F172A] hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" />
            เพิ่มงาน
          </button>
        </div>
      </div>
    </div>
  );
}
