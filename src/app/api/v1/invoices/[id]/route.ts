import { authenticateProject } from "@/lib/auth";
import { withErrors } from "@/lib/errors";
import { toInvoiceDto } from "@/lib/invoices/serialize";
import { findProjectInvoice } from "@/lib/invoices/service";

export const dynamic = "force-dynamic";

export const GET = withErrors(
  async (request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> => {
    const project = await authenticateProject(request);
    const { id } = await context.params;
    return Response.json(toInvoiceDto(await findProjectInvoice(project.id, id)));
  },
);
