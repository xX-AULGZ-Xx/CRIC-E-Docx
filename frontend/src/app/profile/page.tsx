"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  Building2,
  Camera,
  Loader2,
  PenTool,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { api, formatUserSubtitle, OrgProfile, UserProfile } from "@/lib/api";
import { UserAvatar } from "@/components/UserAvatar";
import { confirmDanger, toastError, toastSuccess } from "@/lib/swal";

const ROLE_LABELS: Record<string, string> = {
  drafter: "ผู้ร่างเอกสาร",
  unit_head: "หัวหน้างาน / หัวหน้าแผนก",
  deputy_director: "รองผู้อำนวยการ",
  director: "ผู้อำนวยการ",
  saraban_admin: "เจ้าหน้าที่สารบรรณกลาง",
};

const DEFAULT_DIVISIONS: Array<{ code: string; name: string }> = [
  { code: "ฝบ.", name: "ฝ่ายบริหารทรัพยากร" },
  { code: "ฝว.", name: "ฝ่ายวิชาการ" },
  { code: "ฝย.", name: "ฝ่ายยุทธศาสตร์และแผนงาน" },
  { code: "ฝก.", name: "ฝ่ายกิจการนักเรียน นักศึกษา" },
];

export default function UserProfilePage() {
  const [me, setMe] = useState<UserProfile | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [orgProfile, setOrgProfile] = useState<OrgProfile | null>(null);

  const [fullName, setFullName] = useState("");
  const [positionTitle, setPositionTitle] = useState("");
  const [divisionCode, setDivisionCode] = useState("");
  const [unitName, setUnitName] = useState("");
  const [phone, setPhone] = useState("");
  const [defaultReviewerEmail, setDefaultReviewerEmail] = useState("");

  const [sigPreviewUrl, setSigPreviewUrl] = useState<string | null>(null);
  const sigUrlRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sigBusy, setSigBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");

  const setBlobPreview = useCallback((nextUrl: string | null) => {
    if (sigUrlRef.current) {
      URL.revokeObjectURL(sigUrlRef.current);
    }
    sigUrlRef.current = nextUrl;
    setSigPreviewUrl(nextUrl);
  }, []);

  const loadSignaturePreview = useCallback(async () => {
    try {
      const url = await api.fetchMySignatureBlobUrl();
      setBlobPreview(url);
    } catch {
      setBlobPreview(null);
    }
  }, [setBlobPreview]);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const [meRes, usersRes, pubRes] = await Promise.all([
        api.me(),
        api.listUsers().catch(() => ({ users: [] })),
        api.getPublicSettings().catch(() => null),
      ]);
      const u = meRes.user;
      setMe(u);
      setUsers(usersRes.users);
      if (pubRes?.org_profile) setOrgProfile(pubRes.org_profile);

      setFullName(u.full_name || "");
      setPositionTitle(u.position_title || "");
      setDivisionCode(u.division_code || "");
      setUnitName(u.unit_name || "");
      setPhone(u.phone || "");
      setDefaultReviewerEmail(u.default_reviewer_email || "");

      if (u.signature_storage_path) {
        await loadSignaturePreview();
      } else {
        setBlobPreview(null);
      }
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : "โหลดข้อมูลโปรไฟล์ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [loadSignaturePreview, setBlobPreview]);

  useEffect(() => {
    loadProfile();
    const onUserChange = () => loadProfile();
    window.addEventListener("cric-user-changed", onUserChange);
    return () => {
      window.removeEventListener("cric-user-changed", onUserChange);
      if (sigUrlRef.current) {
        URL.revokeObjectURL(sigUrlRef.current);
      }
    };
  }, [loadProfile]);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    setErrMsg("");
    if (!fullName.trim() || !positionTitle.trim()) {
      const m = "กรุณาระบุชื่อ–นามสกุล และตำแหน่งราชการให้ครบถ้วน";
      setErrMsg(m);
      toastError("ข้อมูลไม่ครบถ้วน", m);
      return;
    }

    setSaving(true);
    try {
      const res = await api.updateMyProfile({
        full_name: fullName.trim(),
        position_title: positionTitle.trim(),
        division_code: divisionCode,
        unit_name: unitName.trim(),
        phone: phone.trim(),
        default_reviewer_email: defaultReviewerEmail,
      });
      setMe(res.user);
      const okText = "บันทึกข้อมูลโปรไฟล์เรียบร้อยแล้ว ข้อมูลจะถูกนำไปเติมลงแบบฟอร์มเอกสารโดยอัตโนมัติ";
      setMsg(okText);
      toastSuccess("บันทึกโปรไฟล์แล้ว", res.user.full_name);
    } catch (err) {
      const m = err instanceof Error ? err.message : "บันทึกข้อมูลโปรไฟล์ไม่สำเร็จ";
      setErrMsg(m);
      toastError("บันทึกโปรไฟล์ไม่สำเร็จ", m);
    } finally {
      setSaving(false);
    }
  }

  async function handleUploadSig(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSigBusy(true);
    setMsg("");
    setErrMsg("");
    try {
      await api.uploadSignature(file);
      await loadSignaturePreview();
      const meRes = await api.me();
      setMe(meRes.user);
      const okText = "อัปโหลดภาพลายเซ็น PNG เรียบร้อยแล้ว";
      setMsg(okText);
      toastSuccess("อัปโหลดลายเซ็นสำเร็จ");
    } catch (err) {
      const m = err instanceof Error ? err.message : "อัปโหลดลายเซ็นไม่สำเร็จ";
      setErrMsg(m);
      toastError("อัปโหลดลายเซ็นไม่สำเร็จ", m);
    } finally {
      setSigBusy(false);
    }
  }

  async function handleDeleteSig() {
    const ok = await confirmDanger({
      title: "ลบภาพลายเซ็นอิเล็กทรอนิกส์?",
      text: "คุณจะไม่สามารถใช้ลายเซ็นอัตโนมัติในหน้าอนุมัติเอกสารได้ จนกว่าจะอัปโหลดภาพใหม่",
      confirmText: "ยืนยันลบลายเซ็น",
    });
    if (!ok) return;

    setSigBusy(true);
    setMsg("");
    setErrMsg("");
    try {
      await api.deleteMySignature();
      setBlobPreview(null);
      const meRes = await api.me();
      setMe(meRes.user);
      setMsg("ลบภาพลายเซ็นออกจากโปรไฟล์แล้ว");
      toastSuccess("ลบลายเซ็นเรียบร้อย");
    } catch (err) {
      const m = err instanceof Error ? err.message : "ลบลายเซ็นไม่สำเร็จ";
      setErrMsg(m);
      toastError("ลบลายเซ็นไม่สำเร็จ", m);
    } finally {
      setSigBusy(false);
    }
  }

  async function handleUploadAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAvatarBusy(true);
    setMsg("");
    setErrMsg("");
    try {
      await api.uploadAvatar(file);
      const meRes = await api.me();
      setMe(meRes.user);
      setMsg("อัปโหลดรูปโปรไฟล์เรียบร้อยแล้ว");
      toastSuccess("อัปโหลดรูปโปรไฟล์สำเร็จ");
    } catch (err) {
      const m = err instanceof Error ? err.message : "อัปโหลดรูปโปรไฟล์ไม่สำเร็จ";
      setErrMsg(m);
      toastError("อัปโหลดรูปโปรไฟล์ไม่สำเร็จ", m);
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleDeleteAvatar() {
    const ok = await confirmDanger({
      title: "ลบรูปโปรไฟล์?",
      text: "ระบบจะกลับไปแสดงตัวอักษรย่อชื่อแทน หรือซิงค์รูปจาก CRIC Panel เมื่อเข้าสู่ระบบใหม่",
      confirmText: "ยืนยันลบรูป",
    });
    if (!ok) return;

    setAvatarBusy(true);
    setMsg("");
    setErrMsg("");
    try {
      await api.deleteMyAvatar();
      const meRes = await api.me();
      setMe(meRes.user);
      setMsg("ลบรูปโปรไฟล์ออกจากบัญชีแล้ว");
      toastSuccess("ลบรูปโปรไฟล์เรียบร้อย");
    } catch (err) {
      const m = err instanceof Error ? err.message : "ลบรูปโปรไฟล์ไม่สำเร็จ";
      setErrMsg(m);
      toastError("ลบรูปโปรไฟล์ไม่สำเร็จ", m);
    } finally {
      setAvatarBusy(false);
    }
  }

  const divisions = orgProfile?.divisions
    ? Object.entries(orgProfile.divisions).map(([code, info]) => ({ code, name: info.name }))
    : DEFAULT_DIVISIONS;

  const userSubtitle = formatUserSubtitle(me) || "-";
  const avatarUrl = (me?.avatar_url || "").trim();
  const isLocalAvatar = avatarUrl.startsWith("/v1/auth/users/");

  if (loading && !me) {
    return (
      <div className="ledger-panel flex items-center justify-center gap-2 p-12 text-sm text-[#475569]">
        <Loader2 className="h-4 w-4 animate-spin text-[#1D4ED8]" />
        กำลังโหลดข้อมูลโปรไฟล์ผู้ใช้งาน...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Identity Overview Banner with Avatar Manager */}
      <div className="ledger-panel flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <UserAvatar avatarUrl={me?.avatar_url} fullName={me?.full_name} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-[#0F172A]">{me?.full_name || "ผู้ใช้งาน"}</h2>
              <span className="rounded bg-[#EFF6FF] px-2 py-0.5 font-mono text-xs font-semibold text-[#1E3A8A]">
                {userSubtitle}
              </span>
              <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                <ShieldCheck className="h-3 w-3" />
                {me ? ROLE_LABELS[me.role] || me.role : "-"}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#475569]">
              <span>{me?.position_title || "-"}</span>
              <span className="text-[11px] text-[#64748B]">
                · รูปโปรไฟล์:{" "}
                {isLocalAvatar ? "อัปโหลดใน E-Docx" : avatarUrl ? "ซิงค์จาก CRIC Panel / SSO" : "ตัวอักษรย่อ"}
              </span>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1 font-semibold text-[#0F172A] hover:bg-slate-50">
                {avatarBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5 text-[#1D4ED8]" />}
                <span>{avatarUrl ? "เปลี่ยนรูปโปรไฟล์" : "อัปโหลดรูปโปรไฟล์"}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={avatarBusy}
                  onChange={handleUploadAvatar}
                  className="hidden"
                />
              </label>
              {avatarUrl && (
                <button
                  type="button"
                  disabled={avatarBusy}
                  onClick={handleDeleteAvatar}
                  className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 font-semibold text-[#B91C1C] hover:bg-red-100 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>ลบรูป</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 font-semibold ${
              sigPreviewUrl || me?.signature_storage_path
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            <BadgeCheck className="h-3.5 w-3.5" />
            {sigPreviewUrl || me?.signature_storage_path ? "มีลายเซ็นอิเล็กทรอนิกส์แล้ว" : "ยังไม่มีภาพลายเซ็น"}
          </span>
        </div>
      </div>

      {msg && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-900">
          {msg}
        </div>
      )}
      {errMsg && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-medium text-[#B91C1C]">
          {errMsg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* Left: Official Profile & Auto-Fill Preferences */}
        <form onSubmit={handleSaveProfile} className="ledger-panel overflow-hidden xl:col-span-7">
          <div className="ledger-panel-header flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[#1D4ED8]" />
            <h3 className="text-sm font-bold text-[#0F172A]">ข้อมูลราชการและค่าเริ่มต้นการร่างเอกสาร</h3>
          </div>

          <div className="space-y-4 p-4 sm:p-5 text-xs">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">ชื่อ–นามสกุล (พร้อมคำนำหน้า) *</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="เช่น นางสาวขนิษฐา สุใจยา"
                  className="ledger-input"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">ตำแหน่งราชการ *</label>
                <input
                  type="text"
                  required
                  value={positionTitle}
                  onChange={(e) => setPositionTitle(e.target.value)}
                  placeholder="เช่น ครู คศ.1 / หัวหน้างาน"
                  className="ledger-input"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">ฝ่ายงานที่สังกัด</label>
                <select
                  value={divisionCode}
                  onChange={(e) => setDivisionCode(e.target.value)}
                  className="ledger-input"
                >
                  <option value="">-- ไม่ระบุ / ส่วนกลาง --</option>
                  {divisions.map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.code} — {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">ชื่องาน / แผนกวิชา</label>
                <input
                  type="text"
                  value={unitName}
                  onChange={(e) => setUnitName(e.target.value)}
                  placeholder="เช่น งานบริหารงานทั่วไป / แผนกวิชาช่างไฟฟ้า"
                  className="ledger-input"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">เบอร์โทรศัพท์ / เบอร์ภายใน</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="เช่น 053-711-000 ต่อ 105"
                  className="ledger-input tabular-nums-th"
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-[#475569]">ผู้ตรวจร่างเริ่มต้น (ส่งเสนอประจำ)</label>
                <select
                  value={defaultReviewerEmail}
                  onChange={(e) => setDefaultReviewerEmail(e.target.value)}
                  className="ledger-input truncate"
                >
                  <option value="">-- ตามสายงานอัตโนมัติ --</option>
                  {users
                    .filter((u) => Boolean(u.email) && u.email !== me?.email)
                    .map((u) => (
                      <option key={u.id} value={u.email || ""}>
                        {u.full_name} ({u.position_title})
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="rounded-md border border-blue-200 bg-[#EFF6FF]/70 px-3.5 py-2.5 text-[11px] leading-relaxed text-[#1E3A8A]">
              ข้อมูลด้านบนจะถูกนำไปกรอกให้อัตโนมัติในช่องผู้ลงนาม/ผู้ขอซื้อ/ผู้สอน และผู้ตรวจร่างเริ่มต้นของหน้า{" "}
              <strong>ร่างเอกสาร</strong>, <strong>จัดซื้อ สผ.</strong>, <strong>แผนการสอน</strong> และ{" "}
              <strong>แม่แบบเอกสาร</strong>
            </div>

            <div className="flex items-center justify-end border-t border-[#E2E8F0] pt-3">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[#1D4ED8] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-50 sm:w-auto"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                บันทึกข้อมูลโปรไฟล์
              </button>
            </div>
          </div>
        </form>

        {/* Right: Electronic Signature PNG Manager */}
        <section className="ledger-panel overflow-hidden xl:col-span-5">
          <div className="ledger-panel-header flex items-center gap-2">
            <PenTool className="h-4 w-4 text-[#1D4ED8]" />
            <h3 className="text-sm font-bold text-[#0F172A]">ลายเซ็นอิเล็กทรอนิกส์ (.PNG โปร่งใส)</h3>
          </div>

          <div className="space-y-4 p-4 sm:p-5 text-xs">
            <div
              className="flex min-h-[180px] items-center justify-center rounded-md border border-[#CBD5E1] p-4"
              style={{
                backgroundColor: "#f8fafc",
                backgroundImage:
                  "linear-gradient(45deg, #e2e8f0 25%, transparent 25%), linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2e8f0 75%), linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)",
                backgroundSize: "16px 16px",
                backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
              }}
            >
              {sigPreviewUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={sigPreviewUrl}
                  alt="ภาพลายเซ็นปัจจุบัน"
                  className="max-h-36 w-auto max-w-full object-contain"
                />
              ) : (
                <div className="rounded-md bg-white/90 px-4 py-3 text-center text-[#475569] shadow-sm">
                  ยังไม่มีภาพลายเซ็น กรุณาอัปโหลดไฟล์ .PNG พื้นหลังโปร่งใส
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <label className="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-[#0F172A] px-3.5 py-2 font-semibold text-white hover:bg-[#1E293B] sm:flex-initial">
                {sigBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {sigPreviewUrl ? "เปลี่ยนภาพลายเซ็น" : "อัปโหลดภาพลายเซ็น"}
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  disabled={sigBusy}
                  onChange={handleUploadSig}
                  className="hidden"
                />
              </label>

              {sigPreviewUrl && (
                <button
                  type="button"
                  disabled={sigBusy}
                  onClick={handleDeleteSig}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3.5 py-2 font-semibold text-[#B91C1C] hover:bg-red-100 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  ลบลายเซ็น
                </button>
              )}
            </div>

            <div className="space-y-1 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-[11px] leading-relaxed text-[#475569]">
              <p className="font-semibold text-[#0F172A]">คำแนะนำสำหรับไฟล์ลายเซ็น:</p>
              <ul className="list-inside list-disc space-y-0.5">
                <li>แนะนำใช้ไฟล์ <strong>.PNG พื้นหลังโปร่งใส</strong> ขนาดประมาณ 400×160 px เพื่อไม่ให้บังเส้นบรรทัดในเอกสาร Word/PDF</li>
                <li>ระบบจะนำภาพนี้ไปประทับอัตโนมัติเมื่อคุณกด &ldquo;อนุมัติและประทับลายเซ็น&rdquo; ในหน้า <strong>ตรวจร่าง &amp; ลงนาม</strong></li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
