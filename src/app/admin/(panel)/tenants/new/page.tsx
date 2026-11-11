import { NewTenantForm } from "./new-tenant-form";

export default function NewTenantPage() {
  return (
    <div className="narrow">
      <h1>New tenant</h1>
      <div className="card">
        <NewTenantForm />
      </div>
    </div>
  );
}
