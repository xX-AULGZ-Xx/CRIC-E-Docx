"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft as ArrowLeftIcon,
  ArrowRight as ArrowRightIcon,
  ArrowUp,
  BadgeCheck,
  Building2,
  Camera,
  Crop,
  Eraser,
  ExternalLink,
  Loader2,
  Lock,
  Mail,
  Move,
  PenTool,
  Phone,
  RefreshCw,
  RotateCw,
  Save,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  User as UserIcon,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { api, formatUserSubtitle, OrgProfile, resolveAvatarSrc, SSO_URL, UserProfile } from "@/lib/api";
import { DepartmentHeadSelector, DepartmentHeadValue } from "@/components/DepartmentHeadSelector";
import { UserAvatar } from "@/components/UserAvatar";
import { inferPersonnelType, ROLE_CONFIG, STAFF_POSITIONS, TEACHER_POSITIONS } from "@/lib/personnelConstants";
import { confirmDanger, toastError, toastSuccess } from "@/lib/swal";

type ProfileTab = "info" | "avatar" | "signature" | "security";

const FALLBACK_DIVISIONS: OrgProfile["divisions"] = {
  "ฝบ.": { name: "ฝ่ายบริหารทรัพยากร", deputy_title: "รองผู้อำนวยการฝ่ายบริหารทรัพยากร", units: ["งานบริหารงานทั่วไป", "งานสารบรรณ", "งานพัสดุ"] },
  "ฝว.": { name: "ฝ่ายวิชาการ", deputy_title: "รองผู้อำนวยการฝ่ายวิชาการ", units: ["งานพัฒนาหลักสูตรการเรียนการสอน", "แผนกวิชาเทคโนโลยีสารสนเทศ"] },
  "ฝย.": { name: "ฝ่ายยุทธศาสตร์และแผนงาน", deputy_title: "รองผู้อำนวยการฝ่ายยุทธศาสตร์และแผนงาน", units: ["งานวางแผนและงบประมาณ"] },
  "ฝก.": { name: "ฝ่ายพัฒนากิจการนักเรียน นักศึกษา", deputy_title: "รองผู้อำนวยการฝ่ายพัฒนากิจการนักเรียน นักศึกษา", units: ["งานกิจกรรมนักเรียน นักศึกษา"] },
};

function ProfileSettingsContent() {
  const searchParams = useSearchParams();
  const initialTabParam = searchParams.get("tab");
  const validTab = (v: string | null): ProfileTab =>
    v === "avatar" || v === "signature" || v === "security" || v === "info" ? v : "info";

  const [activeTab, setActiveTab] = useState<ProfileTab>(() => validTab(initialTabParam));

  useEffect(() => {
    if (initialTabParam) {
      setActiveTab(validTab(initialTabParam));
    }
  }, [initialTabParam]);
  const [me, setMe] = useState<UserProfile | null>(null);
  const [authSource, setAuthSource] = useState("");
  const [ssoIssuer, setSsoIssuer] = useState("");
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [orgProfile, setOrgProfile] = useState<OrgProfile | null>(null);

  // Tab 1: General info & Multi-division/unit state
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [defaultReviewerEmail, setDefaultReviewerEmail] = useState("");
  const [deptValue, setDeptValue] = useState<DepartmentHeadValue>({
    personnelType: "STAFF",
    positionTitle: "เจ้าหน้าที่",
    divisionCodes: [],
    primaryDivisionCode: "",
    units: [],
    primaryUnit: "",
    headUnits: [],
  });

  // Tab 2: Avatar Cropper Canvas State
  const [rawAvatarSrc, setRawAvatarSrc] = useState<string | null>(null);
  const [avatarZoom, setAvatarZoom] = useState<number>(1);
  const [avatarOffsetX, setAvatarOffsetX] = useState<number>(0);
  const [avatarOffsetY, setAvatarOffsetY] = useState<number>(0);
  const [avatarRotation, setAvatarRotation] = useState<number>(0);
  const [isDraggingAvatar, setIsDraggingAvatar] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [avatarImgReady, setAvatarImgReady] = useState<boolean>(false);
  const [avatarCanvasError, setAvatarCanvasError] = useState<string>("");
  const avatarCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const avatarImageRef = useRef<HTMLImageElement | null>(null);

  // Tab 3: Signature PNG & Canvas Draw State
  const [sigPreviewUrl, setSigPreviewUrl] = useState<string | null>(null);
  const sigUrlRef = useRef<string | null>(null);
  const [sigMode, setSigMode] = useState<"upload" | "draw">("upload");
  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawingSig, setIsDrawingSig] = useState<boolean>(false);
  const [hasDrawnSig, setHasDrawnSig] = useState<boolean>(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [sigBusy, setSigBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");

  const setBlobPreview = useCallback((nextUrl: string | null) => {
    if (sigUrlRef.current) URL.revokeObjectURL(sigUrlRef.current);
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

  const applyUserToForm = useCallback((u: UserProfile) => {
    const inferredType = inferPersonnelType(u.position_title, u.personnel_type);
    const defaultPos = inferredType === "TEACHER" ? TEACHER_POSITIONS[0] : STAFF_POSITIONS[0];
    const divCodes = u.division_codes && u.division_codes.length > 0 ? u.division_codes : u.division_code ? [u.division_code] : [];
    const unitList = u.units && u.units.length > 0 ? u.units : u.unit_name ? [u.unit_name] : [];

    setFullName(u.full_name || "");
    setEmail(u.email || "");
    setPhone(u.phone || "");
    setDefaultReviewerEmail(u.default_reviewer_email || "");
    setDeptValue({
      personnelType: inferredType,
      positionTitle: u.position_title || defaultPos,
      divisionCodes: divCodes,
      primaryDivisionCode: u.division_code || divCodes[0] || "",
      units: unitList,
      primaryUnit: u.unit_name || unitList[0] || "",
      headUnits: u.head_units || [],
    });
    if (u.avatar_url) {
      setRawAvatarSrc(resolveAvatarSrc(u.avatar_url));
    }
  }, []);

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
      setAuthSource(meRes.auth_source || "");
      setSsoIssuer(meRes.sso_issuer || "");
      setUsers(usersRes.users);
      if (pubRes?.org_profile) setOrgProfile(pubRes.org_profile);
      applyUserToForm(u);

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
  }, [applyUserToForm, loadSignaturePreview, setBlobPreview]);

  useEffect(() => {
    loadProfile();
    const onUserChange = () => loadProfile();
    window.addEventListener("cric-user-changed", onUserChange);
    return () => {
      window.removeEventListener("cric-user-changed", onUserChange);
      if (sigUrlRef.current) URL.revokeObjectURL(sigUrlRef.current);
    };
  }, [loadProfile]);

  // --- Avatar Cropper Canvas Rendering ---
  useEffect(() => {
    if (!rawAvatarSrc) {
      avatarImageRef.current = null;
      setAvatarImgReady(false);
      return;
    }
    setAvatarCanvasError("");
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      avatarImageRef.current = img;
      setAvatarImgReady(true);
    };
    img.onerror = () => {
      avatarImageRef.current = null;
      setAvatarImgReady(false);
      setAvatarCanvasError("ไม่สามารถโหลดรูปเดิมเข้าเครื่องมือปรับตำแหน่งได้ (กรุณาเลือกไฟล์รูปใหม่จากเครื่อง)");
    };
    img.src = rawAvatarSrc;
  }, [rawAvatarSrc]);

  const drawAvatarCanvas = useCallback(() => {
    const canvas = avatarCanvasRef.current;
    const img = avatarImageRef.current;
    if (!canvas || !img || !avatarImgReady) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, cw, ch);

    const baseScale = Math.max(cw / img.width, ch / img.height);
    const scale = baseScale * avatarZoom;

    ctx.save();
    ctx.translate(cw / 2 + avatarOffsetX, ch / 2 + avatarOffsetY);
    ctx.rotate((avatarRotation * Math.PI) / 180);
    ctx.scale(scale, scale);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
  }, [avatarImgReady, avatarOffsetX, avatarOffsetY, avatarRotation, avatarZoom]);

  useEffect(() => {
    if (activeTab === "avatar") drawAvatarCanvas();
  }, [activeTab, drawAvatarCanvas]);

  function resetAvatarPosition() {
    setAvatarZoom(1);
    setAvatarOffsetX(0);
    setAvatarOffsetY(0);
    setAvatarRotation(0);
  }

  function handleSelectAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setRawAvatarSrc(reader.result);
        resetAvatarPosition();
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleSaveCroppedAvatar() {
    const canvas = avatarCanvasRef.current;
    if (!canvas || !avatarImgReady) {
      toastError("ยังไม่มีรูปภาพพร้อมบันทึก", "กรุณาเลือกไฟล์รูปภาพจากเครื่องก่อน");
      return;
    }
    setAvatarBusy(true);
    setMsg("");
    setErrMsg("");
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("ไม่สามารถสร้างไฟล์ภาพจาก Canvas ได้"))), "image/png");
      });
      const croppedFile = new File([blob], "avatar.png", { type: "image/png" });
      await api.uploadAvatar(croppedFile);
      const meRes = await api.me();
      setMe(meRes.user);
      if (meRes.user.avatar_url) setRawAvatarSrc(resolveAvatarSrc(meRes.user.avatar_url));
      setMsg("ตัดและบันทึกรูปโปรไฟล์เรียบร้อยแล้ว");
      toastSuccess("บันทึกรูปโปรไฟล์สำเร็จ");
    } catch (err) {
      const m = err instanceof Error ? err.message : "บันทึกรูปโปรไฟล์ไม่สำเร็จ";
      setErrMsg(m);
      toastError("บันทึกรูปโปรไฟล์ไม่สำเร็จ", m);
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
      setRawAvatarSrc(null);
      resetAvatarPosition();
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

  // --- Profile General Info Save ---
  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    setErrMsg("");
    if (!fullName.trim() || !deptValue.positionTitle.trim()) {
      const m = "กรุณาระบุชื่อ–นามสกุล และตำแหน่งราชการให้ครบถ้วน";
      setErrMsg(m);
      toastError("ข้อมูลไม่ครบถ้วน", m);
      return;
    }
    setSaving(true);
    try {
      const primaryDiv = deptValue.primaryDivisionCode || deptValue.divisionCodes[0] || "";
      const primaryUnit = deptValue.primaryUnit || deptValue.units[0] || "";
      const res = await api.updateMyProfile({
        full_name: fullName.trim(),
        email: email.trim() || undefined,
        position_title: deptValue.positionTitle.trim(),
        personnel_type: deptValue.personnelType,
        division_code: primaryDiv,
        division_codes: deptValue.divisionCodes,
        unit_name: primaryUnit,
        units: deptValue.units,
        head_units: deptValue.headUnits,
        phone: phone.trim(),
        default_reviewer_email: defaultReviewerEmail,
      });
      setMe(res.user);
      applyUserToForm(res.user);
      setMsg("บันทึกข้อมูลโปรไฟล์และสังกัดเรียบร้อยแล้ว");
      toastSuccess("บันทึกโปรไฟล์สำเร็จ");
    } catch (err) {
      const m = err instanceof Error ? err.message : "บันทึกโปรไฟล์ไม่สำเร็จ";
      setErrMsg(m);
      toastError("บันทึกโปรไฟล์ไม่สำเร็จ", m);
    } finally {
      setSaving(false);
    }
  }

  // --- Signature Upload & Canvas Draw ---
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
      setMsg("อัปโหลดภาพลายเซ็น PNG เรียบร้อยแล้ว");
      toastSuccess("อัปโหลดลายเซ็นสำเร็จ");
    } catch (err) {
      const m = err instanceof Error ? err.message : "อัปโหลดลายเซ็นไม่สำเร็จ";
      setErrMsg(m);
      toastError("อัปโหลดลายเซ็นไม่สำเร็จ", m);
    } finally {
      setSigBusy(false);
    }
  }

  function getCanvasCoords(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  function startSigDraw(clientX: number, clientY: number) {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCanvasCoords(canvas, clientX, clientY);
    setIsDrawingSig(true);
    setHasDrawnSig(true);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function moveSigDraw(clientX: number, clientY: number) {
    if (!isDrawingSig) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCanvasCoords(canvas, clientX, clientY);
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0F172A";
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function clearSigCanvas() {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawnSig(false);
  }

  async function handleSaveDrawnSignature() {
    const canvas = sigCanvasRef.current;
    if (!canvas || !hasDrawnSig) {
      toastError("ยังไม่มีลายเซ็นบนกระดาน", "กรุณาวาดลายเซ็นก่อนบันทึก");
      return;
    }
    setSigBusy(true);
    setMsg("");
    setErrMsg("");
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("ไม่สามารถสร้างไฟล์ PNG ได้"))), "image/png");
      });
      const sigFile = new File([blob], "drawn_signature.png", { type: "image/png" });
      await api.uploadSignature(sigFile);
      await loadSignaturePreview();
      const meRes = await api.me();
      setMe(meRes.user);
      clearSigCanvas();
      setMsg("บันทึกลายเซ็นจากการวาด (.PNG โปร่งใส) เรียบร้อยแล้ว");
      toastSuccess("บันทึกลายเซ็นสำเร็จ");
    } catch (err) {
      const m = err instanceof Error ? err.message : "บันทึกลายเซ็นไม่สำเร็จ";
      setErrMsg(m);
      toastError("บันทึกลายเซ็นไม่สำเร็จ", m);
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

  const divisionsCatalog = orgProfile?.divisions && Object.keys(orgProfile.divisions).length > 0 ? orgProfile.divisions : FALLBACK_DIVISIONS;
  const userSubtitle = formatUserSubtitle(me) || "-";
  const roleMeta = ROLE_CONFIG[me?.role || "drafter"] || ROLE_CONFIG.drafter;

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
      {/* Hero Identity Banner (modeled after plan.cric.ac.th /profile/settings) */}
      <div className="ledger-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 bg-[#0F172A] px-5 py-5 text-white">
          <div className="flex flex-wrap items-center gap-4">
            <UserAvatar avatarUrl={me?.avatar_url} fullName={me?.full_name} size="lg" className="ring-2 ring-white/30" />
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight">{me?.full_name || "ผู้ใช้งาน"}</h2>
                <span className="rounded-full border border-white/25 bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  {roleMeta.shortLabel}
                </span>
                {deptValue.personnelType === "TEACHER" ? (
                  <span className="rounded-full bg-blue-500/25 px-2 py-0.5 text-[10px] font-semibold text-blue-200">ครู / สายผู้สอน</span>
                ) : (
                  <span className="rounded-full bg-emerald-500/25 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">เจ้าหน้าที่ / สนับสนุน</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-200">
                <span className="flex items-center gap-1.5 font-mono">
                  <Mail className="h-3.5 w-3.5 text-slate-300" />
                  {userSubtitle}
                </span>
                {me?.position_title && (
                  <>
                    <span className="text-slate-500">•</span>
                    <span>{me.position_title}</span>
                  </>
                )}
              </div>
              {deptValue.units.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[11px] text-slate-300">
                  <span>สังกัด:</span>
                  {deptValue.units.slice(0, 3).map((u) => (
                    <span key={u} className="rounded bg-white/10 px-2 py-0.5 text-[10px] text-white">
                      {u}
                      {deptValue.headUnits.includes(u) ? " (หัวหน้า)" : ""}
                    </span>
                  ))}
                  {deptValue.units.length > 3 && <span className="text-[10px] text-slate-400">+{deptValue.units.length - 3} งาน</span>}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 font-semibold ${
                sigPreviewUrl || me?.signature_storage_path
                  ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-100"
                  : "border-amber-400/40 bg-amber-500/20 text-amber-100"
              }`}
            >
              <BadgeCheck className="h-3.5 w-3.5" />
              {sigPreviewUrl || me?.signature_storage_path ? "มีลายเซ็นอิเล็กทรอนิกส์แล้ว" : "ยังไม่มีภาพลายเซ็น"}
            </span>
            <Link
              href="/profile"
              className="inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-3 py-1.5 font-semibold text-white hover:bg-white/20"
            >
              <ArrowLeftIcon className="h-3.5 w-3.5" />
              <span>ศูนย์รวมเอกสารของฉัน</span>
            </Link>
          </div>
        </div>

        {/* 4 Navigation Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto border-t border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2">
          {[
            { id: "info" as ProfileTab, label: "ข้อมูลทั่วไปและสังกัด", icon: UserIcon },
            { id: "avatar" as ProfileTab, label: "รูปภาพโปรไฟล์ & ปรับตำแหน่ง", icon: Camera },
            { id: "signature" as ProfileTab, label: "ลายเซ็นอิเล็กทรอนิกส์ (.PNG / วาด)", icon: PenTool },
            { id: "security" as ProfileTab, label: "การเชื่อมต่อบัญชี & SSO", icon: Lock },
          ].map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-md px-3.5 py-2 text-xs font-semibold transition ${
                  active
                    ? "border border-[#CBD5E1] bg-white text-[#1E3A8A] shadow-xs"
                    : "text-[#475569] hover:bg-white/70 hover:text-[#0F172A]"
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${active ? "text-[#1D4ED8]" : "text-[#64748B]"}`} />
                <span>{t.label}</span>
              </button>
            );
          })}
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

      {/* TAB 1: Info, Personnel Type, Positions, Multi-Division, Multi-Unit & Head Toggle */}
      {activeTab === "info" && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          <form onSubmit={handleSaveProfile} className="ledger-panel overflow-hidden xl:col-span-8">
            <div className="ledger-panel-header flex items-center gap-2">
              <Building2 className="h-4 w-4 text-[#1D4ED8]" />
              <h3 className="text-sm font-bold text-[#0F172A]">ข้อมูลส่วนตัว ตำแหน่ง และสังกัดหลายฝ่าย/งาน</h3>
            </div>

            <div className="space-y-4 p-4 text-xs sm:p-5">
              <div>
                <label className="mb-1 block font-bold text-[#334155]">
                  ชื่อ–นามสกุลจริง (พร้อมคำนำหน้า เช่น นาย, นาง, นางสาว, ดร.) <span className="text-[#B91C1C]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="เช่น นางสาวขนิษฐา สุใจยา"
                  className="ledger-input text-sm"
                />
              </div>

              <DepartmentHeadSelector divisions={divisionsCatalog} value={deptValue} onChange={setDeptValue} />

              <div className="grid grid-cols-1 gap-3 border-t border-[#E2E8F0] pt-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1 flex items-center gap-1 font-bold text-[#334155]">
                    <Mail className="h-3.5 w-3.5 text-[#64748B]" />
                    <span>อีเมลติดต่อ</span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@cric.ac.th"
                    className="ledger-input"
                  />
                </div>
                <div>
                  <label className="mb-1 flex items-center gap-1 font-bold text-[#334155]">
                    <Phone className="h-3.5 w-3.5 text-[#64748B]" />
                    <span>เบอร์โทรศัพท์ / เบอร์ภายใน</span>
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="เช่น 053-711-000 ต่อ 105"
                    className="ledger-input tabular-nums-th"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-bold text-[#334155]">ผู้ตรวจร่างเริ่มต้น (ส่งเสนอประจำ)</label>
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

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E8F0] pt-4">
                <span className="text-[11px] text-[#64748B]">
                  ฝ่ายหลัก ({deptValue.primaryDivisionCode || "-"}) และงานหลัก ({deptValue.primaryUnit || "-"}) จะถูกนำไปกรอกในเอกสารราชการอัตโนมัติ
                </span>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[#1D4ED8] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-50 sm:w-auto"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  บันทึกข้อมูลส่วนตัวและสังกัด
                </button>
              </div>
            </div>
          </form>

          {/* Right RBAC & Guidance Cards */}
          <div className="space-y-4 xl:col-span-4">
            <div className="ledger-panel overflow-hidden">
              <div className="ledger-panel-header flex items-center gap-2">
                <Shield className="h-4 w-4 text-[#1D4ED8]" />
                <h3 className="text-sm font-bold text-[#0F172A]">สิทธิ์การใช้งาน (RBAC)</h3>
              </div>
              <div className="space-y-2.5 p-4 text-xs text-[#475569]">
                <p>
                  คุณเข้าสู่ระบบด้วยสิทธิ์{" "}
                  <span className={`inline-block rounded border px-2 py-0.5 font-bold ${roleMeta.bg} ${roleMeta.text} ${roleMeta.border}`}>
                    {roleMeta.label}
                  </span>
                </p>
                <ul className="list-inside list-disc space-y-1 text-[11px] leading-relaxed">
                  <li>สามารถร่างบันทึกข้อความ จัดซื้อ สผ. และแผนการสอนตามฝ่าย/งานที่สังกัด</li>
                  <li>หากติ๊ก &ldquo;เป็นหัวหน้างาน&rdquo; และสิทธิ์เดิมเป็นผู้ร่าง ระบบจะปรับเป็นหัวหน้างานโดยอัตโนมัติ</li>
                  <li>สิทธิ์ผู้บริหาร / สารบรรณกลาง (Admin) กำหนดโดยผู้ดูแลระบบ</li>
                </ul>
              </div>
            </div>

            <div className="ledger-panel space-y-2 p-4 text-xs text-[#475569]">
              <div className="flex items-center gap-1.5 font-bold text-[#0F172A]">
                <Sparkles className="h-4 w-4 text-amber-500" />
                <span>คำแนะนำการตั้งค่า (เทียบเคียง plan.cric.ac.th)</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                การระบุชื่อ-นามสกุลจริง ตำแหน่งทางการ (ครู / เจ้าหน้าที่) และงานหลักที่ถูกต้อง
                ช่วยให้ระบบเติมหัวหนังสือราชการ ผู้เสนอจัดซื้อ และลายเซ็นผู้รับผิดชอบได้แม่นยำตามระเบียบงานสารบรรณ พ.ศ. ๒๕๒๖
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Interactive Avatar Cropper & Zoom Adjuster */}
      {activeTab === "avatar" && (
        <section className="ledger-panel overflow-hidden">
          <div className="ledger-panel-header flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-[#1D4ED8]" />
              <h3 className="text-sm font-bold text-[#0F172A]">รูปภาพประจำตัว &amp; ปรับตำแหน่ง (Avatar Adjuster)</h3>
            </div>
            {rawAvatarSrc && (
              <button
                type="button"
                onClick={resetAvatarPosition}
                className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1 text-xs font-semibold text-[#334155] hover:bg-slate-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>รีเซ็ตตำแหน่ง</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 p-4 sm:p-6 lg:grid-cols-12">
            {/* Left Canvas Cropper */}
            <div className="space-y-4 lg:col-span-7">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-bold text-[#334155]">
                  <Move className="h-4 w-4 text-[#1D4ED8]" />
                  <span>ลากเมาส์หรือนิ้วบนรูปเพื่อเลื่อนตำแหน่ง (Drag &amp; Position)</span>
                </span>
                <span className="font-mono text-[11px] text-[#64748B]">
                  X: {Math.round(avatarOffsetX)} · Y: {Math.round(avatarOffsetY)}
                </span>
              </div>

              <div className="flex flex-col items-center justify-center rounded-md border-2 border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-4">
                {avatarImgReady ? (
                  <div className="group relative cursor-grab select-none overflow-hidden rounded-xl border-2 border-[#1D4ED8] shadow-sm active:cursor-grabbing">
                    <canvas
                      ref={avatarCanvasRef}
                      width={320}
                      height={320}
                      onMouseDown={(e) => {
                        setIsDraggingAvatar(true);
                        setDragStart({ x: e.clientX - avatarOffsetX, y: e.clientY - avatarOffsetY });
                      }}
                      onMouseMove={(e) => {
                        if (!isDraggingAvatar) return;
                        setAvatarOffsetX(e.clientX - dragStart.x);
                        setAvatarOffsetY(e.clientY - dragStart.y);
                      }}
                      onMouseUp={() => setIsDraggingAvatar(false)}
                      onMouseLeave={() => setIsDraggingAvatar(false)}
                      onTouchStart={(e) => {
                        if (e.touches[0]) {
                          setIsDraggingAvatar(true);
                          setDragStart({ x: e.touches[0].clientX - avatarOffsetX, y: e.touches[0].clientY - avatarOffsetY });
                        }
                      }}
                      onTouchMove={(e) => {
                        if (!isDraggingAvatar || !e.touches[0]) return;
                        setAvatarOffsetX(e.touches[0].clientX - dragStart.x);
                        setAvatarOffsetY(e.touches[0].clientY - dragStart.y);
                      }}
                      onTouchEnd={() => setIsDraggingAvatar(false)}
                      className="h-auto max-w-full touch-none bg-white"
                    />
                    <div className="pointer-events-none absolute inset-3 rounded-full border-2 border-white/80 ring-1 ring-black/20" />
                  </div>
                ) : (
                  <div className="space-y-2 py-12 text-center text-xs text-[#64748B]">
                    <Camera className="mx-auto h-10 w-10 opacity-40" />
                    <p className="font-semibold text-[#334155]">
                      {avatarCanvasError || "ยังไม่มีภาพในเครื่องมือปรับตำแหน่ง"}
                    </p>
                    <p className="text-[11px]">เลือกไฟล์รูปภาพทางขวาเพื่อซูม เลื่อน และตัดรูปให้พอดีวงกลม</p>
                  </div>
                )}
              </div>

              {avatarImgReady && (
                <div className="space-y-3 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-4 text-xs">
                  <div className="flex items-center gap-3">
                    <ZoomOut className="h-4 w-4 shrink-0 text-[#64748B]" />
                    <div className="flex-1">
                      <div className="mb-1 flex justify-between text-[11px] font-bold text-[#334155]">
                        <span>ซูมขยายภาพ</span>
                        <span className="font-mono text-[#1D4ED8]">{avatarZoom.toFixed(2)}x</span>
                      </div>
                      <input
                        type="range"
                        min="0.8"
                        max="3.0"
                        step="0.05"
                        value={avatarZoom}
                        onChange={(e) => setAvatarZoom(parseFloat(e.target.value))}
                        className="h-1.5 w-full cursor-pointer accent-[#1D4ED8]"
                      />
                    </div>
                    <ZoomIn className="h-4 w-4 shrink-0 text-[#64748B]" />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <div className="mb-1 flex justify-between text-[10px] font-bold text-[#475569]">
                        <span>แนวนอน (X)</span>
                        <span className="font-mono">{Math.round(avatarOffsetX)} px</span>
                      </div>
                      <input
                        type="range"
                        min="-160"
                        max="160"
                        step="1"
                        value={avatarOffsetX}
                        onChange={(e) => setAvatarOffsetX(parseInt(e.target.value, 10))}
                        className="h-1.5 w-full cursor-pointer accent-[#1D4ED8]"
                      />
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-[10px] font-bold text-[#475569]">
                        <span>แนวตั้ง (Y)</span>
                        <span className="font-mono">{Math.round(avatarOffsetY)} px</span>
                      </div>
                      <input
                        type="range"
                        min="-160"
                        max="160"
                        step="1"
                        value={avatarOffsetY}
                        onChange={(e) => setAvatarOffsetY(parseInt(e.target.value, 10))}
                        className="h-1.5 w-full cursor-pointer accent-[#1D4ED8]"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E2E8F0] pt-2.5">
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => setAvatarOffsetY((v) => v - 12)} className="rounded border border-[#CBD5E1] bg-white p-1.5 hover:bg-slate-100" title="เลื่อนขึ้น"><ArrowUp className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => setAvatarOffsetY((v) => v + 12)} className="rounded border border-[#CBD5E1] bg-white p-1.5 hover:bg-slate-100" title="เลื่อนลง"><ArrowDown className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => setAvatarOffsetX((v) => v - 12)} className="rounded border border-[#CBD5E1] bg-white p-1.5 hover:bg-slate-100" title="เลื่อนซ้าย"><ArrowLeftIcon className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => setAvatarOffsetX((v) => v + 12)} className="rounded border border-[#CBD5E1] bg-white p-1.5 hover:bg-slate-100" title="เลื่อนขวา"><ArrowRightIcon className="h-3.5 w-3.5" /></button>
                      <button
                        type="button"
                        onClick={() => {
                          setAvatarOffsetX(0);
                          setAvatarOffsetY(0);
                        }}
                        className="rounded border border-[#CBD5E1] bg-white px-2 py-1 text-[10px] font-bold hover:bg-slate-100"
                      >
                        กึ่งกลาง
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAvatarRotation((r) => (r + 90) % 360)}
                      className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2.5 py-1 text-[11px] font-bold hover:bg-slate-100"
                    >
                      <RotateCw className="h-3 w-3 text-[#1D4ED8]" />
                      หมุน 90°
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={avatarBusy}
                    onClick={handleSaveCroppedAvatar}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#1D4ED8] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#1E40AF] disabled:opacity-50"
                  >
                    {avatarBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crop className="h-4 w-4" />}
                    <span>ตัดและบันทึกเป็นรูปโปรไฟล์</span>
                  </button>
                </div>
              )}
            </div>

            {/* Right Upload Controls & Live Preview */}
            <div className="space-y-4 lg:col-span-5">
              <div className="space-y-3 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-4 text-xs">
                <div className="font-bold text-[#0F172A]">ตัวอย่างการแสดงผลปัจจุบัน (Live Preview)</div>
                <div className="flex items-center gap-4 py-2">
                  <UserAvatar avatarUrl={me?.avatar_url} fullName={me?.full_name} size="lg" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-[#0F172A]">{me?.full_name}</div>
                    <div className="truncate text-xs text-[#64748B]">{userSubtitle}</div>
                    <div className="mt-1 text-[11px] text-[#475569]">
                      แหล่งรูป:{" "}
                      {me?.avatar_url?.startsWith("/v1/auth/users/")
                        ? "อัปโหลดใน E-Docx"
                        : me?.avatar_url
                        ? "ซิงค์จาก CRIC Panel / SSO"
                        : "ตัวอักษรย่อชื่อ"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <label className="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-[#0F172A] px-4 py-2.5 font-semibold text-white hover:bg-[#1E293B]">
                  <Upload className="h-3.5 w-3.5" />
                  <span>เลือกไฟล์รูปภาพใหม่</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={avatarBusy}
                    onChange={handleSelectAvatarFile}
                    className="hidden"
                  />
                </label>

                {me?.avatar_url && (
                  <button
                    type="button"
                    disabled={avatarBusy}
                    onClick={handleDeleteAvatar}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 font-semibold text-[#B91C1C] hover:bg-red-100 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>ลบรูป</span>
                  </button>
                )}
              </div>

              <p className="text-[11px] leading-relaxed text-[#64748B]">
                รองรับไฟล์ `.PNG`, `.JPG`, `.JPEG`, `.WEBP` ขนาดไม่เกิน 3 MB
                เมื่อบันทึกแล้วรูปโปรไฟล์จะแสดงบน Top Bar และระบบจัดการบุคลากรทันที
              </p>
            </div>
          </div>
        </section>
      )}

      {/* TAB 3: Electronic Signature (Upload PNG or Draw Transparent Signature Pad) */}
      {activeTab === "signature" && (
        <section className="ledger-panel overflow-hidden">
          <div className="ledger-panel-header flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <PenTool className="h-4 w-4 text-[#1D4ED8]" />
              <h3 className="text-sm font-bold text-[#0F172A]">ลายเซ็นอิเล็กทรอนิกส์ (.PNG พื้นหลังโปร่งใส)</h3>
            </div>
            <div className="flex gap-1 rounded-md border border-[#CBD5E1] bg-white p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setSigMode("upload")}
                className={`rounded px-2.5 py-1 font-semibold ${sigMode === "upload" ? "bg-[#0F172A] text-white" : "text-[#475569] hover:text-[#0F172A]"}`}
              >
                อัปโหลดไฟล์ .PNG
              </button>
              <button
                type="button"
                onClick={() => setSigMode("draw")}
                className={`rounded px-2.5 py-1 font-semibold ${sigMode === "draw" ? "bg-[#0F172A] text-white" : "text-[#475569] hover:text-[#0F172A]"}`}
              >
                วาดลายเซ็นบนหน้าจอ
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 p-4 text-xs sm:p-6 lg:grid-cols-12">
            <div className="space-y-3 lg:col-span-6">
              <div className="font-bold text-[#334155]">ภาพลายเซ็นที่บันทึกไว้ในระบบ</div>
              <div
                className="flex min-h-[190px] items-center justify-center rounded-md border border-[#CBD5E1] p-4"
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
                  <img src={sigPreviewUrl} alt="ภาพลายเซ็นปัจจุบัน" className="max-h-36 w-auto max-w-full object-contain" />
                ) : (
                  <div className="rounded-md bg-white/90 px-4 py-3 text-center text-[#475569] shadow-sm">
                    ยังไม่มีภาพลายเซ็น กรุณาอัปโหลดไฟล์ .PNG หรือวาดลายเซ็นด้านขวา
                  </div>
                )}
              </div>

              {sigPreviewUrl && (
                <button
                  type="button"
                  disabled={sigBusy}
                  onClick={handleDeleteSig}
                  className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3.5 py-2 font-semibold text-[#B91C1C] hover:bg-red-100 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  ลบลายเซ็นปัจจุบัน
                </button>
              )}
            </div>

            <div className="space-y-3 lg:col-span-6">
              {sigMode === "upload" ? (
                <div className="space-y-3 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                  <div className="font-bold text-[#0F172A]">อัปโหลดไฟล์ภาพลายเซ็น (.PNG / .JPG)</div>
                  <p className="text-[11px] leading-relaxed text-[#475569]">
                    แนะนำใช้ไฟล์ <strong>.PNG พื้นหลังโปร่งใส</strong> ขนาดประมาณ 400×160 px
                    ระบบจะนำไปประทับเหนือชื่อผู้ลงนามอัตโนมัติในหน้า <strong>ตรวจร่าง &amp; ลงนาม</strong>
                  </p>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-[#0F172A] px-4 py-2.5 font-semibold text-white hover:bg-[#1E293B]">
                    {sigBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    <span>{sigPreviewUrl ? "เปลี่ยนไฟล์ภาพลายเซ็น" : "เลือกไฟล์ภาพลายเซ็น"}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      disabled={sigBusy}
                      onChange={handleUploadSig}
                      className="hidden"
                    />
                  </label>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#334155]">กระดานวาดลายเซ็น (พื้นหลังโปร่งใส)</span>
                    <button
                      type="button"
                      onClick={clearSigCanvas}
                      className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#475569] hover:bg-slate-50"
                    >
                      <Eraser className="h-3.5 w-3.5" />
                      ล้างกระดาน
                    </button>
                  </div>
                  <div className="overflow-hidden rounded-md border-2 border-dashed border-[#CBD5E1] bg-white">
                    <canvas
                      ref={sigCanvasRef}
                      width={520}
                      height={190}
                      onMouseDown={(e) => startSigDraw(e.clientX, e.clientY)}
                      onMouseMove={(e) => moveSigDraw(e.clientX, e.clientY)}
                      onMouseUp={() => setIsDrawingSig(false)}
                      onMouseLeave={() => setIsDrawingSig(false)}
                      onTouchStart={(e) => {
                        if (e.touches[0]) startSigDraw(e.touches[0].clientX, e.touches[0].clientY);
                      }}
                      onTouchMove={(e) => {
                        if (e.touches[0]) moveSigDraw(e.touches[0].clientX, e.touches[0].clientY);
                      }}
                      onTouchEnd={() => setIsDrawingSig(false)}
                      className="h-[190px] w-full cursor-crosshair touch-none"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={sigBusy || !hasDrawnSig}
                    onClick={handleSaveDrawnSignature}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[#1D4ED8] px-4 py-2.5 font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-50"
                  >
                    {sigBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    <span>บันทึกลายเซ็นที่วาด (.PNG โปร่งใส)</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* TAB 4: Account Security & CRIC SSO Connection Info */}
      {activeTab === "security" && (
        <section className="ledger-panel overflow-hidden">
          <div className="ledger-panel-header flex items-center gap-2">
            <Lock className="h-4 w-4 text-[#1D4ED8]" />
            <h3 className="text-sm font-bold text-[#0F172A]">การเชื่อมต่อบัญชีกลาง CRIC SSO &amp; ความปลอดภัย</h3>
          </div>
          <div className="grid grid-cols-1 gap-4 p-4 text-xs sm:p-6 md:grid-cols-2">
            <div className="space-y-3 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-4">
              <div className="font-bold text-[#0F172A]">สถานะการยืนยันตัวตน</div>
              <dl className="space-y-2">
                <div className="flex justify-between gap-2 border-b border-[#E2E8F0] pb-1.5">
                  <dt className="text-[#64748B]">ชื่อผู้ใช้ (Username)</dt>
                  <dd className="font-mono font-semibold text-[#0F172A]">{me?.username || "-"}</dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-[#E2E8F0] pb-1.5">
                  <dt className="text-[#64748B]">อีเมลบัญชีวิทยาลัยฯ</dt>
                  <dd className="font-mono font-semibold text-[#0F172A]">{me?.email || "-"}</dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-[#E2E8F0] pb-1.5">
                  <dt className="text-[#64748B]">แหล่งการเข้าสู่ระบบล่าสุด</dt>
                  <dd className="font-semibold text-emerald-700">
                    {authSource === "sso" || authSource === "panel_jwt" || authSource === "panel_sso_sync"
                      ? "CRIC Central SSO / Panel"
                      : authSource || "Dev Switcher"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[#64748B]">SSO Subject / Panel ID</dt>
                  <dd className="truncate font-mono text-[11px] text-[#475569]">
                    {me?.sso_subject || me?.panel_user_id || "ยังไม่ได้ผูก"}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="space-y-3 rounded-md border border-blue-200 bg-[#EFF6FF]/60 p-4">
              <div className="font-bold text-[#1E3A8A]">การเปลี่ยนรหัสผ่านและ 2FA</div>
              <p className="text-[11px] leading-relaxed text-[#334155]">
                ระบบ <strong>CRIC E-Docx</strong> ใช้การยืนยันตัวตนแบบ Single Sign-On ร่วมกับระบบกลางของวิทยาลัยฯ (
                <span className="font-mono">{ssoIssuer || "https://sso.cric.ac.th/realms/cric-college"}</span>)
                จึงไม่มีการเก็บรหัสผ่านแยกในระบบนี้
              </p>
              <a
                href={`${SSO_URL.replace(/\/$/, "")}/realms/cric-college/account`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-3.5 py-2 font-semibold text-white hover:bg-[#1E40AF]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>จัดการบัญชีและรหัสผ่านที่ sso.cric.ac.th</span>
              </a>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

export default function UserProfileSettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="ledger-panel flex items-center justify-center gap-2 p-12 text-sm text-[#475569]">
          <Loader2 className="h-4 w-4 animate-spin text-[#1D4ED8]" />
          กำลังโหลดหน้าตั้งค่าโปรไฟล์...
        </div>
      }
    >
      <ProfileSettingsContent />
    </Suspense>
  );
}
