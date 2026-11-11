import { authenticateTenant } from "@/lib/auth";
import { ApiError, withErrors } from "@/lib/errors";
import { fetchCourtesyPdf, FicHttpError } from "@/lib/fic/client";
import { getFicAccess } from "@/lib/fic/tokens";
import { findTenantInvoice } from "@/lib/invoices/service";

export const dynamic = "force-dynamic";

/** Streams the courtesy PDF of an issued invoice from Fatture in Cloud. */
export const GET = withErrors(
  async (request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> => {
    const tenant = await authenticateTenant(request);
    const { id } = await context.params;
    const invoice = await findTenantInvoice(tenant.id, id);

    if (invoice.status !== "ISSUED") {
      throw new ApiError(409, "conflict", `The invoice is ${invoice.status}: no PDF available`);
    }
    if (!invoice.ficDocumentId) {
      throw new ApiError(409, "conflict", "Dry-run invoices have no document in Fatture in Cloud, so no PDF");
    }

    const access = await getFicAccess(tenant.id);
    if (!access.companyId) throw new ApiError(409, "fic_not_connected", "No Fatture in Cloud company selected");

    let pdf: Response;
    try {
      pdf = await fetchCourtesyPdf(access.accessToken, access.companyId, invoice.ficDocumentId);
    } catch (error) {
      if (error instanceof FicHttpError) throw new ApiError(502, "fic_error", error.message);
      throw error;
    }

    const filename = `invoice-${(invoice.ficNumber ?? invoice.id).replace(/[^A-Za-z0-9_-]+/g, "-")}.pdf`;
    const headers: Record<string, string> = {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    };
    const length = pdf.headers.get("content-length");
    if (length) headers["Content-Length"] = length;
    return new Response(pdf.body, { status: 200, headers });
  },
);
