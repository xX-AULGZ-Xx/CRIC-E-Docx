"use client";

import React, { useEffect, useState } from "react";

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";

function toArabicDigits(raw: string): string {
  return raw.replace(/[๐-๙]/g, (ch) => String(THAI_DIGITS.indexOf(ch)));
}

export interface NumericInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: number;
  onChangeValue: (val: number) => void;
  decimal?: boolean;
  min?: number;
  max?: number;
  /** When true (default), an external value of 0 displays empty so the placeholder is visible and users can type freely. */
  emptyOnZero?: boolean;
}

export function NumericInput({
  value,
  onChangeValue,
  decimal = false,
  min,
  max,
  emptyOnZero = true,
  onFocus,
  onBlur,
  ...rest
}: NumericInputProps) {
  const formatExternal = (n: number) => {
    if (!Number.isFinite(n)) return "";
    if (emptyOnZero && n === 0) return "";
    return String(n);
  };

  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState<string>(() => formatExternal(value));

  useEffect(() => {
    if (!focused) {
      setDraft(formatExternal(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused, emptyOnZero]);

  function sanitize(raw: string): string {
    const arabic = toArabicDigits(raw);
    if (!decimal) {
      return arabic.replace(/[^\d]/g, "");
    }
    let seenDot = false;
    let out = "";
    for (const ch of arabic) {
      if (ch >= "0" && ch <= "9") {
        out += ch;
      } else if (ch === "." && !seenDot) {
        seenDot = true;
        out += ".";
      }
    }
    return out;
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const clean = sanitize(e.target.value);
    setDraft(clean);

    if (clean === "" || clean === ".") {
      onChangeValue(0);
      return;
    }

    let parsed = decimal ? parseFloat(clean) : parseInt(clean, 10);
    if (!Number.isFinite(parsed)) parsed = 0;
    if (max !== undefined && parsed > max) parsed = max;
    onChangeValue(parsed);
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    setFocused(false);
    let parsed = draft === "" || draft === "." ? 0 : decimal ? parseFloat(draft) : parseInt(draft, 10);
    if (!Number.isFinite(parsed)) parsed = 0;
    if (min !== undefined && parsed < min && (draft !== "" || !emptyOnZero)) {
      parsed = min;
    }
    if (max !== undefined && parsed > max) {
      parsed = max;
    }
    onChangeValue(parsed);
    setDraft(formatExternal(parsed));
    onBlur?.(e);
  }

  return (
    <input
      {...rest}
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      value={draft}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={handleBlur}
      onChange={handleChange}
    />
  );
}
