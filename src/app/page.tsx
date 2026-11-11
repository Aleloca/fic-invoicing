import Link from "next/link";

export default function Home() {
  return (
    <main className="container narrow">
      <h1>fic-invoicing</h1>
      <p>
        Multi-tenant service that issues Italian electronic invoices through the Fatture in Cloud API.
        The public API lives under <code>/api/v1</code>; see <code>openapi.yaml</code> in the repository.
      </p>
      <p>
        <Link href="/admin">Open the admin panel</Link>
      </p>
    </main>
  );
}
