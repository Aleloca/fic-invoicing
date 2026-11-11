import { authenticateProject } from "@/lib/auth";
import { ApiError, errorBody, withErrors } from "@/lib/errors";
import { createInvoiceSchema, formatZodIssues } from "@/lib/invoices/schema";
import { toInvoiceDto } from "@/lib/invoices/serialize";
import { createInvoice } from "@/lib/invoices/service";

export const dynamic = "force-dynamic";

export const POST = withErrors(async (request: Request): Promise<Response> => {
  const project = await authenticateProject(request);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
  }

  const parsed = createInvoiceSchema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(422, "validation_error", "Invalid request body", formatZodIssues(parsed.error));
  }

  const outcome = await createInvoice(project, parsed.data);
  const dto = toInvoiceDto(outcome.invoice);
  switch (outcome.kind) {
    case "existing":
      return Response.json(dto, { status: 200 });
    case "issued":
      return Response.json(dto, { status: 201 });
    case "failed":
      return Response.json(
        { ...dto, ...errorBody("fic_error", dto.errorMessage ?? "Fatture in Cloud request failed") },
        { status: 502 },
      );
  }
});
