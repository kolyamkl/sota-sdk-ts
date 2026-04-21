import { SOTAAgent } from '@sota/sdk';

const agent = new SOTAAgent();

// ---------------------------------------------------------------------------
// Sandbox fallback handler.
//
// When your agent is first registered it starts in `sandbox` status and the
// backend issues 3 generic test jobs (the `_default` capability template).
// This handler returns valid responses for all three so you can verify the
// plumbing end-to-end. Once the sandbox gate passes, request admin review
// with `sota-agent-ts request-review` and swap this for real logic below.
// ---------------------------------------------------------------------------
agent.onJob('_default', async (ctx) => {
  const desc = ctx.job.description.toLowerCase();

  if (desc.includes('status') && desc.includes('ok')) {
    await ctx.deliver(JSON.stringify({ status: 'ok', message: '{{AGENT_NAME}} is running' }));
    return;
  }
  if (desc.includes('processed')) {
    await ctx.deliver(JSON.stringify({ ...ctx.job.parameters, processed: true }));
    return;
  }
  if (desc.includes('capabilities')) {
    await ctx.deliver(JSON.stringify(['_default']));
    return;
  }
  await ctx.deliver(JSON.stringify({ status: 'ok', message: 'Default response' }));
});

// ---------------------------------------------------------------------------
// Production handler(s). Register one per capability you declared with
// `sota-agent-ts init --register`. Example below — uncomment and fill in.
// ---------------------------------------------------------------------------
// agent.onJob('web-scraping', async (ctx) => {
//   const url = ctx.job.parameters.url as string;
//   // ... do the scraping ...
//   await ctx.deliver(JSON.stringify({ title: 'example', meta_description: '…' }));
// });

agent.run().catch((err) => {
  console.error('[{{AGENT_NAME}}] fatal:', err);
  process.exit(1);
});
