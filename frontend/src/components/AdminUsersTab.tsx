"use client";

import { useMemo, useState } from "react";
import {
  Briefcase,
  Building,
  Download,
  Edit2,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { api, formatUserSubtitle, OrgProfile, UserProfile } from "@/lib/api";
import { UserAvatar } from "@/components/UserAvatar";
import { DepartmentHeadSelector, DepartmentHeadValue } from "@/components/DepartmentHeadSelector";
import { inferPersonnelType, ROLE_CONFIG } from "@/lib/personnelConstants";
import { confirmDanger, toastError, toastSuccess } from "@/lib/swal";

interface AdminUsersTabProps {
  users: UserProfile[];
  setUsers: React.Dispatch<React.SetStateAction<UserProfile[]>>;
  divisions: OrgProfile["divisions"];
  currentUserEmail?: string | null;
  onReload: () => Promise<void>;
  onMsg: (msg: string) => void;
  onErr: (err: string) => void;
}

export function AdminUsersTab({
  users,
  setUsers,
  divisions,
  currentUserEmail,
  onReload,
  onMsg,
  onErr,
}: AdminUsersTabProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRole, setSelectedRole] = useState("ALL");
  const [selectedDivision, setSelectedDivision] = useState("ALL");
  const [selectedUnit, setSelectedUnit] = useState("ALL");
  const [selectedStatus, setSelectedStatus] = useState("ALL");
  const [syncingPanel, setSyncingPanel] = useState(false);

  // Create / Edit User Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [formUsername, setFormUsername] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formFullName, setFormFullName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formRole, setFormRole] = useState<string>("drafter");
  const [formIsActive, setFormIsActive] = useState<boolean>(true);
  const [formDeptValue, setFormDeptValue] = useState<DepartmentHeadValue>({
    personnelType: "STAFF",
    positionTitle: "เจ้าหน้าที่",
    divisionCodes: ["ฝบ."],
    primaryDivisionCode: "ฝบ.",
    units: [],
    primaryUnit: "",
    headUnits: [],
  });

  const allUnits = useMemo(() => {
    const set = new Set<string>();
    Object.values(divisions).forEach((d) => (d.units || []).forEach((u) => set.add(u)));
    users.forEach((u) => {
      if (u.unit_name) set.add(u.unit_name);
      (u.units || []).forEach((un) => set.add(un));
    });
    return Array.from(set);
  }, [divisions, users]);

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return users.filter((u) => {
      const userUnits = u.units && u.units.length > 0 ? u.units : u.unit_name ? [u.unit_name] : [];
      const userDivs = u.division_codes && u.division_codes.length > 0 ? u.division_codes : u.division_code ? [u.division_code] : [];

      const matchSearch =
        !q ||
        (u.full_name || "").toLowerCase().includes(q) ||
        (u.username || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q) ||
        (u.position_title || "").toLowerCase().includes(q) ||
        userUnits.some((x) => x.toLowerCase().includes(q));

      const matchRole = selectedRole === "ALL" || u.role === selectedRole;
      const matchDiv = selectedDivision === "ALL" || userDivs.includes(selectedDivision);
      const matchUnit = selectedUnit === "ALL" || userUnits.includes(selectedUnit);
      const matchStatus =
        selectedStatus === "ALL" ||
        (selectedStatus === "ACTIVE" && u.is_active) ||
        (selectedStatus === "INACTIVE" && !u.is_active);

      return matchSearch && matchRole && matchDiv && matchUnit && matchStatus;
    });
  }, [users, searchQuery, selectedRole, selectedDivision, selectedUnit, selectedStatus]);

  function openCreateModal() {
    setEditingUser(null);
    setFormUsername("");
    setFormEmail("");
    setFormFullName("");
    setFormPhone("");
    setFormRole("drafter");
    setFormIsActive(true);
    setFormDeptValue({
      personnelType: "STAFF",
      positionTitle: "เจ้าหน้าที่",
      divisionCodes: ["ฝบ."],
      primaryDivisionCode: "ฝบ.",
      units: [],
      primaryUnit: "",
      headUnits: [],
    });
    setModalOpen(true);
  }

  function openEditModal(u: UserProfile) {
    setEditingUser(u);
    const pt = inferPersonnelType(u.position_title, u.personnel_type);
    const divs = u.division_codes && u.division_codes.length > 0 ? u.division_codes : u.division_code ? [u.division_code] : [];
    const unitList = u.units && u.units.length > 0 ? u.units : u.unit_name ? [u.unit_name] : [];
    setFormUsername(u.username || "");
    setFormEmail(u.email || "");
    setFormFullName(u.full_name || "");
    setFormPhone(u.phone || "");
    setFormRole(u.role || "drafter");
    setFormIsActive(Boolean(u.is_active));
    setFormDeptValue({
      personnelType: pt,
      positionTitle: u.position_title || "เจ้าหน้าที่",
      divisionCodes: divs,
      primaryDivisionCode: u.division_code || divs[0] || "",
      units: unitList,
      primaryUnit: u.unit_name || unitList[0] || "",
      headUnits: u.head_units || [],
    });
    setModalOpen(true);
  }

  async function handleSubmitModal(e: React.FormEvent) {
    e.preventDefault();
    if (!formFullName.trim()) {
      toastError("ข้อมูลไม่ครบ", "กรุณาระบุชื่อ–นามสกุล");
      return;
    }
    if (!editingUser && !formEmail.trim() && !formUsername.trim()) {
      toastError("ข้อมูลไม่ครบ", "กรุณาระบุอีเมลหรือ Username");
      return;
    }
    setSubmitting(true);
    try {
      const primaryDiv = formDeptValue.primaryDivisionCode || formDeptValue.divisionCodes[0] || "";
      const primaryUnit = formDeptValue.primaryUnit || formDeptValue.units[0] || "";

      // Mirror plan.cric.ac.th role rule for drafter <-> unit_head if headUnits selected
      let effectiveRole = formRole;
      if ((effectiveRole === "drafter" || effectiveRole === "unit_head") && formDeptValue.headUnits.length > 0) {
        effectiveRole = "unit_head";
      }

      if (editingUser) {
        const targetId = editingUser.id || editingUser.email || editingUser.username || "";
        await api.updateUser(targetId, {
          full_name: formFullName.trim(),
          email: formEmail.trim() || null,
          username: formUsername.trim() || undefined,
          phone: formPhone.trim(),
          position_title: formDeptValue.positionTitle.trim() || "เจ้าหน้าที่",
          personnel_type: formDeptValue.personnelType,
          division_code: primaryDiv,
          division_codes: formDeptValue.divisionCodes,
          unit_name: primaryUnit,
          units: formDeptValue.units,
          head_units: formDeptValue.headUnits,
          role: effectiveRole as UserProfile["role"],
          is_active: formIsActive,
        });
        onMsg(`อัปเดตข้อมูลและสิทธิ์ของ ${formFullName} แล้ว`);
        toastSuccess("อัปเดตผู้ใช้งานสำเร็จ");
      } else {
        await api.createUser({
          username: formUsername.trim() || undefined,
          email: formEmail.trim() || null,
          full_name: formFullName.trim(),
          phone: formPhone.trim(),
          position_title: formDeptValue.positionTitle.trim() || "เจ้าหน้าที่",
          personnel_type: formDeptValue.personnelType,
          division_code: primaryDiv,
          division_codes: formDeptValue.divisionCodes,
          unit_name: primaryUnit,
          units: formDeptValue.units,
          head_units: formDeptValue.headUnits,
          role: effectiveRole,
          is_active: formIsActive,
        });
        onMsg(`เพิ่มบัญชีผู้ใช้งาน ${formFullName} แล้ว`);
        toastSuccess("เพิ่มผู้ใช้งานสำเร็จ");
      }
      setModalOpen(false);
      await onReload();
    } catch (err) {
      const m = err instanceof Error ? err.message : "บันทึกข้อมูลผู้ใช้ไม่สำเร็จ";
      onErr(m);
      toastError("บันทึกข้อมูลผู้ใช้ไม่สำเร็จ", m);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActive(u: UserProfile) {
    const targetId = u.id || u.email || u.username || "";
    const nextActive = !u.is_active;
    try {
      await api.updateUser(targetId, { is_active: nextActive });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, is_active: nextActive } : x)));
      toastSuccess(nextActive ? `เปิดใช้งาน ${u.full_name} แล้ว` : `ระงับการใช้งาน ${u.full_name} แล้ว`);
    } catch (err) {
      const m = err instanceof Error ? err.message : "เปลี่ยนสถานะไม่สำเร็จ";
      toastError("เปลี่ยนสถานะไม่สำเร็จ", m);
    }
  }

  async function handleDeleteUser(u: UserProfile) {
    const ok = await confirmDanger({
      title: "ยืนยันการลบบัญชีผู้ใช้?",
      text: `ต้องการลบ "${u.full_name}" (${formatUserSubtitle(u)}) ออกจากระบบใช่หรือไม่?`,
      confirmText: "ยืนยันลบผู้ใช้",
    });
    if (!ok) return;

    try {
      await api.deleteUser(u.id || u.email || u.username || "");
      onMsg(`ลบบัญชี ${u.full_name} เรียบร้อยแล้ว`);
      toastSuccess("ลบผู้ใช้งานเรียบร้อย");
      await onReload();
    } catch (err) {
      const m = err instanceof Error ? err.message : "ลบบัญชีผู้ใช้ไม่สำเร็จ";
      onErr(m);
      toastError("ลบบัญชีไม่สำเร็จ", m);
    }
  }

  async function handleUploadSig(identifier: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await api.adminUploadSignature(identifier, file);
      onMsg("อัปโหลดลายเซ็น PNG เรียบร้อยแล้ว");
      toastSuccess("อัปโหลดลายเซ็น PNG สำเร็จ");
      await onReload();
    } catch (err) {
      const m = err instanceof Error ? err.message : "อัปโหลดลายเซ็นไม่สำเร็จ";
      onErr(m);
      toastError("อัปโหลดลายเซ็นไม่สำเร็จ", m);
    }
  }

  function handleExportUsersJson() {
    const payload = {
      exported_at: new Date().toISOString(),
      source: "cric-edocx",
      counts: { users: users.length },
      users,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `edocx-users-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toastSuccess(`ส่งออกข้อมูลบุคลากร ${users.length} รายการเรียบร้อย`);
  }

  return (
    <div className="space-y-4">
      {/* Header Toolbar (modeled after plan.cric.ac.th /admin/users) */}
      <div className="ledger-panel flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0F172A] text-white">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-[#0F172A] sm:text-base">จัดการผู้ใช้งาน สิทธิ์ (RBAC) สังกัด และลายเซ็น</h2>
            <p className="text-xs text-[#64748B]">
              สร้าง แก้ไข กำหนดหลายฝ่าย/หลายงาน/หัวหน้างาน ลายเซ็น PNG และซิงค์ข้อมูลร่วมกับ panel.cric.ac.th
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              setSyncingPanel(true);
              try {
                const res = await api.syncPanelUsers();
                onMsg(`ซิงค์ข้อมูลจาก panel.cric.ac.th สำเร็จ (${res.synced_count} รายการ)`);
                toastSuccess("ซิงค์ผู้ใช้จาก Panel สำเร็จ", `${res.synced_count} รายการ`);
                await onReload();
              } finally {
                setSyncingPanel(false);
              }
            }}
            disabled={syncingPanel}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncingPanel ? "animate-spin" : ""}`} />
            <span>ซิงค์จาก Panel</span>
          </button>
          <button
            type="button"
            onClick={handleExportUsersJson}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-3 py-2 text-xs font-semibold text-[#334155] hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5 text-[#1D4ED8]" />
            <span>ส่งออก JSON</span>
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#1E40AF]"
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>เพิ่มผู้ใช้ใหม่</span>
          </button>
        </div>
      </div>

      {/* 6 Role Summary Stat Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="ledger-panel p-3.5">
          <span className="block text-[11px] font-medium text-[#64748B]">ผู้ใช้ทั้งหมด</span>
          <div className="mt-0.5 text-xl font-bold text-[#0F172A]">{users.length} คน</div>
        </div>
        <div className="ledger-panel p-3.5">
          <span className="block text-[11px] font-medium text-emerald-700">ผู้ร่าง / ครู</span>
          <div className="mt-0.5 text-xl font-bold text-emerald-800">{users.filter((u) => u.role === "drafter").length} คน</div>
        </div>
        <div className="ledger-panel p-3.5">
          <span className="block text-[11px] font-medium text-blue-700">หัวหน้างาน/แผนก</span>
          <div className="mt-0.5 text-xl font-bold text-blue-800">{users.filter((u) => u.role === "unit_head").length} คน</div>
        </div>
        <div className="ledger-panel p-3.5">
          <span className="block text-[11px] font-medium text-purple-700">รองผู้อำนวยการ</span>
          <div className="mt-0.5 text-xl font-bold text-purple-800">{users.filter((u) => u.role === "deputy_director").length} คน</div>
        </div>
        <div className="ledger-panel p-3.5">
          <span className="block text-[11px] font-medium text-rose-700">ผู้อำนวยการ</span>
          <div className="mt-0.5 text-xl font-bold text-rose-800">{users.filter((u) => u.role === "director").length} คน</div>
        </div>
        <div className="ledger-panel p-3.5">
          <span className="block text-[11px] font-medium text-[#334155]">สารบรรณกลาง / Admin</span>
          <div className="mt-0.5 text-xl font-bold text-[#0F172A]">{users.filter((u) => u.role === "saraban_admin").length} คน</div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="ledger-panel space-y-3 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาชื่อ, username, อีเมล, ตำแหน่ง..."
              className="ledger-input pl-9 text-xs"
            />
          </div>
          <select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)} className="ledger-input bg-white text-xs">
            <option value="ALL">-- ทุกบทบาท / สิทธิ์การใช้งาน --</option>
            {Object.entries(ROLE_CONFIG).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <select value={selectedDivision} onChange={(e) => setSelectedDivision(e.target.value)} className="ledger-input bg-white text-xs">
              <option value="ALL">-- ทุกฝ่าย --</option>
              {Object.entries(divisions).map(([code, d]) => (
                <option key={code} value={code}>{code} {d.name}</option>
              ))}
            </select>
            <select value={selectedUnit} onChange={(e) => setSelectedUnit(e.target.value)} className="ledger-input bg-white text-xs">
              <option value="ALL">-- ทุกงาน/แผนก --</option>
              {allUnits.map((un) => (
                <option key={un} value={un}>{un}</option>
              ))}
            </select>
          </div>
          <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)} className="ledger-input bg-white text-xs">
            <option value="ALL">-- ทุกสถานะ --</option>
            <option value="ACTIVE">เปิดใช้งาน (Active)</option>
            <option value="INACTIVE">ระงับใช้งาน (Inactive)</option>
          </select>
        </div>

        <div className="flex items-center justify-between border-t border-[#E2E8F0] pt-2 text-xs text-[#64748B]">
          <span>แสดงผล <strong>{filteredUsers.length}</strong> จากทั้งหมด {users.length} บัญชี</span>
          {(searchQuery || selectedRole !== "ALL" || selectedDivision !== "ALL" || selectedUnit !== "ALL" || selectedStatus !== "ALL") && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setSelectedRole("ALL");
                setSelectedDivision("ALL");
                setSelectedUnit("ALL");
                setSelectedStatus("ALL");
              }}
              className="font-semibold text-[#1D4ED8] hover:underline"
            >
              ล้างตัวกรองทั้งหมด
            </button>
          )}
        </div>
      </div>

      {/* Main Table / Mobile Cards */}
      <div className="ledger-panel overflow-hidden">
        {filteredUsers.length === 0 ? (
          <div className="space-y-2 p-12 text-center text-xs text-[#64748B]">
            <Users className="mx-auto h-10 w-10 opacity-30" />
            <p className="font-bold text-[#334155]">ไม่พบบัญชีผู้ใช้งานตามเงื่อนไขที่กรอง</p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">ผู้ใช้งาน / อีเมล</th>
                    <th className="px-4 py-3 font-semibold">ตำแหน่ง</th>
                    <th className="px-4 py-3 font-semibold">สังกัดฝ่าย / งานที่รับผิดชอบ</th>
                    <th className="px-4 py-3 font-semibold">บทบาท (Role)</th>
                    <th className="px-3 py-3 text-center font-semibold">สถานะ</th>
                    <th className="px-4 py-3 text-right font-semibold">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {filteredUsers.map((u) => {
                    const targetId = u.id || u.username || u.email || "";
                    const roleMeta = ROLE_CONFIG[u.role] || ROLE_CONFIG.drafter;
                    const userDivs = u.division_codes && u.division_codes.length > 0 ? u.division_codes : u.division_code ? [u.division_code] : [];
                    const userUnits = u.units && u.units.length > 0 ? u.units : u.unit_name ? [u.unit_name] : [];
                    const headUnits = u.head_units || [];
                    const isSelf = Boolean(currentUserEmail && u.email && u.email.toLowerCase() === currentUserEmail.toLowerCase());

                    return (
                      <tr key={targetId} className="hover:bg-[#F8FAFC]">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <UserAvatar avatarUrl={u.avatar_url} fullName={u.full_name} size="sm" />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5 font-bold text-[#0F172A]">
                                <span>{u.full_name}</span>
                                {isSelf && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] text-blue-800">คุณ</span>}
                                {u.sso_subject && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] text-emerald-800">SSO</span>}
                              </div>
                              <div className="font-mono text-[11px] text-[#64748B]">{formatUserSubtitle(u)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[#334155]">
                          <div>{u.position_title || "-"}</div>
                          <div className="text-[10px] text-[#64748B]">
                            {inferPersonnelType(u.position_title, u.personnel_type) === "TEACHER" ? "ครู / สายผู้สอน" : "เจ้าหน้าที่ / สนับสนุน"}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {userDivs.map((dc) => (
                              <span key={dc} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#334155]">
                                {dc}
                              </span>
                            ))}
                            {userUnits.slice(0, 2).map((un) => (
                              <span
                                key={un}
                                className={`rounded border px-1.5 py-0.5 text-[10px] ${
                                  headUnits.includes(un)
                                    ? "border-amber-300 bg-amber-50 font-semibold text-amber-900"
                                    : "border-[#E2E8F0] bg-white text-[#475569]"
                                }`}
                              >
                                {un}{headUnits.includes(un) ? " (หัวหน้า)" : ""}
                              </span>
                            ))}
                            {userUnits.length > 2 && <span className="text-[10px] text-[#64748B]">+{userUnits.length - 2}</span>}
                            {userDivs.length === 0 && userUnits.length === 0 && <span className="text-[#94A3B8]">-</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${roleMeta.bg} ${roleMeta.text} ${roleMeta.border}`}>
                            {roleMeta.shortLabel}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleToggleActive(u)}
                            className={`relative inline-flex h-5 w-9 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                              u.is_active ? "bg-emerald-600" : "bg-slate-300"
                            }`}
                            title={u.is_active ? "เปิดใช้งาน (คลิกเพื่อระงับ)" : "ระงับใช้งาน (คลิกเพื่อเปิด)"}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
                                u.is_active ? "translate-x-4" : "translate-x-0"
                              }`}
                            />
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditModal(u)}
                              className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2 py-1 text-[11px] font-semibold text-[#1D4ED8] hover:bg-[#EFF6FF]"
                              title="แก้ไขข้อมูลและสังกัด"
                            >
                              <Edit2 className="h-3 w-3" />
                              แก้ไข
                            </button>
                            <label
                              className={`inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-[11px] font-semibold ${
                                u.signature_storage_path
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                                  : "border-[#CBD5E1] bg-white text-[#334155] hover:bg-slate-50"
                              }`}
                              title="อัปโหลดภาพลายเซ็น PNG"
                            >
                              <Upload className="h-3 w-3" />
                              {u.signature_storage_path ? "ลายเซ็น" : "PNG"}
                              <input type="file" accept="image/png,image/jpeg" onChange={(e) => handleUploadSig(targetId, e)} className="hidden" />
                            </label>
                            {!isSelf && (
                              <button
                                type="button"
                                onClick={() => handleDeleteUser(u)}
                                className="rounded border border-red-200 bg-red-50 p-1.5 text-[#B91C1C] hover:bg-red-100"
                                title="ลบบัญชีผู้ใช้"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Adaptive Cards */}
            <div className="divide-y divide-[#E2E8F0] md:hidden">
              {filteredUsers.map((u) => {
                const targetId = u.id || u.username || u.email || "";
                const roleMeta = ROLE_CONFIG[u.role] || ROLE_CONFIG.drafter;
                const userUnits = u.units && u.units.length > 0 ? u.units : u.unit_name ? [u.unit_name] : [];
                const isSelf = Boolean(currentUserEmail && u.email && u.email.toLowerCase() === currentUserEmail.toLowerCase());
                return (
                  <div key={targetId} className="space-y-2.5 p-4 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <UserAvatar avatarUrl={u.avatar_url} fullName={u.full_name} size="sm" />
                        <div className="min-w-0">
                          <div className="font-bold text-[#0F172A]">{u.full_name}</div>
                          <div className="font-mono text-[11px] text-[#64748B]">{formatUserSubtitle(u)}</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(u)}
                        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent ${
                          u.is_active ? "bg-emerald-600" : "bg-slate-300"
                        }`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow ${u.is_active ? "translate-x-4" : "translate-x-0"}`} />
                      </button>
                    </div>
                    <div className="space-y-1 rounded bg-[#F8FAFC] p-2.5 text-[11px] text-[#475569]">
                      <div className="flex items-center gap-1.5"><Briefcase className="h-3.5 w-3.5" />{u.position_title}</div>
                      <div className="flex items-center gap-1.5"><Building className="h-3.5 w-3.5" />{userUnits.join(", ") || u.division_code || "-"}</div>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${roleMeta.bg} ${roleMeta.text} ${roleMeta.border}`}>
                        {roleMeta.shortLabel}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => openEditModal(u)} className="rounded border border-[#CBD5E1] px-2.5 py-1 font-semibold text-[#1D4ED8]">แก้ไข</button>
                        {!isSelf && (
                          <button type="button" onClick={() => handleDeleteUser(u)} className="rounded border border-red-200 bg-red-50 px-2 py-1 font-semibold text-[#B91C1C]">ลบ</button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Create / Edit User Modal (modeled after plan.cric.ac.th /admin/users modal) */}
      {modalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-xs sm:p-6">
          <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[#CBD5E1] bg-white shadow-2xl">
            <div className="flex shrink-0 items-start justify-between gap-4 bg-[#0F172A] px-5 py-4 text-white">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full border border-blue-400/30 bg-blue-500/20 px-2.5 py-0.5 text-[10px] font-bold text-blue-200">
                  {editingUser ? "แก้ไขผู้ใช้งาน" : "เพิ่มผู้ใช้งานใหม่"}
                </div>
                <h3 className="mt-1 text-base font-bold">
                  {editingUser ? `แก้ไขข้อมูล: ${editingUser.full_name}` : "สร้างบัญชีผู้ใช้งานใน CRIC E-Docx"}
                </h3>
                <p className="text-[11px] text-slate-300">
                  กำหนดประเภทบุคลากร ตำแหน่ง หลายฝ่าย/หลายงาน งานหลัก ตำแหน่งหัวหน้างาน และสิทธิ์บทบาท
                </p>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} className="rounded p-1 text-slate-300 hover:bg-white/10 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitModal} className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 space-y-4 overflow-y-auto p-5 text-xs">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block font-bold text-[#334155]">
                      ชื่อ–นามสกุลจริง (พร้อมคำนำหน้า) <span className="text-[#B91C1C]">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formFullName}
                      onChange={(e) => setFormFullName(e.target.value)}
                      placeholder="เช่น นายสมชาย ใจดี"
                      className="ledger-input"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-bold text-[#334155]">
                      อีเมล (@cric.ac.th) {!editingUser && <span className="text-[#B91C1C]">*</span>}
                    </label>
                    <input
                      type="email"
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                      placeholder="name@cric.ac.th"
                      className="ledger-input"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block font-bold text-[#334155]">Username</label>
                    <input
                      type="text"
                      value={formUsername}
                      onChange={(e) => setFormUsername(e.target.value)}
                      placeholder="somchai"
                      className="ledger-input"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-bold text-[#334155]">เบอร์โทรศัพท์</label>
                    <input
                      type="text"
                      value={formPhone}
                      onChange={(e) => setFormPhone(e.target.value)}
                      placeholder="053-774505"
                      className="ledger-input"
                    />
                  </div>
                  <div>
                    <label className="mb-1 flex items-center gap-1 font-bold text-[#334155]">
                      <ShieldCheck className="h-3.5 w-3.5 text-[#1D4ED8]" />
                      <span>บทบาท (Role)</span>
                    </label>
                    <select value={formRole} onChange={(e) => setFormRole(e.target.value)} className="ledger-input bg-white">
                      {Object.entries(ROLE_CONFIG).map(([key, cfg]) => (
                        <option key={key} value={key}>{cfg.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <DepartmentHeadSelector divisions={divisions} value={formDeptValue} onChange={setFormDeptValue} compact />

                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-3 font-semibold text-[#0F172A]">
                  <input
                    type="checkbox"
                    checked={formIsActive}
                    onChange={(e) => setFormIsActive(e.target.checked)}
                    className="h-4 w-4 accent-[#1D4ED8]"
                  />
                  <span>เปิดใช้งานบัญชีนี้ (อนุญาตให้เข้าสู่ระบบและลงนามเอกสาร)</span>
                </label>
              </div>

              <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#E2E8F0] bg-[#F8FAFC] px-5 py-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-md border border-[#CBD5E1] bg-white px-4 py-2 text-xs font-semibold text-[#334155] hover:bg-slate-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-4 py-2 text-xs font-bold text-white hover:bg-[#1E40AF] disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>{submitting ? "กำลังบันทึก..." : editingUser ? "บันทึกการแก้ไข" : "สร้างบัญชีผู้ใช้"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
