"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface DevLoginButtonProps {
  employeeId: string;
  displayName: string;
  storeName: string;
  tenantName: string;
  roles: string[];
}

/**
 * Client-Komponente fuer den Dev-Login: sendet die gewaehlte `employeeId`
 * an /api/auth/dev-login, leitet bei Erfolg zu /consultation weiter.
 *
 * NICHT produktionsreif -- siehe src/server/auth/errors.ts.
 */
export function DevLoginButton({
  employeeId,
  displayName,
  storeName,
  tenantName,
  roles,
}: DevLoginButtonProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function handleClick() {
    setStatus("loading");
    try {
      const response = await fetch("/api/auth/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId }),
      });
      if (!response.ok) {
        setStatus("error");
        return;
      }
      router.push("/consultation");
      router.refresh();
    } catch {
      setStatus("error");
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={status === "loading"}
      className="dev-login-candidate"
      aria-busy={status === "loading"}
    >
      <span className="dev-login-candidate__name">{displayName}</span>
      <span className="dev-login-candidate__meta">
        {storeName} &middot; {tenantName}
        {roles.length > 0 ? ` · ${roles.join(", ")}` : ""}
      </span>
      {status === "error" ? (
        <span role="alert" className="dev-login-candidate__error">
          Anmeldung fehlgeschlagen. Bitte erneut versuchen.
        </span>
      ) : null}
    </button>
  );
}
