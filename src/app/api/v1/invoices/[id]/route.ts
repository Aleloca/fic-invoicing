import { authenticateTenant } from "@/lib/auth";
import { withErrors } from "@/lib/errors";
import { toInvoiceDto } from "@/lib/invoices/serialize";
import { findTenantInvoice } from "@/lib/invoices/service";

export const dynamic = "force-dynamic";

export const GET = withErrors(
  async (request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> => {
    const tenant = await authenticateTenant(request);
    const { id } = await context.params;
    return Response.json(toInvoiceDto(await findTenantInvoice(tenant.id, id)));
  },
);
