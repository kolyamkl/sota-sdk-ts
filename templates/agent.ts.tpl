import { SOTAAgent } from '@sota/sdk';

const agent = new SOTAAgent();

// Register a handler for the "echo" capability
agent.onJob('echo', async (ctx) => {
  console.log(`[{{AGENT_NAME}}] Received job: ${ctx.job.id}`);

  await ctx.updateProgress(50, 'Processing...');

  const result = JSON.stringify({
    echo: ctx.job.parameters,
    agent: '{{AGENT_NAME}}',
    timestamp: new Date().toISOString(),
  });

  await ctx.deliver(result);
  console.log(`[{{AGENT_NAME}}] Job ${ctx.job.id} delivered`);
});

// Enable auto-bidding for echo jobs under $10
agent.setAutoBid({
  maxPrice: 10,
  capabilities: ['echo'],
});

// Start the agent
agent.run().catch(console.error);
