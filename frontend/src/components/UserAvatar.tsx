"use client";

import { useEffect, useState } from "react";
import { resolveAvatarSrc } from "@/lib/api";

interface UserAvatarProps {
  avatarUrl?: string | null;
  fullName?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<UserAvatarProps["size"]>, string> = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-9 w-9 text-xs",
  lg: "h-14 w-14 text-base",
};

function computeInitials(fullName?: string | null): string {
  const cleaned = (fullName || "")
    .trim()
    .replace(/^(นางสาว|นาย|นาง|ดร\.|ผศ\.|รศ\.|ศ\.|ว่าที่\s*ร\.ต\.?)\s*/u, "")
    .trim();
  if (!cleaned) return "CR";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = Array.from(parts[0])[0] || "";
    const second = Array.from(parts[1])[0] || "";
    return `${first}${second}`.toUpperCase();
  }
  return Array.from(cleaned).slice(0, 2).join("").toUpperCase();
}

export function UserAvatar({ avatarUrl, fullName, size = "md", className = "" }: UserAvatarProps) {
  const src = resolveAvatarSrc(avatarUrl);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [src]);

  const sizeCls = SIZE_CLASSES[size];
  const initials = computeInitials(fullName);

  if (src && !imgFailed) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={src}
        alt={fullName || "รูปโปรไฟล์ผู้ใช้งาน"}
        onError={() => setImgFailed(true)}
        className={`${sizeCls} shrink-0 rounded-full border border-[#CBD5E1] bg-slate-100 object-cover ${className}`}
      />
    );
  }

  return (
    <span
      aria-label={fullName || "อักษรย่อโปรไฟล์"}
      className={`${sizeCls} inline-flex shrink-0 items-center justify-center rounded-full border border-[#1E3A8A]/20 bg-gradient-to-br from-[#1E3A8A] to-[#1D4ED8] font-bold tracking-tight text-white select-none ${className}`}
    >
      {initials}
    </span>
  );
}
