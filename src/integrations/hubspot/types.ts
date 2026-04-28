import {
  Tier1ConnectionHealth,
  Tier1ConnectionPublic,
  Tier1ConnectorError,
  Tier1ConnectorErrorType,
} from "../shared/tier1Contract";

export type HubSpotAuthMethod = "oauth2" | "api_key";

export type ConnectorErrorType = Tier1ConnectorErrorType;

export interface HubSpotTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scopes: string[];
  hubId: string;
  hubDomain?: string;
}

export interface HubSpotCredential {
  id: string;
  userId: string;
  authMethod: HubSpotAuthMethod;
  tokenEncrypted: string;
  tokenMasked: string;
  refreshTokenEncrypted?: string;
  scopes: string[];
  hubId: string;
  hubDomain?: string;
  createdAt: string;
  revokedAt?: string;
  metadata?: Record<string, string>;
}

export interface HubSpotCredentialPublic extends Tier1ConnectionPublic<HubSpotAuthMethod, {
  scopes: string[];
  hubId: string;
  hubDomain?: string;
}> {}

export interface HubSpotConnectionHealth extends Tier1ConnectionHealth<HubSpotAuthMethod, {
  hubId?: string;
}> {}

export interface HubSpotContact {
  id: string;
  email?: string;
  firstname?: string;
  lastname?: string;
  company?: string;
  phone?: string;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
}

export interface HubSpotCompany {
  id: string;
  name?: string;
  domain?: string;
  industry?: string;
  phone?: string;
  city?: string;
  country?: string;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
}

export interface HubSpotDeal {
  id: string;
  dealname?: string;
  amount?: string;
  dealstage?: string;
  pipeline?: string;
  closedate?: string;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
}

export class ConnectorError extends Tier1ConnectorError {
  constructor(type: ConnectorErrorType, message: string, statusCode = 500) {
    super(type, message, statusCode);
    this.name = "ConnectorError";
  }
}
