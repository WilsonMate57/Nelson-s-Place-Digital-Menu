import { randomBytes } from "node:crypto";
import type { ServiceRequestInput } from "../../shared/schemas";
import type { GuestServiceRequestDto, ServiceRequestDto } from "../../shared/types";
import { AppError, badRequest, conflict, notFound } from "../http/errors";
import type { ServiceRequestsRepo } from "../repositories/service-requests-repo";
import type { SettingsRepo } from "../repositories/settings-repo";

/** A repeated call from the same place within this window returns the open one. */
const DUPLICATE_WINDOW_MS = 10 * 60_000;

export class ServiceRequestService {
  constructor(
    private readonly requests: ServiceRequestsRepo,
    private readonly settings: SettingsRepo,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(input: ServiceRequestInput): { request: GuestServiceRequestDto; created: boolean } {
    const settings = this.settings.get();
    if (!settings.serviceRequestsEnabled) {
      throw new AppError(503, "SERVICE_REQUESTS_DISABLED", "De momento não é possível chamar a equipa pelo menu. Contacte a recepção.");
    }
    if (!settings.locationTypes.includes(input.location.type)) throw badRequest("LOCATION_TYPE_NOT_ALLOWED", "Tipo de localização não disponível.");
    const since = new Date(this.now().getTime() - DUPLICATE_WINDOW_MS).toISOString();
    const open = this.requests.findOpen(input.kind, input.location.type, input.location.label, since);
    if (open) return { request: toGuest(open), created: false };
    const id = this.requests.create({
      token: randomBytes(18).toString("base64url"),
      kind: input.kind,
      locationType: input.location.type,
      locationLabel: input.location.label,
      paymentMethod: input.kind === "bill" ? input.paymentMethod : null,
    });
    return { request: toGuest(this.requests.get(id)!), created: true };
  }

  guestStatus(token: string): GuestServiceRequestDto {
    const request = this.requests.getByToken(token);
    if (!request) throw notFound("Chamada não encontrada");
    return toGuest(request);
  }

  listOpen(): ServiceRequestDto[] {
    return this.requests.listOpen();
  }

  markDone(id: number, staffId: number): ServiceRequestDto {
    if (!this.requests.get(id)) throw notFound("Chamada não encontrada");
    if (!this.requests.markDone(id, staffId)) throw conflict("ALREADY_HANDLED", "Esta chamada já foi atendida.");
    return this.requests.get(id)!;
  }
}

function toGuest(r: ServiceRequestDto & { token: string }): GuestServiceRequestDto {
  return { token: r.token, kind: r.kind, status: r.status, createdAt: r.createdAt };
}
