"use client";

import Swal, { SweetAlertOptions } from "sweetalert2";

const BASE_CUSTOM_CLASS: SweetAlertOptions["customClass"] = {
  container: "cric-swal-container",
  popup: "cric-swal-popup",
  title: "cric-swal-title",
  htmlContainer: "cric-swal-html",
  confirmButton: "cric-swal-confirm",
  cancelButton: "cric-swal-cancel",
  input: "cric-swal-input",
  actions: "cric-swal-actions",
};

const DANGER_CUSTOM_CLASS: SweetAlertOptions["customClass"] = {
  ...BASE_CUSTOM_CLASS,
  confirmButton: "cric-swal-danger",
};

const TOAST_BASE = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 3200,
  timerProgressBar: true,
  customClass: {
    container: "cric-swal-container",
    popup: "cric-swal-toast",
    title: "cric-swal-toast-title",
    htmlContainer: "cric-swal-toast-html",
  },
  didOpen: (toast) => {
    toast.addEventListener("mouseenter", Swal.stopTimer);
    toast.addEventListener("mouseleave", Swal.resumeTimer);
  },
});

export function toastSuccess(title: string, text?: string): void {
  void TOAST_BASE.fire({
    icon: "success",
    iconColor: "#15803d",
    title,
    ...(text ? { text } : {}),
  });
}

export function toastError(title: string, detail?: string): void {
  void TOAST_BASE.fire({
    icon: "error",
    iconColor: "#b91c1c",
    timer: 4500,
    title,
    ...(detail ? { text: detail } : {}),
  });
}

export function toastInfo(title: string, text?: string): void {
  void TOAST_BASE.fire({
    icon: "info",
    iconColor: "#1d4ed8",
    title,
    ...(text ? { text } : {}),
  });
}

export async function confirmAction(opts: {
  title: string;
  text?: string;
  confirmText?: string;
  cancelText?: string;
  icon?: "question" | "info" | "warning";
}): Promise<boolean> {
  const res = await Swal.fire({
    icon: opts.icon ?? "question",
    iconColor: "#1d4ed8",
    title: opts.title,
    text: opts.text,
    showCancelButton: true,
    confirmButtonText: opts.confirmText ?? "ยืนยันดำเนินการ",
    cancelButtonText: opts.cancelText ?? "ยกเลิก",
    reverseButtons: true,
    buttonsStyling: false,
    customClass: BASE_CUSTOM_CLASS,
  });
  return res.isConfirmed;
}

export async function confirmDanger(opts: {
  title: string;
  text?: string;
  confirmText?: string;
  cancelText?: string;
}): Promise<boolean> {
  const res = await Swal.fire({
    icon: "warning",
    iconColor: "#b91c1c",
    title: opts.title,
    text: opts.text,
    showCancelButton: true,
    confirmButtonText: opts.confirmText ?? "ยืนยันการลบ",
    cancelButtonText: opts.cancelText ?? "ยกเลิก",
    reverseButtons: true,
    buttonsStyling: false,
    customClass: DANGER_CUSTOM_CLASS,
  });
  return res.isConfirmed;
}

export async function promptRevisionReason(initialValue = ""): Promise<string | null> {
  const res = await Swal.fire<string>({
    icon: "warning",
    iconColor: "#b91c1c",
    title: "ส่งกลับเอกสารเพื่อแก้ไข",
    text: "ระบุหมายเหตุหรือจุดที่ต้องการให้ผู้ร่างแก้ไขเพิ่มเติม",
    input: "textarea",
    inputValue: initialValue,
    inputPlaceholder: "เช่น กรุณาแก้ไขวันที่และเลขที่หนังสืออ้างอิงให้ตรงกับต้นเรื่อง...",
    showCancelButton: true,
    confirmButtonText: "ยืนยันส่งกลับแก้ไข",
    cancelButtonText: "ยกเลิก",
    reverseButtons: true,
    buttonsStyling: false,
    customClass: DANGER_CUSTOM_CLASS,
    inputValidator: (value) => {
      if (!value || !value.trim()) {
        return "กรุณาระบุเหตุผลหรือคำแนะนำในการแก้ไข";
      }
      return null;
    },
  });
  return res.isConfirmed ? (res.value ?? "").trim() : null;
}
