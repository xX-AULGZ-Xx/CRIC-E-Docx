"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileCheck2,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Users,
  Wand2,
} from "lucide-react";
import { DocumentPreviewPanel } from "@/components/DocumentPreviewPanel";
import { ResponsivePreviewModal } from "@/components/ResponsivePreviewModal";
import {
  api,
  API_BASE,
  DocType,
  DraftPersonnelGroup,
  DraftPersonnelRecord,
  OrderCommittee,
  OrgProfile,
  RenderResult,
  UserProfile,
  ValidationIssue,
} from "@/lib/api";
import { toastError, toastInfo, toastSuccess } from "@/lib/swal";

const DOC_TYPES: Array<{ id: DocType; label: string }> = [
  { id: "memo", label: "บันทึกข้อความ" },
  { id: "external", label: "หนังสือภายนอก" },
  { id: "order", label: "คำสั่ง" },
  { id: "announcement", label: "ประกาศ" },
  { id: "agenda", label: "ระเบียบวาระการประชุม" },
  { id: "minutes", label: "รายงานการประชุม" },
];

const DIVISIONS = [
  { code: "ฝบ.", name: "ฝ่ายบริหารทรัพยากร" },
  { code: "ฝว.", name: "ฝ่ายวิชาการ" },
  { code: "ฝย.", name: "ฝ่ายยุทธศาสตร์และแผนงาน" },
  { code: "ฝก.", name: "ฝ่ายกิจการนักเรียน นักศึกษา" },
];

const CLOSING_PRESETS = [
  { label: "ขออนุญาต / ขออนุมัติ", text: "จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ" },
  { label: "แจ้งเพื่อทราบ / รายงานผล", text: "จึงเรียนมาเพื่อโปรดทราบ" },
  { label: "ขอความอนุเคราะห์ / ร่วมมือ", text: "จึงเรียนมาเพื่อโปรดพิจารณาอนุเคราะห์ด้วย จะเป็นพระคุณ" },
  { label: "เชิญเป็นวิทยากร", text: "จึงเรียนมาเพื่อโปรดพิจารณารับเชิญ ด้วยจะเป็นพระคุณ" },
  { label: "ซักซ้อมความเข้าใจ / ให้ดำเนินการ", text: "จึงเรียนมาเพื่อโปรดทราบและถือปฏิบัติต่อไป" },
  { label: "ตอบปฏิเสธ", text: "จึงเรียนมาเพื่อโปรดทราบ และขออภัยมา ณ ที่นี้ด้วย" },
];

export default function DraftStudioPage() {
  const [docType, setDocType] = useState<DocType>("memo");
  const [fontFamily, setFontFamily] = useState<"TH Sarabun New" | "TH SarabunIT๙">("TH Sarabun New");
  const [divisionCode, setDivisionCode] = useState("ฝบ.");
  const [unitName, setUnitName] = useState("งานบริหารงานทั่วไป");
  const [docNumber, setDocNumber] = useState("");
  const [isCircular, setIsCircular] = useState(false);
  const [speed, setSpeed] = useState("");
  const [secrecy, setSecrecy] = useState("");
  const [dateStr, setDateStr] = useState(() => new Date().toISOString().slice(0, 10));
  const [subject, setSubject] = useState("ขออนุมัติจัดโครงการอบรมเชิงปฏิบัติการด้านงานสารบรรณอิเล็กทรอนิกส์");
  const [toField, setToField] = useState("ผู้อำนวยการวิทยาลัยการอาชีพเชียงราย");
  const [reference, setReference] = useState("");
  const [attachmentsText, setAttachmentsText] = useState("");
  const [bodyText, setBodyText] = useState(
    "ด้วยฝ่ายบริหารทรัพยากร วิทยาลัยการอาชีพเชียงราย มีความประสงค์จะจัดโครงการอบรมเชิงปฏิบัติการด้านงานสารบรรณอิเล็กทรอนิกส์ เพื่อพัฒนาศักยภาพบุคลากรให้ปฏิบัติงานได้อย่างถูกต้องตามระเบียบสำนักนายกรัฐมนตรี ว่าด้วยงานสารบรรณ พ.ศ. ๒๕๒๖\n\nในการนี้ จึงขออนุมัติดำเนินโครงการดังกล่าว ในวันศุกร์ที่ ๒๐ พฤศจิกายน ๒๕๖๙ เวลา ๐๙.๐๐ น. ณ ห้องประชุมกันเกรา วิทยาลัยการอาชีพเชียงราย"
  );
  const [closingPurpose, setClosingPurpose] = useState("จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ");
  const [effectiveLine, setEffectiveLine] = useState("ทั้งนี้ ตั้งแต่บัดนี้เป็นต้นไป");
  const [orderCommittees, setOrderCommittees] = useState<OrderCommittee[]>([]);
  const [draftPersonnel, setDraftPersonnel] = useState<DraftPersonnelRecord[]>([]);
  const [draftGroups, setDraftGroups] = useState<DraftPersonnelGroup[]>([]);

  // Meeting fields (agenda / minutes)
  const [meetingTitle, setMeetingTitle] = useState("คณะกรรมการบริหารวิทยาลัยการอาชีพเชียงราย");
  const [sessionNo, setSessionNo] = useState("๑/๒๕๖๙");
  const [meetingTime, setMeetingTime] = useState("๐๙.๓๐ น.");
  const [location, setLocation] = useState("ห้องประชุมกันเกรา วิทยาลัยการอาชีพเชียงราย");
  const [attendeesText, setAttendeesText] = useState(
    "๑. นายยุทธการ ตั้งปัญญาศักดิ์ ผู้อำนวยการวิทยาลัยการอาชีพเชียงราย ประธานกรรมการ\n๒. นางสาวอรวรรณ แสงดาว รองผู้อำนวยการฝ่ายบริหารทรัพยากร กรรมการ"
  );
  const [agenda1Text, setAgenda1Text] = useState("แจ้งแนวทางการใช้งานระบบร่างเอกสารราชการออนไลน์");
  const [agenda2Text, setAgenda2Text] = useState("รับรองรายงานการประชุมครั้งที่ผ่านมา");
  const [agenda3Text, setAgenda3Text] = useState("รายงานผลการดำเนินงานตามแผนปฏิบัติการประจำปี");
  const [agenda4Text, setAgenda4Text] = useState("พิจารณาแนวทางการจัดทำหนังสือราชการอิเล็กทรอนิกส์");
  const [agenda5Text, setAgenda5Text] = useState("");
  const [endTime, setEndTime] = useState("๑๑.๓๐ น.");

  // Signers
  const [signer1Name, setSigner1Name] = useState("นางสาวขนิษฐา สุใจยา");
  const [signer1Title, setSigner1Title] = useState("หัวหน้างานบริหารงานทั่วไป");
  const [signer2Name, setSigner2Name] = useState("นางสาวอรวรรณ แสงดาว");
  const [signer2Title, setSigner2Title] = useState("รองผู้อำนวยการฝ่ายบริหารทรัพยากร");

  // AI Co-pilot
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiPurpose, setAiPurpose] = useState("ขออนุมัติ");
  const [aiProvider, setAiProvider] = useState<string>("");
  const [aiModeNote, setAiModeNote] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  // Validation & Render & Workflow
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(1);
  const [autoPreview, setAutoPreview] = useState(true);
  const previewKeyRef = useRef<string>("");
  const [savedDocId, setSavedDocId] = useState<string | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [orgProfile, setOrgProfile] = useState<OrgProfile | null>(null);
  const [aiCopilotEnabled, setAiCopilotEnabled] = useState(true);
  const [reviewerEmail, setReviewerEmail] = useState("orawan@cric.ac.th");
  const [approverEmail, setApproverEmail] = useState("director@cric.ac.th");
  const [statusMsg, setStatusMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const divisions = orgProfile?.divisions
    ? Object.entries(orgProfile.divisions).map(([code, info]) => ({
        code,
        name: info.name,
        deputy_title: info.deputy_title,
      }))
    : DIVISIONS.map((d) => ({ ...d, deputy_title: `รองผู้อำนวยการ${d.name}` }));

  const directorSigner = orgProfile?.director || {
    name: "นายยุทธการ ตั้งปัญญาศักดิ์",
    title: "ผู้อำนวยการวิทยาลัยการอาชีพเชียงราย",
  };

  useEffect(() => {
    if (!previewKeyRef.current) {
      previewKeyRef.current = Math.random().toString(36).slice(2, 12);
    }
    try {
      const sp = new URLSearchParams(window.location.search);
      const t = sp.get("type") as DocType | null;
      if (t && DOC_TYPES.some((item) => item.id === t)) {
        setDocType(t);
      }
    } catch {
      // ignore
    }
    const applyMyProfile = () => {
      api
        .me()
        .then(({ user }) => {
          if (user.full_name) setSigner1Name(user.full_name);
          if (user.position_title) setSigner1Title(user.position_title);
          if (user.division_code) setDivisionCode(user.division_code);
          if (user.unit_name) setUnitName(user.unit_name);
          if (user.default_reviewer_email) setReviewerEmail(user.default_reviewer_email);
        })
        .catch(() => {});
    };
    applyMyProfile();
    window.addEventListener("cric-user-changed", applyMyProfile);
    window.addEventListener("cric-profile-updated", applyMyProfile);

    api.listUsers().then((r) => setUsers(r.users)).catch(() => {});
    api
      .getDraftRoster()
      .then((r) => {
        setDraftPersonnel(r.personnel || []);
        setDraftGroups(r.groups || []);
      })
      .catch(() => {});
    api.getAiSettings().then((s) => setAiProvider(s.provider)).catch(() => {});
    api
      .getPublicSettings()
      .then((pub) => {
        setOrgProfile(pub.org_profile);
        if (typeof pub.ai_copilot_enabled === "boolean") {
          setAiCopilotEnabled(pub.ai_copilot_enabled);
        }
        if (pub.default_font === "TH Sarabun New" || pub.default_font === "TH SarabunIT๙") {
          setFontFamily(pub.default_font);
        }
        if (typeof pub.auto_preview_default === "boolean") {
          setAutoPreview(pub.auto_preview_default);
        }
        if (pub.org_profile?.director?.title) {
          setToField((prev) =>
            prev === "ผู้อำนวยการวิทยาลัยการอาชีพเชียงราย" ? pub.org_profile.director.title : prev
          );
        }
      })
      .catch(() => {});
    return () => {
      window.removeEventListener("cric-user-changed", applyMyProfile);
      window.removeEventListener("cric-profile-updated", applyMyProfile);
    };
  }, []);

  useEffect(() => {
    const dirTitle = orgProfile?.director?.title || "ผู้อำนวยการวิทยาลัยการอาชีพเชียงราย";
    if (docType === "memo") {
      setToField(dirTitle);
    } else if (docType === "external" && toField === dirTitle) {
      setToField("ผู้อำนวยการวิทยาลัยเทคนิคเชียงราย");
    }
  }, [docType, orgProfile]);

  function buildPayload(): Record<string, unknown> {
    const paragraphs = bodyText
      .split(/\n\s*\n|\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    const common = {
      type: docType,
      font_family: fontFamily,
      is_circular: isCircular,
      speed,
      secrecy,
    };

    if (docType === "memo") {
      const signers = [{ name: signer1Name, title: signer1Title }];
      if (signer2Name.trim() || signer2Title.trim()) {
        signers.push({ name: signer2Name, title: signer2Title });
      }
      return {
        ...common,
        division_code: divisionCode,
        unit_name: unitName,
        doc_number: docNumber,
        date: dateStr,
        subject,
        to: toField,
        paragraphs,
        closing_purpose: closingPurpose,
        signers,
      };
    }

    if (docType === "external") {
      const divObj = divisions.find((d) => d.code === divisionCode);
      return {
        ...common,
        doc_number: docNumber,
        date: dateStr,
        subject,
        to: toField,
        reference,
        attachments: attachmentsText.split("\n").map((s) => s.trim()).filter(Boolean),
        paragraphs,
        closing_purpose: closingPurpose,
        signer: directorSigner,
        contact: { unit: unitName, division: divObj?.name || "ฝ่ายบริหารทรัพยากร" },
      };
    }

    if (docType === "order") {
      const cleanCommittees = orderCommittees
        .map((c) => ({
          title: c.title.trim(),
          duties: c.duties.trim(),
          members: c.members.filter((m) => m.first_name.trim() || m.last_name.trim()),
        }))
        .filter((c) => c.title || c.duties || c.members.length > 0);
      return {
        ...common,
        order_number: docNumber,
        subject,
        paragraphs,
        committees: cleanCommittees,
        effective_line: effectiveLine,
        order_date: dateStr,
        signer: directorSigner,
      };
    }

    if (docType === "announcement") {
      return {
        ...common,
        subject,
        paragraphs,
        closing_line: closingPurpose || "จึงประกาศให้ทราบโดยทั่วกัน",
        announce_date: dateStr,
        signer: directorSigner,
      };
    }

    if (docType === "agenda") {
      return {
        ...common,
        meeting_title: meetingTitle,
        session: sessionNo,
        date: dateStr,
        time: meetingTime,
        location,
        agenda_1: agenda1Text.split("\n").filter(Boolean),
        agenda_2: agenda2Text,
        agenda_3: agenda3Text.split("\n").filter(Boolean),
        agenda_4: agenda4Text.split("\n").filter(Boolean),
        agenda_5: agenda5Text.split("\n").filter(Boolean),
      };
    }

    return {
      ...common,
      meeting_title: meetingTitle,
      session: sessionNo,
      date: dateStr,
      time: meetingTime,
      location,
      attendees: attendeesText.split("\n").filter(Boolean),
      absentees: ["ไม่มี"],
      start_time: meetingTime,
      agenda_1: agenda1Text.split("\n").filter(Boolean),
      agenda_2_draft: agenda2Text,
      agenda_2_resolution: "ที่ประชุมพิจารณาแล้ว มีมติรับรองรายงานการประชุม",
      agenda_3: agenda3Text.split("\n").filter(Boolean).map((item) => ({ item, note: "ที่ประชุมรับทราบ" })),
      agenda_4: agenda4Text.split("\n").filter(Boolean).map((item) => ({ item, detail: "", resolution: "เห็นชอบตามเสนอ" })),
      agenda_5: { items: agenda5Text.split("\n").filter(Boolean), next_meeting_date: "" },
      end_time: endTime,
      recorder: { name: signer1Name, title: "ผู้จดรายงานการประชุม" },
    };
  }

  async function handleValidateAndRender() {
    setBusy(true);
    setPreviewLoading(true);
    setStatusMsg("");
    try {
      const res = await api.renderDoc(buildPayload(), true, previewKeyRef.current || undefined);
      setRenderResult(res);
      setIssues(res.validation);
      setPreviewVersion((v) => v + 1);
      if (res.validation.length === 0) {
        toastSuccess("ตรวจทานเรียบร้อย (ผ่าน 100%)", `จัดหน้าเอกสารฟอนต์ ${res.font_family} แล้ว`);
      } else {
        toastInfo("ตรวจทานเสร็จสิ้น", `พบข้อแนะนำ ${res.validation.length} รายการ ด้านขวา`);
      }
    } catch (err) {
      const errText = err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการสร้างเอกสาร";
      setStatusMsg(errText);
      toastError("สร้างตัวอย่างไม่สำเร็จ", errText);
    } finally {
      setBusy(false);
      setPreviewLoading(false);
    }
  }

  const serializedPayload = JSON.stringify(buildPayload());

  useEffect(() => {
    if (!autoPreview) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const parsed = JSON.parse(serializedPayload) as Record<string, unknown>;
        const res = await api.renderDoc(parsed, true, previewKeyRef.current || "auto", controller.signal);
        setRenderResult(res);
        setIssues(res.validation);
        setPreviewVersion((v) => v + 1);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
      } finally {
        if (!controller.signal.aborted) setPreviewLoading(false);
      }
    }, 1500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [autoPreview, serializedPayload]);

  async function handleAiDraft() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    try {
      const divObj = DIVISIONS.find((d) => d.code === divisionCode);
      const res = await api.aiDraft({
        doc_type: docType,
        prompt: aiPrompt,
        division_name: divObj?.name || "ฝ่ายบริหารทรัพยากร",
        purpose: aiPurpose,
        provider_override: aiProvider || undefined,
      });
      if (res.subject) setSubject(res.subject);
      if (res.paragraphs?.length) setBodyText(res.paragraphs.join("\n\n"));
      if (res.closing_purpose) setClosingPurpose(res.closing_purpose);
      setAiModeNote(`ร่างด้วย ${res.mode}`);
      toastSuccess("AI ร่างข้อความเรียบร้อย", `ประมวลผลด้วย ${res.mode}`);
    } catch (err) {
      const errText = err instanceof Error ? err.message : "AI Draft ล้มเหลว";
      setStatusMsg(errText);
      toastError("AI ช่วยร่างไม่สำเร็จ", errText);
    } finally {
      setAiLoading(false);
    }
  }

  async function handleAiPolish() {
    setAiLoading(true);
    try {
      const paragraphs = bodyText.split(/\n\s*\n|\n/).map((s) => s.trim()).filter(Boolean);
      const res = await api.aiPolish({
        paragraphs,
        closing_purpose: closingPurpose,
        provider_override: aiProvider || undefined,
      });
      setBodyText(res.paragraphs.join("\n\n"));
      if (res.closing_purpose) setClosingPurpose(res.closing_purpose);
      setAiModeNote(`เกลาสำนวนด้วย ${res.mode}`);
      toastSuccess("เกลาสำนวนราชการแล้ว", `ประมวลผลด้วย ${res.mode}`);
    } catch (err) {
      const errText = err instanceof Error ? err.message : "AI Polish ล้มเหลว";
      setStatusMsg(errText);
      toastError("เกลาสำนวนไม่สำเร็จ", errText);
    } finally {
      setAiLoading(false);
    }
  }

  async function handleSaveAndSubmit(submit: boolean) {
    setBusy(true);
    setStatusMsg("");
    try {
      const saved = await api.saveDocument(buildPayload(), savedDocId || undefined);
      setSavedDocId(saved.document.id);
      setRenderResult(saved.render);
      setIssues(saved.render.validation);
      setPreviewVersion((v) => v + 1);
      if (submit) {
        await api.submitDocument(saved.document.id, reviewerEmail || null, approverEmail);
        const msgText = `บันทึกร่างและส่งเข้าสายงานอนุมัติเรียบร้อยแล้ว (ID: ${saved.document.id.slice(0, 8)})`;
        setStatusMsg(msgText);
        toastSuccess("ส่งตรวจและลงนามเรียบร้อย", `รหัสเอกสาร ${saved.document.id.slice(0, 8)}`);
      } else {
        const msgText = `บันทึกร่างเอกสารเรียบร้อยแล้ว (ID: ${saved.document.id.slice(0, 8)})`;
        setStatusMsg(msgText);
        toastSuccess("บันทึกร่างเรียบร้อย", `รหัสเอกสาร ${saved.document.id.slice(0, 8)}`);
      }
    } catch (err) {
      const errText = err instanceof Error ? err.message : "บันทึกเอกสารไม่สำเร็จ";
      setStatusMsg(errText);
      toastError("บันทึกเอกสารไม่สำเร็จ", errText);
    } finally {
      setBusy(false);
    }
  }

  const isMeeting = docType === "agenda" || docType === "minutes";

  return (
    <div className="space-y-4">
      {/* Document Type Ledger Strip + Saraban Controls */}
      <div className="ledger-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2.5">
          <div className="flex flex-wrap gap-1">
            {DOC_TYPES.map((t) => {
              const active = docType === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setDocType(t.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    active
                      ? "bg-[#1D4ED8] text-white"
                      : "bg-white text-[#334155] ring-1 ring-[#CBD5E1] hover:bg-slate-50 hover:text-[#0F172A]"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1.5 font-medium text-[#475569]">
              <span>ฟอนต์</span>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value as "TH Sarabun New" | "TH SarabunIT๙")}
                className="rounded-md border border-[#CBD5E1] bg-white px-2 py-1 text-xs font-medium text-[#0F172A] focus:border-[#1D4ED8] focus:outline-none"
              >
                <option value="TH Sarabun New">TH Sarabun New</option>
                <option value="TH SarabunIT๙">TH SarabunIT๙</option>
              </select>
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1 font-medium text-[#0F172A]">
              <input type="checkbox" checked={autoPreview} onChange={(e) => setAutoPreview(e.target.checked)} className="accent-[#1D4ED8]" />
              <span>อัปเดตตัวอย่างอัตโนมัติ</span>
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1 font-medium text-[#0F172A]">
              <input type="checkbox" checked={isCircular} onChange={(e) => setIsCircular(e.target.checked)} className="accent-[#1D4ED8]" />
              <span>หนังสือเวียน (ว)</span>
            </label>
            <select
              value={speed}
              onChange={(e) => setSpeed(e.target.value)}
              className={`rounded-md border px-2 py-1 text-xs font-semibold focus:outline-none ${
                speed ? "border-[#B91C1C] bg-red-50 text-[#B91C1C]" : "border-[#CBD5E1] bg-white text-[#475569]"
              }`}
            >
              <option value="">ชั้นความเร็ว: ปกติ</option>
              <option value="ด่วน">ด่วน</option>
              <option value="ด่วนมาก">ด่วนมาก</option>
              <option value="ด่วนที่สุด">ด่วนที่สุด</option>
            </select>
            <select
              value={secrecy}
              onChange={(e) => setSecrecy(e.target.value)}
              className={`rounded-md border px-2 py-1 text-xs font-semibold focus:outline-none ${
                secrecy ? "border-[#B91C1C] bg-red-50 text-[#B91C1C]" : "border-[#CBD5E1] bg-white text-[#475569]"
              }`}
            >
              <option value="">ชั้นความลับ: ปกติ</option>
              <option value="ลับ">ลับ</option>
              <option value="ลับมาก">ลับมาก</option>
              <option value="ลับที่สุด">ลับที่สุด</option>
            </select>
          </div>
        </div>

        {/* AI Co-pilot Integrated Strip */}
        {aiCopilotEnabled && (
          <div className="flex flex-col gap-2 bg-white px-4 py-3 sm:flex-row sm:items-center">
          <div className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-[#1E3A8A]">
            <Sparkles className="h-3.5 w-3.5 text-[#1D4ED8]" />
            <span>ผู้ช่วยร่าง AI</span>
          </div>
          <input
            type="text"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="ระบุหัวข้อหรือโจทย์สั้นๆ เช่น ขออนุมัติจัดอบรมเชิงปฏิบัติการให้ครู 30 คน วันที่ 25 พ.ย. 69..."
            className="ledger-input flex-1 text-xs sm:text-sm"
          />
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <select
              value={aiPurpose}
              onChange={(e) => setAiPurpose(e.target.value)}
              className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#0F172A] focus:border-[#1D4ED8] focus:outline-none"
            >
              <option value="ขออนุมัติ">ขออนุมัติ</option>
              <option value="แจ้งเพื่อทราบ">แจ้งเพื่อทราบ</option>
              <option value="ขอความอนุเคราะห์">ขอความอนุเคราะห์</option>
              <option value="เชิญเป็นวิทยากร">เชิญเป็นวิทยากร</option>
              <option value="รายงานผล">รายงานผล</option>
            </select>
            <select
              value={aiProvider}
              onChange={(e) => setAiProvider(e.target.value)}
              aria-label="ผู้ให้บริการ AI"
              className="rounded-md border border-[#CBD5E1] bg-[#F8FAFC] px-2 py-1.5 text-xs text-[#475569] focus:border-[#1D4ED8] focus:outline-none"
            >
              <option value="gemini">Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="local">Local LLM</option>
            </select>
            <button
              type="button"
              disabled={aiLoading}
              onClick={handleAiDraft}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#1D4ED8] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-50"
            >
              <Wand2 className="h-3.5 w-3.5" />
              ร่างข้อความ
            </button>
            {aiModeNote && <span className="rounded bg-[#EFF6FF] px-2 py-1 text-[11px] font-medium text-[#1E3A8A]">{aiModeNote}</span>}
          </div>
        </div>
        )}
      </div>

      {statusMsg && (
        <div className="rounded-md border border-blue-300 bg-[#EFF6FF] px-4 py-2.5 text-sm font-medium text-[#1E3A8A]">
          {statusMsg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* Left: Form Ledger */}
        <div className="xl:col-span-7">
          <section className="ledger-panel overflow-hidden">
            <div className="ledger-panel-header flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#0F172A]">รายละเอียดหนังสือราชการ</h2>
              <span className="tabular-nums-th text-xs text-[#475569]">ระเบียบงานสารบรรณ พ.ศ. ๒๕๒๖</span>
            </div>

            <div className="space-y-4 p-5">
              {!isMeeting ? (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#475569]">ฝ่ายงาน</label>
                      <select
                        value={divisionCode}
                        onChange={(e) => {
                          setDivisionCode(e.target.value);
                          const d = divisions.find((x) => x.code === e.target.value);
                          if (d) setSigner2Title(d.deputy_title || `รองผู้อำนวยการ${d.name}`);
                        }}
                        className="ledger-input"
                      >
                        {divisions.map((d) => (
                          <option key={d.code} value={d.code}>
                            {d.code} {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#475569]">งาน</label>
                      <input type="text" value={unitName} onChange={(e) => setUnitName(e.target.value)} className="ledger-input" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#475569]">
                        เลขที่หนังสือ (เว้นว่างได้)
                      </label>
                      <input
                        type="text"
                        value={docNumber}
                        onChange={(e) => setDocNumber(e.target.value)}
                        placeholder={docType === "external" ? "เช่น 1234" : "เช่น 12/2569"}
                        className="ledger-input tabular-nums-th"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#475569]">ลงวันที่</label>
                      <input
                        type="date"
                        value={dateStr}
                        onChange={(e) => setDateStr(e.target.value)}
                        className="ledger-input tabular-nums-th"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-semibold text-[#475569]">เรื่อง</label>
                      <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className="ledger-input" />
                    </div>
                  </div>

                  {(docType === "memo" || docType === "external") && (
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#475569]">เรียน</label>
                      <input type="text" value={toField} onChange={(e) => setToField(e.target.value)} className="ledger-input" />
                    </div>
                  )}

                  {docType === "external" && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-[#475569]">อ้างถึง (ถ้ามี)</label>
                        <input
                          type="text"
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                          placeholder="หนังสือ ที่ ... ลงวันที่ ..."
                          className="ledger-input"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-[#475569]">สิ่งที่ส่งมาด้วย (บรรทัดละ 1 รายการ)</label>
                        <textarea
                          rows={2}
                          value={attachmentsText}
                          onChange={(e) => setAttachmentsText(e.target.value)}
                          placeholder="กำหนดการ จำนวน 1 ฉบับ"
                          className="ledger-input prose-saraban"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <label className="text-xs font-semibold text-[#475569]">เนื้อความ (เว้น 1 บรรทัดเพื่อขึ้นย่อหน้าใหม่)</label>
                      {aiCopilotEnabled && (
                        <button
                          type="button"
                          disabled={aiLoading}
                          onClick={handleAiPolish}
                          className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          เกลาเป็นภาษาราชการ
                        </button>
                      )}
                    </div>
                    <textarea
                      rows={8}
                      value={bodyText}
                      onChange={(e) => setBodyText(e.target.value)}
                      className="ledger-input prose-saraban text-[15px]"
                    />
                  </div>

                  {docType === "order" ? (
                    <div className="space-y-4">
                      <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3.5">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <Users className="h-4 w-4 text-sky-700" />
                            <span className="text-xs font-bold text-[#0F172A]">
                              คณะกรรมการ / ชุดปฏิบัติงาน (แต่งตั้งคณะกรรมการ)
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {draftGroups.length > 0 && (
                              <select
                                value=""
                                onChange={(e) => {
                                  const gid = e.target.value;
                                  const grp = draftGroups.find((g) => g.id === gid);
                                  if (!grp) return;
                                  const members = grp.members.map((gm) => {
                                    const p = draftPersonnel.find((x) => x.id === gm.person_id);
                                    return {
                                      first_name: p?.first_name || "",
                                      last_name: p?.last_name || "",
                                      role: gm.role || "กรรมการ",
                                    };
                                  });
                                  setOrderCommittees((prev) => [
                                    ...prev,
                                    { title: grp.default_title, duties: grp.default_duties, members },
                                  ]);
                                  toastSuccess("เพิ่มชุดคณะกรรมการแล้ว", grp.label);
                                }}
                                className="rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs font-medium text-[#0F172A] focus:border-[#1D4ED8] focus:outline-none"
                              >
                                <option value="">+ เพิ่มชุดจากคำสั่ง ๑ ต.ค. ๖๙...</option>
                                {draftGroups.map((g) => (
                                  <option key={g.id} value={g.id}>
                                    {g.label}
                                  </option>
                                ))}
                              </select>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setOrderCommittees((prev) => [
                                  ...prev,
                                  {
                                    title: "",
                                    duties: "",
                                    members: [{ first_name: "", last_name: "", role: "ประธานกรรมการ" }],
                                  },
                                ])
                              }
                              className="inline-flex items-center gap-1 rounded-md bg-[#1D4ED8] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#1E40AF]"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              เพิ่มชุดคณะกรรมการ
                            </button>
                          </div>
                        </div>

                        {orderCommittees.length === 0 ? (
                          <p className="text-xs text-[#64748B]">
                            ยังไม่ได้เพิ่มชุดคณะกรรมการ (หากเป็นคำสั่งทั่วไปสามารถเว้นว่างได้ หรือกด &quot;+ เพิ่มชุดคณะกรรมการ&quot; / เลือกชุดสำเร็จรูปจากคำสั่ง ๑ ต.ค. ๖๙)
                          </p>
                        ) : (
                          <div className="space-y-3">
                            {orderCommittees.map((comm, cIdx) => (
                              <div key={cIdx} className="rounded-md border border-[#CBD5E1] bg-white p-3">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                  <span className="text-xs font-bold text-[#1E3A8A]">ชุดที่ {cIdx + 1}</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setOrderCommittees((prev) => prev.filter((_, i) => i !== cIdx))
                                    }
                                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    ลบชุดนี้
                                  </button>
                                </div>

                                <div className="mb-2 grid grid-cols-1 gap-2">
                                  <input
                                    type="text"
                                    placeholder="ชื่อคณะกรรมการ เช่น คณะกรรมการฝ่ายอำนวยการ"
                                    value={comm.title}
                                    onChange={(e) =>
                                      setOrderCommittees((prev) =>
                                        prev.map((c, i) => (i === cIdx ? { ...c, title: e.target.value } : c))
                                      )
                                    }
                                    className="ledger-input py-1.5 text-xs font-semibold"
                                  />
                                  <textarea
                                    rows={2}
                                    placeholder="มีหน้าที่ (เช่น ให้คำปรึกษา ชี้แนะ ควบคุม ดูแลความสะดวกในการดำเนินงาน...)"
                                    value={comm.duties}
                                    onChange={(e) =>
                                      setOrderCommittees((prev) =>
                                        prev.map((c, i) => (i === cIdx ? { ...c, duties: e.target.value } : c))
                                      )
                                    }
                                    className="ledger-input prose-saraban py-1.5 text-xs"
                                  />
                                </div>

                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-semibold text-[#475569]">
                                      รายชื่อกรรมการ ({comm.members.length} คน — จัดคอลัมน์ตรงกันใน Word)
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setOrderCommittees((prev) =>
                                          prev.map((c, i) =>
                                            i === cIdx
                                              ? {
                                                  ...c,
                                                  members: [
                                                    ...c.members,
                                                    { first_name: "", last_name: "", role: "กรรมการ" },
                                                  ],
                                                }
                                              : c
                                          )
                                        )
                                      }
                                      className="inline-flex items-center gap-1 rounded border border-[#CBD5E1] bg-[#F8FAFC] px-2 py-0.5 text-[11px] font-semibold text-[#0F172A] hover:bg-slate-100"
                                    >
                                      <Plus className="h-3 w-3" />
                                      เพิ่มรายชื่อ
                                    </button>
                                  </div>

                                  {comm.members.map((mem, mIdx) => (
                                    <div
                                      key={mIdx}
                                      className="grid grid-cols-1 gap-1.5 rounded border border-slate-200 bg-slate-50/70 p-2 sm:grid-cols-12 sm:items-center"
                                    >
                                      <select
                                        value=""
                                        onChange={(e) => {
                                          const pid = e.target.value;
                                          const p = draftPersonnel.find((x) => x.id === pid);
                                          if (!p) return;
                                          setOrderCommittees((prev) =>
                                            prev.map((c, i) =>
                                              i === cIdx
                                                ? {
                                                    ...c,
                                                    members: c.members.map((m, j) =>
                                                      j === mIdx
                                                        ? { ...m, first_name: p.first_name, last_name: p.last_name }
                                                        : m
                                                    ),
                                                  }
                                                : c
                                            )
                                          );
                                        }}
                                        className="ledger-input bg-white py-1 text-[11px] sm:col-span-3"
                                        title="เลือกบุคลากรจากคำสั่ง ๑ ต.ค. ๖๙"
                                      >
                                        <option value="">-- เลือกบุคลากร --</option>
                                        {draftPersonnel.map((p) => (
                                          <option key={p.id} value={p.id}>
                                            {p.full_name}
                                          </option>
                                        ))}
                                      </select>
                                      <input
                                        type="text"
                                        placeholder="คำนำหน้า+ชื่อ"
                                        value={mem.first_name}
                                        onChange={(e) =>
                                          setOrderCommittees((prev) =>
                                            prev.map((c, i) =>
                                              i === cIdx
                                                ? {
                                                    ...c,
                                                    members: c.members.map((m, j) =>
                                                      j === mIdx ? { ...m, first_name: e.target.value } : m
                                                    ),
                                                  }
                                                : c
                                            )
                                          )
                                        }
                                        className="ledger-input bg-white py-1 text-xs sm:col-span-3"
                                      />
                                      <input
                                        type="text"
                                        placeholder="นามสกุล"
                                        value={mem.last_name}
                                        onChange={(e) =>
                                          setOrderCommittees((prev) =>
                                            prev.map((c, i) =>
                                              i === cIdx
                                                ? {
                                                    ...c,
                                                    members: c.members.map((m, j) =>
                                                      j === mIdx ? { ...m, last_name: e.target.value } : m
                                                    ),
                                                  }
                                                : c
                                            )
                                          )
                                        }
                                        className="ledger-input bg-white py-1 text-xs sm:col-span-2"
                                      />
                                      <select
                                        value={mem.role || "กรรมการ"}
                                        onChange={(e) =>
                                          setOrderCommittees((prev) =>
                                            prev.map((c, i) =>
                                              i === cIdx
                                                ? {
                                                    ...c,
                                                    members: c.members.map((m, j) =>
                                                      j === mIdx ? { ...m, role: e.target.value } : m
                                                    ),
                                                  }
                                                : c
                                            )
                                          )
                                        }
                                        className="ledger-input bg-white py-1 text-xs sm:col-span-3"
                                        title="ตำแหน่งในคณะฯ"
                                      >
                                        {![
                                          "ประธานกรรมการ",
                                          "รองประธานกรรมการ",
                                          "กรรมการ",
                                          "กรรมการและเลขานุการ",
                                          "กรรมการและผู้ช่วยเลขานุการ",
                                          "ที่ปรึกษา",
                                          "เลขานุการ",
                                        ].includes(mem.role) &&
                                          mem.role && <option value={mem.role}>{mem.role}</option>}
                                        <option value="ประธานกรรมการ">ประธานกรรมการ</option>
                                        <option value="รองประธานกรรมการ">รองประธานกรรมการ</option>
                                        <option value="กรรมการ">กรรมการ</option>
                                        <option value="กรรมการและเลขานุการ">กรรมการและเลขานุการ</option>
                                        <option value="กรรมการและผู้ช่วยเลขานุการ">กรรมการและผู้ช่วยเลขานุการ</option>
                                        <option value="ที่ปรึกษา">ที่ปรึกษา</option>
                                        <option value="เลขานุการ">เลขานุการ</option>
                                      </select>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setOrderCommittees((prev) =>
                                            prev.map((c, i) =>
                                              i === cIdx
                                                ? { ...c, members: c.members.filter((_, j) => j !== mIdx) }
                                                : c
                                            )
                                          )
                                        }
                                        className="inline-flex items-center justify-center rounded p-1 text-red-500 hover:bg-red-50 sm:col-span-1"
                                        title="ลบรายชื่อ"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-[#475569]">เลือกรูปแบบข้อความปิดท้ายคำสั่ง</label>
                          <select
                            value=""
                            onChange={(e) => {
                              if (e.target.value) setEffectiveLine(e.target.value);
                            }}
                            className="ledger-input"
                          >
                            <option value="">-- เลือกข้อความมาตรฐาน --</option>
                            <option value="ทั้งนี้ ตั้งแต่บัดนี้เป็นต้นไป">ทั้งนี้ ตั้งแต่บัดนี้เป็นต้นไป</option>
                            <option value="ทั้งนี้ ให้คณะกรรมการที่ได้รับการแต่งตั้ง ปฏิบัติหน้าที่อย่างเต็มกำลังความสามารถ เสียสละ เพื่อให้การดำเนินการเป็นไปด้วยความเรียบร้อย ราบรื่น บรรลุวัตถุประสงค์ และบังเกิดผลดีต่อทางราชการ ต่อไป">
                              ทั้งนี้ ให้คณะกรรมการที่ได้รับการแต่งตั้ง ปฏิบัติหน้าที่...
                            </option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-[#475569]">วันที่มีผลบังคับใช้ / ข้อความปิดท้าย</label>
                          <input type="text" value={effectiveLine} onChange={(e) => setEffectiveLine(e.target.value)} className="ledger-input" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-[#475569]">เลือกคำลงท้ายมาตรฐาน</label>
                        <select
                          onChange={(e) => {
                            if (e.target.value) setClosingPurpose(e.target.value);
                          }}
                          defaultValue=""
                          className="ledger-input"
                        >
                          <option value="">-- เลือกรูปแบบคำลงท้าย --</option>
                          {CLOSING_PRESETS.map((p) => (
                            <option key={p.label} value={p.text}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-[#475569]">ข้อความคำลงท้าย</label>
                        <input
                          type="text"
                          value={closingPurpose}
                          onChange={(e) => setClosingPurpose(e.target.value)}
                          className="ledger-input prose-saraban"
                        />
                      </div>
                    </div>
                  )}

                  {docType === "memo" && (
                    <div className="grid grid-cols-1 gap-3 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 sm:grid-cols-2">
                      <div>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <label className="block text-xs font-semibold text-[#475569]">ผู้เสนอ (ระดับ 1)</label>
                          {draftPersonnel.length > 0 && (
                            <select
                              value=""
                              onChange={(e) => {
                                const p = draftPersonnel.find((x) => x.id === e.target.value);
                                if (p) {
                                  setSigner1Name(p.full_name);
                                  setSigner1Title(p.position);
                                }
                              }}
                              className="max-w-[165px] rounded border border-[#CBD5E1] bg-white px-1.5 py-0.5 text-[11px] text-[#334155]"
                            >
                              <option value="">ดึงจากคำสั่ง ๑ ต.ค. ๖๙</option>
                              {draftPersonnel.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.full_name}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                        <input
                          type="text"
                          value={signer1Name}
                          onChange={(e) => setSigner1Name(e.target.value)}
                          className="ledger-input mb-1.5"
                        />
                        <input
                          type="text"
                          value={signer1Title}
                          onChange={(e) => setSigner1Title(e.target.value)}
                          className="ledger-input"
                        />
                      </div>
                      <div>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <label className="block text-xs font-semibold text-[#475569]">ผู้รับรอง (ระดับ 2 - ถ้ามี)</label>
                          {draftPersonnel.length > 0 && (
                            <select
                              value=""
                              onChange={(e) => {
                                const p = draftPersonnel.find((x) => x.id === e.target.value);
                                if (p) {
                                  setSigner2Name(p.full_name);
                                  setSigner2Title(p.position);
                                }
                              }}
                              className="max-w-[165px] rounded border border-[#CBD5E1] bg-white px-1.5 py-0.5 text-[11px] text-[#334155]"
                            >
                              <option value="">ดึงจากคำสั่ง ๑ ต.ค. ๖๙</option>
                              {draftPersonnel.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.full_name}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                        <input
                          type="text"
                          value={signer2Name}
                          onChange={(e) => setSigner2Name(e.target.value)}
                          className="ledger-input mb-1.5"
                        />
                        <input
                          type="text"
                          value={signer2Title}
                          onChange={(e) => setSigner2Title(e.target.value)}
                          className="ledger-input"
                        />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* Meeting Agenda & Minutes Form */
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#475569]">ชื่อการประชุม</label>
                      <input type="text" value={meetingTitle} onChange={(e) => setMeetingTitle(e.target.value)} className="ledger-input" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#475569]">ครั้งที่</label>
                      <input type="text" value={sessionNo} onChange={(e) => setSessionNo(e.target.value)} className="ledger-input tabular-nums-th" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#475569]">วันที่ประชุม</label>
                      <input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} className="ledger-input tabular-nums-th" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#475569]">เวลาเริ่ม</label>
                      <input type="text" value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} className="ledger-input tabular-nums-th" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#475569]">สถานที่</label>
                      <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} className="ledger-input" />
                    </div>
                  </div>
                  {docType === "minutes" && (
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#475569]">ผู้มาประชุม (บรรทัดละ 1 ท่าน)</label>
                      <textarea rows={3} value={attendeesText} onChange={(e) => setAttendeesText(e.target.value)} className="ledger-input prose-saraban" />
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#475569]">วาระที่ ๑ ประธานแจ้งทราบ</label>
                      <textarea rows={2} value={agenda1Text} onChange={(e) => setAgenda1Text(e.target.value)} className="ledger-input prose-saraban" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#475569]">วาระที่ ๒ รับรองรายงานการประชุม</label>
                      <textarea rows={2} value={agenda2Text} onChange={(e) => setAgenda2Text(e.target.value)} className="ledger-input prose-saraban" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#475569]">วาระที่ ๓ เสนอเพื่อทราบ</label>
                      <textarea rows={2} value={agenda3Text} onChange={(e) => setAgenda3Text(e.target.value)} className="ledger-input prose-saraban" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#475569]">วาระที่ ๔ เสนอเพื่อพิจารณา</label>
                      <textarea rows={2} value={agenda4Text} onChange={(e) => setAgenda4Text(e.target.value)} className="ledger-input prose-saraban" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#475569]">วาระที่ ๕ เรื่องอื่น ๆ</label>
                      <input type="text" value={agenda5Text} onChange={(e) => setAgenda5Text(e.target.value)} className="ledger-input" />
                    </div>
                    {docType === "minutes" && (
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-[#475569]">เลิกประชุมเวลา</label>
                        <input type="text" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="ledger-input tabular-nums-th" />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Action Buttons & Submit Routing */}
              <div className="border-t border-[#E2E8F0] pt-4">
                <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#475569]">ผู้ตรวจร่าง (รองฯ ฝ่าย / หัวหน้า)</label>
                    <select value={reviewerEmail} onChange={(e) => setReviewerEmail(e.target.value)} className="ledger-input text-xs">
                      <option value="">-- ส่งตรงผู้อนุมัติ --</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.email || u.username || u.id}>
                          {u.full_name} ({u.position_title})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#475569]">ผู้อนุมัติ / ลงนาม</label>
                    <select value={approverEmail} onChange={(e) => setApproverEmail(e.target.value)} className="ledger-input text-xs">
                      {users.map((u) => (
                        <option key={u.id} value={u.email || u.username || u.id}>
                          {u.full_name} ({u.position_title})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleValidateAndRender}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#1D4ED8] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-50"
                  >
                    <FileCheck2 className="h-4 w-4" />
                    ตรวจทานและอัปเดตตัวอย่าง
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobilePreviewOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-[#EFF6FF] px-3.5 py-2 text-sm font-semibold text-[#1E3A8A] hover:bg-blue-100 xl:hidden"
                  >
                    <Eye className="h-4 w-4" />
                    ดูตัวอย่าง A4
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleSaveAndSubmit(false)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-4 py-2 text-sm font-semibold text-[#0F172A] hover:bg-slate-50 disabled:opacity-50"
                  >
                    บันทึกร่าง
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleSaveAndSubmit(true)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                    ส่งตรวจและลงนาม
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Right: Linter Report + Architectural Drafting Preview */}
        <ResponsivePreviewModal
          open={mobilePreviewOpen}
          onOpenChange={setMobilePreviewOpen}
          desktopColClass="xl:col-span-5"
          title="ตัวอย่างเอกสารและการตรวจคำ (A4)"
          triggerLabel="ดูตัวอย่าง A4"
          loading={previewLoading}
          pageCount={renderResult?.page_image_urls?.length || 0}
          hasPreview={Boolean(renderResult?.docx_url || renderResult?.pdf_url)}
          topContent={
            <section className="ledger-panel overflow-hidden">
              <div className="ledger-panel-header flex items-center justify-between">
                <h2 className="text-xs font-bold text-[#0F172A]">ผลการตรวจคำและระเบียบแบบฟอร์ม</h2>
                {renderResult && (
                  <span className="tabular-nums-th text-[11px] font-medium text-[#475569]">
                    {issues.length === 0 ? "ผ่านเกณฑ์ 100%" : `พบ ${issues.length} รายการ`}
                  </span>
                )}
              </div>
              <div className="p-3.5">
                {!renderResult ? (
                  <p className="text-xs text-[#475569]">กดปุ่ม &ldquo;ตรวจทานและอัปเดตตัวอย่าง&rdquo; เพื่อตรวจสอบคำผิดและเลขไทยตามระเบียบงานสารบรรณ</p>
                ) : issues.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
                    ผ่านการตรวจสอบครบถ้วน ไม่มีคำผิดหรือรูปแบบบกพร่อง
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {issues.map((item, i) => (
                      <li
                        key={i}
                        className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${
                          item.level === "ERROR"
                            ? "border-red-200 bg-red-50 text-[#991B1B]"
                            : "border-amber-200 bg-amber-50 text-amber-900"
                        }`}
                      >
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <div>
                          <span className="font-bold">[{item.level}] {item.location}:</span> {item.message}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          }
        >
          <DocumentPreviewPanel
            fontFamily={fontFamily}
            docxUrl={renderResult?.docx_url}
            pdfUrl={renderResult?.pdf_url}
            pageImageUrls={renderResult?.page_image_urls}
            pdfError={renderResult?.pdf_error}
            loading={previewLoading}
            versionKey={previewVersion}
          />
        </ResponsivePreviewModal>
      </div>
    </div>
  );
}
