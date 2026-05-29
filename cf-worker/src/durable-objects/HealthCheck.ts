/**
 * Reference Durable Object — used as a smoke target for the CF Worker
 * infrastructure and as the canonical "look here for the DO pattern"
 * example for HEL-291 onwards.
 *
 * Lives at GET /__health on the Worker. Returns a deterministic JSON
 * body proving the binding + DO instantiation + storage handle all
 * wired up correctly.
 */
export class HealthCheckDO {
  private readonly instanceId: string;

  constructor(state: DurableObjectState, private readonly env: HealthCheckEnv) {
    this.instanceId = state.id.toString();
  }

  async fetch(_request: Request): Promise<Response> {
    return Response.json({
      ok: true,
      ts: new Date().toISOString(),
      instanceId: this.instanceId,
      environment: this.env.ENVIRONMENT,
    });
  }
}

export interface HealthCheckEnv {
  ENVIRONMENT: string;
}
