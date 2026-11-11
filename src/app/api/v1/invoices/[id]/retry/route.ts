import { authenticateProject } from "@/lib/auth";
import { errorBody, withErrors } from "@/lib/errors";
import { toInvoiceDto } from "@/lib/invoices/serialize";
import { retryInvoice } from "@/lib/invoices/service";

export const dynamic = "force-dynamic";

export const POST = withErrors(
  async (request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> => {
    const project = await authenticateProject(request);
    const { id } = await context.params;
    const invoice = await retryInvoice(project, id);
    const dto = toInvoiceDto(invoice);
    if (invoice.status === "FAILED") {
      return Response.json(
        { ...dto, ...errorBody("fic_error", dto.errorMessage ?? "Fatture in Cloud request failed") },
        { status: 502 },
      );
    }
    return Response.json(dto, { status: 200 });
  },
);
