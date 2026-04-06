import type { LLMProvider, LLMMessage } from "../llm/types.js";
import type { MelistaConfig } from "../config.js";
import { loadFeedback, type FeedbackEntry } from "../memory/feedback.js";
import {
  loadKnowledge,
  storeKnowledge,
  type KnowledgeEntry,
} from "../memory/knowledge.js";
import { recordLlmUsage, canAffordTask } from "../db/costs.js";

export interface StudyResult {
  topic: KnowledgeEntry["topic"];
  insight: string;
  tokensUsed: number;
}

const STUDY_TOPICS: KnowledgeEntry["topic"][] = [
  "feedback_analysis",
  "specialty_research",
  "task_simulation",
  "cost_optimization",
  "product_intelligence",
  "prediction_research",
];

const MAX_STUDY_TURNS = 3;

/** Pick the next topic by rotating through the list based on past entries */
function pickTopic(existing: KnowledgeEntry[], feedback: FeedbackEntry[]): KnowledgeEntry["topic"] {
  // Skip feedback_analysis if there's no feedback to analyze
  const eligible = feedback.length > 0
    ? STUDY_TOPICS
    : STUDY_TOPICS.filter((t) => t !== "feedback_analysis");

  const counts = new Map<string, number>();
  for (const topic of eligible) counts.set(topic, 0);
  for (const e of existing) {
    if (eligible.includes(e.topic)) {
      counts.set(e.topic, (counts.get(e.topic) ?? 0) + 1);
    }
  }

  let minTopic = eligible[0];
  let minCount = Infinity;
  for (const topic of eligible) {
    const count = counts.get(topic) ?? 0;
    if (count < minCount) {
      minCount = count;
      minTopic = topic;
    }
  }
  return minTopic;
}

function buildStudyPrompt(
  topic: KnowledgeEntry["topic"],
  config: MelistaConfig,
  feedback: FeedbackEntry[],
  knowledge: KnowledgeEntry[],
): string {
  const specialties = config.specialties.length > 0
    ? config.specialties.join(", ")
    : "general-purpose tasks";

  const recentFeedback = feedback.slice(-10);
  const feedbackSummary = recentFeedback.length > 0
    ? recentFeedback
        .map((f) => `- Score ${f.score}/5: "${f.taskDescription}" — ${f.comments || "no comment"}`)
        .join("\n")
    : "No feedback yet.";

  const existingKnowledge = knowledge.slice(-5)
    .map((k) => `- [${k.topic}] ${k.insight.slice(0, 150)}`)
    .join("\n") || "None yet.";

  const base = `You are a self-improving autonomous agent specializing in: ${specialties}.
You are conducting a study session to improve your future task performance.

## Your existing knowledge
${existingKnowledge}

## Recent feedback from clients
${feedbackSummary}
`;

  switch (topic) {
    case "feedback_analysis":
      return `${base}
## Task: Feedback Analysis

Analyze the feedback patterns above. What patterns emerge? What kinds of tasks scored well vs poorly? What specific improvements should you make?

Produce a concise insight (2-3 paragraphs) that will help you perform better on future tasks. Focus on actionable takeaways.`;

    case "specialty_research":
      return `${base}
## Task: Specialty Deep-Dive

As a specialist in ${specialties}, research and articulate:
1. Common best practices and quality standards
2. Frequent pitfalls and how to avoid them
3. Patterns that distinguish excellent work from mediocre work

Produce a concise insight (2-3 paragraphs) with concrete, actionable knowledge.`;

    case "task_simulation":
      return `${base}
## Task: Practice Simulation

Generate a realistic task request that a client might submit for your specialties (${specialties}). Then produce an outline of how you would approach it — the key decisions, quality checks, and deliverable structure.

Produce a concise insight (2-3 paragraphs) covering the approach and lessons learned.`;

    case "cost_optimization": {
      const goals = config.revenueGoals;
      const targetStr = goals
        ? `\n\nREVENUE TARGETS (set by operator — non-negotiable):\n- Monthly target: $${goals.monthlyTargetUsd.toLocaleString()}\n- Stretch goal: $${goals.monthlyStretchUsd.toLocaleString()}\n- Operating costs: ~$${goals.monthlyOperatingCostUsd.toLocaleString()}/month\n- Required daily: ~$${Math.ceil(goals.monthlyTargetUsd / 30)}/day\n- Required tasks/day at $10 avg: ~${Math.ceil(goals.monthlyTargetUsd / 300)}\n- Required tasks/day at $50 avg: ~${Math.ceil(goals.monthlyTargetUsd / 1500)}`
        : "";

      return `${base}
## Task: Revenue Goal Analysis & Strategy${targetStr}

Operating costs:
- LLM cost: ~$0.06 per task
- Infrastructure: ~$10/day ($300/month)

Analyze your recent performance against your revenue targets:
1. Are you on track to hit your monthly target? What's the gap?
2. Are you declining too many tasks? Each decline is $0 revenue.
3. Are you pricing optimally? Should you raise prices on complex tasks or lower prices for volume?
4. Are you spending too many LLM turns on tasks that could be done faster?
5. Which marketplace is yielding the best revenue? Should you shift focus?
6. Could you broaden your specialties to accept more work?
7. What types of tasks yield the best $/hour ratio?
8. Are there bounty patterns you should be watching for?
9. What's your strategy to reach the stretch goal?

Produce a concise insight (2-3 paragraphs) with SPECIFIC, ACTIONABLE strategies to hit your monthly target. Include concrete numbers — tasks per day, price adjustments, marketplace focus. Your operator expects results.`;
    }

    case "product_intelligence":
      return `${base}
## Task: Product Intelligence & Whop Strategy

You sell AI-powered digital products on Whop (whop.com). Your goal is to identify HIGH-DEMAND products that sell fast and create them.

### What sells on digital marketplaces in 2026:
- AI automation templates ($25-$100)
- Custom code scripts & bots ($30-$200)
- Data analysis dashboards ($50-$150)
- AI-generated content packs ($15-$50)
- Research reports & market intelligence ($25-$100)
- SEO audit reports ($30-$75)
- Code review & security audit services ($40-$150)
- AI chatbot templates ($50-$200)
- Prompt engineering guides ($15-$40)
- API integration templates ($30-$100)

### Your capabilities:
- Code execution sandbox (E2B) — write, test, deliver working code
- 50+ skills: code, research, writing, data analysis, automation
- Self-evolution: can acquire new MCP tools for graphics, charts, PDFs, Excel, music
- Multi-marketplace presence for distribution

### Analyze:
1. What products should you create RIGHT NOW for maximum sales velocity?
2. What price points will attract buyers while maximizing revenue?
3. How do you differentiate from competitors?
4. What products can you auto-deliver instantly (no custom work needed)?
5. What's the fastest path to $333/day from passive product sales alone?

### Presentation is EVERYTHING:
- Every product MUST have a stunning cover image (use Remotion MCP or E2B sandbox to generate)
- Write copy that SELLS — not just describes. Use power words, urgency, and clear value props
- Professional formatting with bullet points, emojis, and social proof
- Think like a top Whop seller — look at what's making money and make it better

### Output:
List 3-5 specific products with titles, descriptions, and prices that you should create on Whop. For each product include:
1. Compelling title (use power words)
2. Sales-focused description (benefits > features)
3. Price point with justification
4. What the cover image should look like
5. How Melista auto-delivers this product

Focus on products that:
- Solve a real, urgent problem
- Can be delivered automatically
- Have high perceived value relative to price
- Are trending in 2026
- Look STUNNING in the marketplace

### Continuous Improvement Cycle:
After creating products, ALWAYS review performance:
1. Which products are getting views but not buying? → Fix the description/price
2. Which products are selling? → Create variations and upsells
3. What are customers asking for in other marketplaces? → Create Whop products for those needs
4. What's trending on Twitter/Reddit/HN right now? → Create products that ride the wave
5. Are there gaps in the Whop marketplace? → Fill them first

### Create products that COMPOUND:
- Starter products ($15-25) → get customers in the door
- Core products ($30-60) → main revenue drivers
- Premium products ($99-199) → high-value for serious buyers
- Bundle deals → combine 3+ products at a discount

Never stop iterating. The best sellers constantly refresh their lineup.

Produce a concise insight with SPECIFIC product ideas ready to list.`;

    case "prediction_research":
      return `${base}
## Task: Prediction Market Research

You have access to prediction markets (Polymarket, Kalshi). Your goal is to find MISPRICED markets where your analysis gives you an edge.

### Research methodology:
1. Identify trending topics (elections, crypto, AI regulation, economic indicators)
2. Analyze current market odds vs your informed estimate
3. Look for markets where the crowd is wrong or slow to update
4. Calculate expected value: (your probability * payout) - cost

### What makes a good prediction trade:
- Your confidence is 65%+ (based on data, not gut feeling)
- The market price implies a probability significantly different from yours
- The market has enough liquidity (volume > $10K)
- The resolution date is within 30 days (faster feedback loop)
- You can articulate a clear thesis (not just a hunch)

### Risk rules (NEVER violate):
- Max 5% of balance per trade
- Max 25% total exposure
- $50 daily loss limit
- If you're wrong, learn from it

### DAILY PROFIT FOCUS — NOT long-term bets:
Your prediction strategy is DAILY quick in-and-outs, not weeks-long holds:

1. **Sports game mispricings** — NBA, NFL, soccer games resolving TODAY
   - Monitor injury news (5-30 min reaction window)
   - Lineup releases (~90 min before game = market lag)
   - Line movement vs sportsbook odds discrepancies
   - Target: 3-10% per trade, 2-5 trades daily

2. **Same-day resolution markets** — any market closing within 24 hours
   - Economic data releases (CPI, jobs, Fed decisions)
   - Earnings announcements
   - Political votes/decisions happening today

3. **Speed arbitrage** — react faster than market makers
   - Breaking news → markets lag 5-30 minutes
   - You can research and trade in seconds
   - Small edge × many trades = daily profit

### NOT for you:
- Election bets (too long, too uncertain)
- Multi-month markets (capital locked up)
- Low-confidence gut-feel bets

### Your edge:
- You research faster than humans
- You process more data sources simultaneously
- You don't have emotional bias
- You can spot patterns in odds movements
- You operate 24/7 — catch opportunities humans sleep through

Find markets resolving within 24 hours where you have 85%+ confidence. Quick in, quick out, daily profit.`;
  }
}

function generateId(): string {
  return crypto.randomUUID();
}

export async function runStudySession(
  llm: LLMProvider,
  config: MelistaConfig,
): Promise<StudyResult> {
  // Check if we can afford a study session
  const costCheck = canAffordTask("study");
  if (!costCheck.allowed) {
    return { topic: "cost_optimization" as KnowledgeEntry["topic"], insight: costCheck.reason ?? "Budget limit reached", tokensUsed: 0 };
  }

  const feedback = loadFeedback();
  const knowledge = loadKnowledge();
  const topic = pickTopic(knowledge, feedback);

  // Rotate through specialties instead of always using the first one
  const specialtyPool = config.specialties.length > 0 ? config.specialties : ["general"];
  const topicEntries = knowledge.filter((k) => k.topic === topic);
  const specialty = specialtyPool[topicEntries.length % specialtyPool.length];
  const prompt = buildStudyPrompt(topic, config, feedback, knowledge);

  const messages: LLMMessage[] = [
    { role: "user", content: prompt },
  ];

  let totalTokens = 0;
  let lastText = "";

  // Run up to MAX_STUDY_TURNS — no tools, pure reasoning
  for (let turn = 0; turn < MAX_STUDY_TURNS; turn++) {
    const response = await llm.chat(messages);
    totalTokens += response.usage.inputTokens + response.usage.outputTokens;
    recordLlmUsage(response.usage.inputTokens, response.usage.outputTokens, "study");

    const textBlocks = response.content.filter(
      (b): b is { type: "text"; text: string } => b.type === "text",
    );
    lastText = textBlocks.map((b) => b.text).join("\n");

    // Single turn is usually enough for study sessions
    if (response.stopReason === "end_turn") break;

    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content: "Continue your analysis. Focus on the most actionable insight.",
    });
  }

  const insight = lastText.trim() || "No insight produced.";

  // Determine what triggered this study
  const source = topic === "feedback_analysis" && feedback.length > 0
    ? `${feedback.length} feedback entries (avg ${(feedback.reduce((s, f) => s + f.score, 0) / feedback.length).toFixed(1)}/5)`
    : `scheduled ${topic} session`;

  const entry: KnowledgeEntry = {
    id: generateId(),
    topic,
    specialty,
    insight,
    source,
    timestamp: Date.now(),
  };

  storeKnowledge(entry);

  return { topic, insight, tokensUsed: totalTokens };
}
