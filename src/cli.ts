#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { deviceCodeLogin, getApiUrl } from './auth.js';
import * as identity from './cli_commands/identity.js';
import * as agentCmds from './cli_commands/agent.js';
import * as runtime from './cli_commands/runtime.js';
import * as jobsBids from './cli_commands/jobs_bids.js';
import * as sandbox from './cli_commands/sandbox.js';
import * as keys from './cli_commands/keys.js';
import * as rep from './cli_commands/reputation_diag.js';
import * as webhook from './cli_commands/webhook.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = join(__dirname, '..', 'templates');
const TEMPLATE_FILES = [
  { src: 'agent.ts.tpl', dest: 'agent.ts' },
  { src: 'Dockerfile.tpl', dest: 'Dockerfile' },
  { src: 'docker-compose.yml.tpl', dest: 'docker-compose.yml' },
  { src: '.env.example.tpl', dest: '.env.example' },
  { src: 'package.json.tpl', dest: 'package.json' },
  { src: 'README.md.tpl', dest: 'README.md' },
  { src: '.gitignore.tpl', dest: '.gitignore' },
];

function scaffoldProject(name: string): string {
  const targetDir = join(process.cwd(), name);
  if (existsSync(targetDir)) {
    console.error(`Error: Directory "${name}" already exists.`);
    process.exit(1);
  }
  mkdirSync(targetDir, { recursive: true });
  for (const { src, dest } of TEMPLATE_FILES) {
    const templatePath = join(TEMPLATES_DIR, src);
    if (!existsSync(templatePath)) continue;
    let content = readFileSync(templatePath, 'utf-8');
    content = content.replaceAll('{{AGENT_NAME}}', name);
    writeFileSync(join(targetDir, dest), content);
  }
  return targetDir;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('sota-agent-ts')
    .description('SOTA Agent SDK CLI')
    .version('0.1.0', '-v, --version');

  // Identity
  program
    .command('login')
    .description('Authenticate via device code')
    .action(async () => {
      console.log('Starting device-code authentication...');
      const creds = await deviceCodeLogin();
      console.log(`\n  Authenticated as: ${creds.email}`);
    });

  program
    .command('logout')
    .description('Delete local credentials')
    .option('-y, --yes', 'skip confirmation')
    .action((opts) => identity.logoutAction(opts));

  program
    .command('whoami')
    .description('Show current user')
    .option('--json', 'machine-readable')
    .action((opts) => identity.whoamiAction(opts));

  program
    .command('init <name>')
    .description('Scaffold a new SOTA agent project')
    .option('--register', 'also register the agent after scaffolding')
    .action(async (name: string, opts: { register?: boolean }) => {
      const dest = scaffoldProject(name);
      console.log(`\nCreated agent project: ${name}/`);
      if (opts.register) {
        console.log('(Registration flow TBD — run `sota-agent-ts agent register` in the new dir.)');
      } else {
        console.log('Next steps:');
        console.log(`  cd ${name}`);
        console.log('  cp .env.example .env');
        console.log('  npm install');
        console.log('  npm start');
      }
    });

  program
    .command('config')
    .description('Print (or append) SDK config')
    .option('--write <envPath>', 'append config to this .env file')
    .action(async (opts: { write?: string }) => {
      const r = await fetch(`${getApiUrl()}/api/v1/developer/config`);
      if (!r.ok) {
        console.error(`Error: ${await r.text()}`);
        process.exit(1);
      }
      const cfg = await r.json() as {
        api_url: string; supabase_url: string; supabase_anon_key: string;
      };
      const lines = [
        `SOTA_API_URL=${cfg.api_url}`,
        `SUPABASE_URL=${cfg.supabase_url}`,
        `SUPABASE_ANON_KEY=${cfg.supabase_anon_key}`,
      ];
      if (opts.write) {
        const { appendFileSync } = await import('node:fs');
        appendFileSync(opts.write, `\n# SOTA developer config\n${lines.join('\n')}\n`);
        console.log(`  Config appended to ${opts.write}`);
      } else {
        for (const l of lines) console.log(l);
      }
    });

  // Agent group
  const agent = program.command('agent').description('Agent CRUD');
  agent.command('list')
    .description('List your agents')
    .option('--json', 'machine-readable')
    .option('--status <s>', 'filter by status')
    .option('--include-deleted', 'include soft-deleted')
    .action((opts) => agentCmds.agentListAction(opts));
  agent.command('register')
    .description('Register a new agent')
    .option('--name <n>', 'agent name')
    .option('--caps <csv>', 'comma-separated capabilities')
    .option('--wallet <addr>', 'Solana wallet address')
    .option('--desc <d>', 'description')
    .option('--webhook <url>', 'webhook URL')
    .action((opts) => agentCmds.agentRegisterAction(opts));
  agent.command('delete <id>')
    .description('Soft-delete an agent')
    .option('-y, --yes', 'skip confirmation')
    .action((id, opts) => agentCmds.agentDeleteAction(id, opts));
  agent.command('show [id]')
    .description('Show agent details')
    .option('--json', 'machine-readable')
    .action((id, opts) => agentCmds.agentShowAction(id, opts));
  agent.command('set <field> <value>')
    .description('Update a single editable field')
    .option('--json', 'machine-readable')
    .action((field, value, opts) => agentCmds.agentSetAction(field, value, opts));
  agent.command('edit [id]')
    .description('Open editable fields in $EDITOR as YAML')
    .option('-y, --yes', 'skip capability re-gate prompt')
    .action((id, opts) => agentCmds.agentEditAction(id, opts));
  agent.command('switch <id>')
    .description('Switch CWD .env to a different agent (stub)')
    .option('-y, --yes', 'skip prompt')
    .action((id, opts) => agentCmds.agentSwitchAction(id, opts));

  // Runtime
  program.command('status')
    .description('Show current agent status')
    .option('--json', 'machine-readable')
    .action((opts) => runtime.statusAction(opts));
  program.command('watch')
    .description('Live-render status')
    .option('-i, --interval <s>', 'poll interval in seconds', parseFloat, 5)
    .option('--forever', 'keep watching even after status settles')
    .action((opts) => runtime.watchAction(opts));
  program.command('ping')
    .description('Check backend + key health')
    .action(() => runtime.pingAction());
  program.command('run')
    .description('Run the agent in CWD (npm start / python agent.py)')
    .action(() => runtime.runAction());
  program.command('logs')
    .description('Stream server-side agent events')
    .option('--follow', 'keep polling (default on)', true)
    .option('--no-follow', 'fetch one page and exit')
    .option('--interval <s>', 'poll interval', parseFloat, 2)
    .option('--job <id>', 'filter by job id')
    .option('--since <ts>', 'ISO timestamp backfill')
    .option('--limit <n>', 'max per poll', parseInt, 200)
    .option('--json', 'NDJSON for piping')
    .action((opts) => runtime.logsAction({
      follow: opts.follow !== false,
      json: !!opts.json,
      interval: opts.interval,
      limit: opts.limit,
      jobId: opts.job,
      since: opts.since,
    }));

  // Jobs & bids
  const jobs = program.command('jobs').description('Jobs this agent sees');
  jobs.command('list')
    .description('List jobs')
    .option('--json', 'machine-readable')
    .option('--limit <n>', 'max results', parseInt, 50)
    .action((opts) => jobsBids.jobsListAction(opts));
  program.command('job-show <id>')
    .description('Show details for one job')
    .option('--json', 'machine-readable')
    .action((id, opts) => jobsBids.jobShowAction(id, opts));

  const bids = program.command('bids').description('Bids placed by this agent');
  bids.command('list')
    .description('List bids')
    .option('--json', 'machine-readable')
    .option('--status <s>', 'filter by status')
    .option('--since <ts>', 'ISO created_at lower bound')
    .action((opts) => jobsBids.bidsListAction(opts));
  const bidG = program.command('bid').description('Single-bid operations');
  bidG.command('submit <jobId>')
    .description('Manually submit a bid')
    .requiredOption('--amount <usdc>', 'USDC amount', parseFloat)
    .requiredOption('--eta <seconds>', 'estimated seconds', parseInt)
    .action((jobId, opts) => jobsBids.bidSubmitAction(jobId, opts));
  bidG.command('cancel <bidId>')
    .description('Cancel a bid (stub)')
    .option('-y, --yes', 'skip prompt')
    .action((id, opts) => jobsBids.bidCancelAction(id, opts));

  // Sandbox + review
  const sb = program.command('sandbox').description('Sandbox gate ops');
  sb.command('status')
    .description('Sandbox test progress')
    .option('--json', 'machine-readable')
    .action((opts) => sandbox.sandboxStatusAction(opts));
  sb.command('retry <testJobId>')
    .description('Retry a failed sandbox test job')
    .action((id) => sandbox.sandboxRetryAction(id));
  const rv = program.command('review').description('Review gate ops');
  rv.command('request')
    .description('Request admin review')
    .action(() => sandbox.reviewRequestAction());
  rv.command('status')
    .description('Check review status')
    .option('--json', 'machine-readable')
    .action((opts) => sandbox.reviewStatusAction(opts));
  program.command('request-review', { hidden: true })
    .action(() => sandbox.reviewRequestAction());

  // Keys
  const keysG = program.command('keys').description('API key management');
  keysG.command('list')
    .description('List keys')
    .option('--json', 'machine-readable')
    .option('--include-revoked', 'include revoked')
    .action((opts) => keys.keysListAction(opts));
  keysG.command('rotate')
    .description('Rotate current API key + atomically rewrite .env')
    .action(() => keys.keysRotateAction());
  keysG.command('create')
    .description('Create a new API key (JWT-gated)')
    .option('--label <l>', 'key label')
    .option('--expires-days <n>', 'expire after N days', parseInt)
    .option('--json', 'machine-readable')
    .action((opts) => keys.keysCreateAction(opts));
  keysG.command('revoke <keyId>')
    .description('Revoke a key')
    .option('-y, --yes', 'skip prompt')
    .action((id, opts) => keys.keysRevokeAction(id, opts));

  // Reputation + diagnostics
  program.command('reputation')
    .alias('rep')
    .description('Show reputation stats')
    .option('--json', 'machine-readable')
    .action((opts) => rep.reputationAction(opts));
  program.command('doctor')
    .description('Diagnose env, backend, auth, capabilities')
    .action(() => rep.doctorAction());
  program.command('capabilities')
    .alias('caps')
    .description('Print supported capabilities')
    .option('--json', 'machine-readable')
    .action((opts) => rep.capabilitiesAction(opts));
  program.command('onboard')
    .description('Print onboarding markdown')
    .action(() => rep.onboardAction());

  // Webhook
  const wh = program.command('webhook').description('Webhook helpers');
  wh.command('verify <path>')
    .description('Verify HMAC against raw body bytes')
    .requiredOption('--sig <hex>', 'signature header value')
    .action((path, opts) => webhook.webhookVerifyAction(path, opts));
  wh.command('test')
    .description('Send a synthetic signed webhook to a local handler')
    .requiredOption('--url <url>', 'handler URL')
    .requiredOption('--job-id <id>', 'job id to include in body')
    .action((opts) => webhook.webhookTestAction(opts));

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof Error) {
      console.error(err.message);
    }
    process.exit(1);
  }
}

function isDirectlyInvoked(): boolean {
  try {
    const invoked = pathToFileURL(realpathSync(process.argv[1])).href;
    return invoked === import.meta.url;
  } catch {
    return false;
  }
}

if (isDirectlyInvoked()) {
  main();
}
