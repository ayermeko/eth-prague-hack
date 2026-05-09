import { z } from 'zod';

export const configSchema = z
  .object({
    ORCHESTRATOR_PORT: z.coerce.number().default(4000),
    INVESTIGATION_BUDGET_USDC: z.coerce.number().default(2.0),
    INVESTIGATION_TIMEOUT_MS: z.coerce.number().default(180_000),
    CODEX_BIN: z.string().default('codex'),
    MCP_SERVER_NAME: z.string().default('rugsleuth'),
    BASESCAN_DEEP_ACTOR_ID: z.string(),
    APIFY_PAYMENT_MODE: z.enum(['token', 'x402']).default('x402'),
    APIFY_TOKEN: z.string().optional(),
    WALLET_PRIVATE_KEY: z.string().optional(),
    APIFY_BASE_URL: z.string().url().default('https://api.apify.com'),
    OPENAI_API_KEY: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.APIFY_PAYMENT_MODE === 'token' && !value.APIFY_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APIFY_TOKEN'],
        message: 'APIFY_TOKEN is required when APIFY_PAYMENT_MODE=token',
      });
    }

    if (
      value.APIFY_PAYMENT_MODE === 'x402' &&
      !/^0x[a-fA-F0-9]{64}$/.test(value.WALLET_PRIVATE_KEY ?? '')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WALLET_PRIVATE_KEY'],
        message: 'WALLET_PRIVATE_KEY is required when APIFY_PAYMENT_MODE=x402',
      });
    }
  });

export type OrchestratorConfig = z.infer<typeof configSchema>;

export function parseConfig(input: NodeJS.ProcessEnv): OrchestratorConfig {
  return configSchema.parse(input);
}
