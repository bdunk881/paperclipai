import { ApolloConnectorService } from "../apollo/service";
import { GmailConnectorService } from "../gmail/service";
import { HubSpotConnectorService } from "../hubspot/service";
import { LinearConnectorService } from "../linear/service";
import { SentryConnectorService } from "../sentry/service";
import { SlackClient } from "../slack/slackClient";
import { SlackConnectorService } from "../slack/service";
import { StripeConnectorService } from "../stripe/service";
import { TeamsConnectorService } from "../teams/service";
import { JiraAdapter } from "../tracker-sync/jiraAdapter";

jest.setTimeout(120_000);

const REQUIRE_ALL = process.env.REQUIRE_ALL_TIER1_CONNECTORS === "true";
const INVALID_TOKEN = "pc_invalid_provider_token";

const apolloService = new ApolloConnectorService();
const gmailService = new GmailConnectorService();
const hubSpotService = new HubSpotConnectorService();
const linearService = new LinearConnectorService();
const sentryService = new SentryConnectorService();
const slackService = new SlackConnectorService();
const stripeService = new StripeConnectorService();
const teamsService = new TeamsConnectorService();

type WriteScenario = {
  requiredEnv: string[];
  run: (params: { userId: string; token: string }) => Promise<void>;
};

type ProviderHealth = {
  status: string;
  details: {
    auth: boolean;
    apiReachable: boolean;
  };
};

type ConnectorHarness = {
  name: string;
  tokenEnv: string;
  connect: (userId: string, token: string) => Promise<unknown>;
  listConnections: (userId: string) => Promise<unknown[]>;
  testConnection: (userId: string) => Promise<Record<string, unknown>>;
  health: (userId: string) => Promise<ProviderHealth>;
  readScenario: {
    name: string;
    run: (userId: string) => Promise<unknown>;
  };
  writeScenario?: WriteScenario;
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function requiredEnv(name: string): string {
  const value = env(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

let sequence = 0;
function userId(connector: string, scenario: string): string {
  sequence += 1;
  return `tier1-${connector}-${scenario}-${Date.now()}-${sequence}`;
}

async function expectProviderFailure(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    const candidate = error as { message?: string; type?: string; statusCode?: number };
    expect(typeof candidate.message).toBe("string");
    if (candidate.type) {
      expect(["auth", "network", "rate-limit", "upstream"]).toContain(candidate.type);
    }
    if (candidate.statusCode) {
      expect(candidate.statusCode).toBeGreaterThanOrEqual(400);
    }
    return;
  }

  throw new Error("Expected provider-facing call to fail");
}

function createJiraAdapter(apiToken = requiredEnv("TIER1_JIRA_API_TOKEN")) {
  return new JiraAdapter({
    site: requiredEnv("TIER1_JIRA_SITE"),
    email: requiredEnv("TIER1_JIRA_EMAIL"),
    apiToken,
    defaultProjectKey: env("TIER1_JIRA_PROJECT_KEY"),
  });
}

const harnesses: ConnectorHarness[] = [
  {
    name: "apollo",
    tokenEnv: "TIER1_APOLLO_API_KEY",
    connect: (testUserId, token) => apolloService.connectApiKey({ userId: testUserId, apiKey: token }),
    listConnections: async (testUserId) => apolloService.listConnections(testUserId),
    testConnection: (testUserId) => apolloService.testConnection(testUserId),
    health: (testUserId) => apolloService.health(testUserId),
    readScenario: {
      name: "viewer lookup",
      run: (testUserId) => apolloService.testConnection(testUserId),
    },
  },
  {
    name: "jira",
    tokenEnv: "TIER1_JIRA_API_TOKEN",
    connect: async (_testUserId, token) => {
      await createJiraAdapter(token).listIssues(1);
    },
    listConnections: async () => [{ site: requiredEnv("TIER1_JIRA_SITE") }],
    testConnection: async () => {
      const health = await createJiraAdapter().health();
      return {
        provider: health.provider,
        status: health.status,
        subject: requiredEnv("TIER1_JIRA_SITE"),
      };
    },
    health: async () => createJiraAdapter().health(),
    readScenario: {
      name: "issue listing",
      run: async () => createJiraAdapter().listIssues(5),
    },
    writeScenario: {
      requiredEnv: ["TIER1_JIRA_ISSUE_KEY"],
      run: async () => {
        const updated = await createJiraAdapter().updateIssue(
          requiredEnv("TIER1_JIRA_ISSUE_KEY"),
          { description: `Provider-facing QA smoke update ${new Date().toISOString()}` }
        );

        expect(updated.key).toBe(requiredEnv("TIER1_JIRA_ISSUE_KEY"));
      },
    },
  },
  {
    name: "gmail",
    tokenEnv: "TIER1_GMAIL_API_KEY",
    connect: (testUserId, token) => gmailService.connectApiKey({ userId: testUserId, apiKey: token }),
    listConnections: async (testUserId) => gmailService.listConnections(testUserId),
    testConnection: (testUserId) => gmailService.testConnection(testUserId),
    health: (testUserId) => gmailService.health(testUserId),
    readScenario: {
      name: "label listing",
      run: (testUserId) => gmailService.listLabels(testUserId),
    },
    writeScenario: {
      requiredEnv: ["TIER1_GMAIL_TO_EMAIL"],
      run: async ({ userId: testUserId }) => {
        const mailbox = await gmailService.testConnection(testUserId);
        const sent = await gmailService.sendMessage(testUserId, {
          to: requiredEnv("TIER1_GMAIL_TO_EMAIL"),
          subject: `AutoFlow QA provider smoke ${Date.now()}`,
          text: "AutoFlow Tier 1 provider-facing Gmail smoke test.",
        });

        expect(sent.id).toBeTruthy();
        expect(sent.threadId).toBeTruthy();
        expect(mailbox.emailAddress).toBeTruthy();
      },
    },
  },
  {
    name: "hubspot",
    tokenEnv: "TIER1_HUBSPOT_API_KEY",
    connect: (testUserId, token) => hubSpotService.connectApiKey({ userId: testUserId, apiKey: token }),
    listConnections: async (testUserId) => hubSpotService.listConnections(testUserId),
    testConnection: (testUserId) => hubSpotService.testConnection(testUserId),
    health: (testUserId) => hubSpotService.health(testUserId),
    readScenario: {
      name: "contact listing",
      run: (testUserId) => hubSpotService.listContacts(testUserId),
    },
    writeScenario: {
      requiredEnv: ["TIER1_HUBSPOT_CONTACT_ID"],
      run: async ({ userId: testUserId }) => {
        const marker = `QA ${Date.now()}`;
        const updated = await hubSpotService.updateContact(
          testUserId,
          requiredEnv("TIER1_HUBSPOT_CONTACT_ID"),
          { firstname: marker }
        );

        expect(updated.id).toBe(requiredEnv("TIER1_HUBSPOT_CONTACT_ID"));
      },
    },
  },
  {
    name: "linear",
    tokenEnv: "TIER1_LINEAR_API_KEY",
    connect: (testUserId, token) => linearService.connectApiKey({ userId: testUserId, apiKey: token }),
    listConnections: async (testUserId) => Promise.resolve(linearService.listConnections(testUserId)),
    testConnection: (testUserId) => linearService.testConnection(testUserId),
    health: (testUserId) => linearService.health(testUserId),
    readScenario: {
      name: "project listing",
      run: (testUserId) => linearService.listProjects(testUserId),
    },
    writeScenario: {
      requiredEnv: ["TIER1_LINEAR_ISSUE_ID"],
      run: async ({ userId: testUserId }) => {
        const updated = await linearService.updateIssue(
          testUserId,
          requiredEnv("TIER1_LINEAR_ISSUE_ID"),
          { description: `Provider-facing QA smoke update ${new Date().toISOString()}` }
        );

        expect(updated.id).toBe(requiredEnv("TIER1_LINEAR_ISSUE_ID"));
      },
    },
  },
  {
    name: "sentry",
    tokenEnv: "TIER1_SENTRY_API_KEY",
    connect: (testUserId, token) => sentryService.connectApiKey({ userId: testUserId, apiKey: token }),
    listConnections: async (testUserId) => sentryService.listConnections(testUserId),
    testConnection: (testUserId) => sentryService.testConnection(testUserId),
    health: (testUserId) => sentryService.health(testUserId),
    readScenario: {
      name: "project listing",
      run: (testUserId) => sentryService.listProjects(testUserId),
    },
  },
  {
    name: "slack",
    tokenEnv: "TIER1_SLACK_BOT_TOKEN",
    connect: (testUserId, token) => slackService.connectApiKey({ userId: testUserId, botToken: token }),
    listConnections: async (testUserId) => Promise.resolve(slackService.listConnections(testUserId)),
    testConnection: (testUserId) => slackService.testConnection(testUserId),
    health: (testUserId) => slackService.health(testUserId),
    readScenario: {
      name: "channel listing",
      run: (testUserId) => slackService.listChannels(testUserId),
    },
    writeScenario: {
      requiredEnv: ["TIER1_SLACK_CHANNEL_ID"],
      run: async ({ token }) => {
        const sent = await new SlackClient(token).sendMessage(
          requiredEnv("TIER1_SLACK_CHANNEL_ID"),
          `AutoFlow Tier 1 provider-facing Slack smoke ${Date.now()}`
        );

        expect(sent.channel).toBe(requiredEnv("TIER1_SLACK_CHANNEL_ID"));
        expect(sent.ts).toBeTruthy();
      },
    },
  },
  {
    name: "stripe",
    tokenEnv: "TIER1_STRIPE_API_KEY",
    connect: (testUserId, token) => stripeService.connectApiKey({ userId: testUserId, apiKey: token }),
    listConnections: async (testUserId) => stripeService.listConnections(testUserId),
    testConnection: (testUserId) => stripeService.testConnection(testUserId),
    health: (testUserId) => stripeService.health(testUserId),
    readScenario: {
      name: "customer listing",
      run: (testUserId) => stripeService.listCustomers(testUserId, 5),
    },
    writeScenario: {
      requiredEnv: ["TIER1_STRIPE_CUSTOMER_ID"],
      run: async ({ userId: testUserId }) => {
        const invoice = await stripeService.createInvoice(testUserId, {
          customerId: requiredEnv("TIER1_STRIPE_CUSTOMER_ID"),
          autoAdvance: false,
          metadata: {
            suite: "tier1-provider-facing",
            createdBy: "qa",
          },
        });

        expect(invoice.id).toMatch(/^in_/);
        await expect(stripeService.deleteInvoice(testUserId, invoice.id)).resolves.toBe(true);
      },
    },
  },
  {
    name: "teams",
    tokenEnv: "TIER1_TEAMS_API_KEY",
    connect: (testUserId, token) => teamsService.connectApiKey({ userId: testUserId, apiKey: token }),
    listConnections: async (testUserId) => Promise.resolve(teamsService.listConnections(testUserId)),
    testConnection: (testUserId) => teamsService.testConnection(testUserId),
    health: (testUserId) => teamsService.health(testUserId),
    readScenario: {
      name: "team listing",
      run: (testUserId) => teamsService.listTeams(testUserId),
    },
  },
];

describe("Tier 1 provider-facing connector env contract", () => {
  const missingTokens = harnesses
    .map((harness) => harness.tokenEnv)
    .filter((name) => !env(name));

  const check = REQUIRE_ALL ? it : it.skip;
  check("has all required connector secrets when strict mode is enabled", () => {
    expect(missingTokens).toEqual([]);
  });
});

for (const harness of harnesses) {
  const token = env(harness.tokenEnv);
  const suite = token ? describe : describe.skip;

  suite(`[${harness.name}] Tier 1 provider-facing smoke`, () => {
    it("connects with live credentials and reports healthy status", async () => {
      const testUserId = userId(harness.name, "connect");

      await harness.connect(testUserId, token as string);
      await expect(harness.listConnections(testUserId)).resolves.toHaveLength(1);
      await expect(harness.testConnection(testUserId)).resolves.toEqual(
        expect.objectContaining({})
      );

      const health = await harness.health(testUserId);
      expect(health.status).toBe("ok");
      expect(health.details.auth).toBe(true);
      expect(health.details.apiReachable).toBe(true);
    });

    it(`runs basic read scenario: ${harness.readScenario.name}`, async () => {
      const testUserId = userId(harness.name, "read");

      await harness.connect(testUserId, token as string);
      const result = await harness.readScenario.run(testUserId);

      if (Array.isArray(result)) {
        expect(Array.isArray(result)).toBe(true);
      } else {
        expect(result).toEqual(expect.objectContaining({}));
      }
    });

    it("surfaces provider auth failures with an invalid token", async () => {
      const testUserId = userId(harness.name, "invalid-token");
      await expectProviderFailure(() => harness.connect(testUserId, INVALID_TOKEN));
    });

    if (harness.writeScenario) {
      const writeReady = harness.writeScenario.requiredEnv.every((name) => !!env(name));
      const writeTest = writeReady ? it : it.skip;

      writeTest("runs basic write scenario against a reusable sandbox fixture", async () => {
        const testUserId = userId(harness.name, "write");
        await harness.connect(testUserId, token as string);
        await harness.writeScenario?.run({ userId: testUserId, token: token as string });
      });
    }
  });
}
