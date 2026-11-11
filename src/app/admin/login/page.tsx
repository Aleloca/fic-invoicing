import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await isAdmin()) redirect("/admin");
  return (
    <main className="container narrow">
      <h1>fic-invoicing admin</h1>
      <div className="card">
        <LoginForm />
      </div>
    </main>
  );
}
