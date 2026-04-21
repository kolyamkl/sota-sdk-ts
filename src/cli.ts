#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { saveCredentials, loadCredentials, deviceCodeLogin, getApiUrl } from './auth.js';

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

function prompt(question: string, hide = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    if (hide) {
      // Simple hidden input
      process.stdout.write(question);
      let input = '';
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.on('data', (char) => {
        const c = char.toString();
        if (c === '\n' || c === '\r') {
          process.stdin.setRawMode?.(false);
          process.stdout.write('\n');
          rl.close();
          resolve(input);
        } else if (c === '\u0003') {
          process.exit(0);
        } else {
          input += c;
          process.stdout.write('*');
        }
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

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

async function registerAgent(name: string, dest: string): Promise<void> {
  const apiUrl = getApiUrl();

  const email = await prompt('  Email: ');
  const password = await prompt('  Password: ', true);

  console.log('  Available capabilities: web-scraping, data-extraction, code-review, text-generation, research');
  const capsInput = await prompt('  Capabilities (comma-separated): ');
  const capabilities = capsInput.split(',').map(c => c.trim()).filter(Boolean);

  if (capabilities.length === 0) {
    console.error('Error: At least one capability required.');
    process.exit(1);
  }

  console.log(`\n  Registering '${name}' with SOTA marketplace...`);

  const resp = await fetch(`${apiUrl}/api/v1/agents/register/simple`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, agent_name: name, capabilities }),
  });

  if (resp.status === 429) {
    console.error('Error: Rate limit exceeded. Try again later.');
    process.exit(1);
  }

  if (!resp.ok) {
    console.error(`Error: ${await resp.text()}`);
    process.exit(1);
  }

  const data = await resp.json() as {
    agent_id: string;
    api_key: string;
    webhook_secret: string;
  };

  // Fetch public developer config so the scaffolded .env is ready to run.
  // Best-effort: if the endpoint fails, we still write the agent-specific
  // values and tell the dev to run `sota-agent-ts config` later.
  let devCfg: { supabase_url?: string; supabase_anon_key?: string } = {};
  try {
    const cfgResp = await fetch(`${apiUrl}/api/v1/developer/config`);
    if (cfgResp.ok) devCfg = await cfgResp.json();
  } catch {
    // ignore — backend may be unreachable for config
  }

  // Write credentials to .env
  const envLines = [
    `SOTA_API_KEY=${data.api_key}`,
    `SOTA_WEBHOOK_SECRET=${data.webhook_secret}`,
    `SOTA_AGENT_ID=${data.agent_id}`,
    `SOTA_API_URL=${apiUrl}`,
  ];
  if (devCfg.supabase_url) envLines.push(`SUPABASE_URL=${devCfg.supabase_url}`);
  if (devCfg.supabase_anon_key) envLines.push(`SUPABASE_ANON_KEY=${devCfg.supabase_anon_key}`);
  writeFileSync(join(dest, '.env'), envLines.join('\n') + '\n');

  console.log(`\n  Agent '${name}' registered! (sandbox mode)`);
  console.log(`  Agent ID: ${data.agent_id}`);
  console.log(`  API key written to .env`);
  console.log(`  Webhook secret written to .env`);
  console.log(`  Complete 3 test jobs to request marketplace approval`);
}

async function login(): Promise<void> {
  console.log('Starting device-code authentication...');
  try {
    const creds = await deviceCodeLogin();
    console.log(`\n  Authenticated as: ${creds.email}`);
    console.log('  Credentials saved to ~/.sota/credentials');
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}

async function config(envPath: string | null): Promise<void> {
  const apiUrl = getApiUrl();
  let resp: Response;
  try {
    resp = await fetch(`${apiUrl}/api/v1/developer/config`);
  } catch (e) {
    console.error(`Error: Could not reach SOTA API at ${apiUrl}: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  if (!resp.ok) {
    console.error(`Error: ${await resp.text()}`);
    process.exit(1);
  }
  const cfg = await resp.json() as {
    api_url: string;
    supabase_url: string;
    supabase_anon_key: string;
  };
  const lines = [
    `SOTA_API_URL=${cfg.api_url}`,
    `SUPABASE_URL=${cfg.supabase_url}`,
    `SUPABASE_ANON_KEY=${cfg.supabase_anon_key}`,
  ];
  if (envPath) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(envPath, `\n# SOTA developer config\n${lines.join('\n')}\n`);
    console.log(`  Config appended to ${envPath}`);
  } else {
    for (const l of lines) console.log(l);
  }
}

async function requestReview(): Promise<void> {
  const creds = loadCredentials();
  if (!creds) {
    console.error("Error: Not logged in. Run 'sota-agent-ts login' first.");
    process.exit(1);
  }

  let apiKey = process.env.SOTA_API_KEY;
  if (!apiKey) {
    const envPath = join(process.cwd(), '.env');
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, 'utf-8');
      const match = envContent.match(/^SOTA_API_KEY=(.+)$/m);
      if (match) apiKey = match[1].trim();
    }
  }

  if (!apiKey) {
    console.error('Error: No API key found. Set SOTA_API_KEY or run from agent project directory.');
    process.exit(1);
  }

  const apiUrl = getApiUrl();
  const resp = await fetch(`${apiUrl}/api/v1/agents/request-review`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey },
  });

  if (resp.ok) {
    const data = await resp.json() as { agent_id?: string };
    console.log(`\n  Review requested for agent ${data.agent_id ?? ''}`);
    console.log('  An admin will review your agent\'s test results.');
  } else {
    console.error(`Error: ${await resp.text()}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === 'login') {
    await login();
  } else if (args[0] === 'init' && args[1]) {
    const name = args[1];
    const shouldRegister = args.includes('--register');
    const dest = scaffoldProject(name);
    console.log(`\nCreated agent project: ${name}/\n`);

    if (shouldRegister) {
      await registerAgent(name, dest);
    } else {
      console.log('Next steps:');
      console.log(`  cd ${name}`);
      console.log('  cp .env.example .env   # Fill in your API keys');
      console.log('  npm install');
      console.log('  npm start');
    }
  } else if (args[0] === 'request-review') {
    await requestReview();
  } else if (args[0] === 'config') {
    const writeIdx = args.indexOf('--write');
    const envPath = writeIdx >= 0 && args[writeIdx + 1] ? args[writeIdx + 1] : null;
    await config(envPath);
  } else {
    console.log('Usage: sota-agent-ts <command> [options]');
    console.log('');
    console.log('Commands:');
    console.log('  login                     Authenticate via device code');
    console.log('  init <name> [--register]  Scaffold a new SOTA agent project');
    console.log('  config [--write path]     Print (or append to .env) SDK config');
    console.log('  request-review            Request admin review after test jobs pass');
    process.exit(args.length === 0 ? 0 : 1);
  }
}

main();
