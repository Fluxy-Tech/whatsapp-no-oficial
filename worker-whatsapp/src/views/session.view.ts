import type { SessionState } from "../services/whatsapp/session.manager";

export function sessionView(organizationId: string, state: SessionState, isClientActive: boolean) {
  return {
    organizationId,
    status: state.status,
    qrCode: state.qrCode,
    phoneNumber: state.phoneNumber,
    lastError: state.lastError,
    isClientActive,
    updatedAt: state.updatedAt,
  };
}
