import { Suspense } from "react";
import { ResetAdminPasswordForm } from "./reset-admin-password-form";

export default function ResetAdminPasswordPage() {
  return (
    <Suspense fallback={<main className="admin-reset-page">Загрузка…</main>}>
      <ResetAdminPasswordForm />
    </Suspense>
  );
}
