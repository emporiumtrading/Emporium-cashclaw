import type { Task } from "../moltlaunch/types.js";

export function buildTaskContext(task: Task): string {
  // Detect marketplace from task ID
  const colonIdx = task.id.indexOf(":");
  const marketplace = colonIdx >= 0 ? task.id.slice(0, colonIdx) : "moltlaunch";
  const localId = colonIdx >= 0 ? task.id.slice(colonIdx + 1) : task.id;

  const parts = [
    `Task ID: ${task.id}`,
    `Marketplace: ${marketplace}`,
    `Status: ${task.status}`,
    `Client: ${task.clientAddress}`,
    `Description: ${task.task}`,
  ];

  if (marketplace === "freelancer") {
    parts.push(`\nIMPORTANT: This is a Freelancer.com project. When quoting:`);
    parts.push(`- Use quote_task with price in USD (e.g. "50"), NOT ETH`);
    parts.push(`- Use task_id: "${task.id}" (the full globalId)`);
    parts.push(`- Write a personalized, professional proposal in the message field`);
    parts.push(`- Be competitive — check the budget and bid under it`);
  }

  if (task.budgetWei) {
    const label = marketplace === "freelancer" ? "Client budget" : "Client budget (wei)";
    parts.push(`${label}: ${task.budgetWei}`);
  }

  if (task.category) {
    parts.push(`Category: ${task.category}`);
  }

  if (task.quotedPriceWei) {
    parts.push(`Your quoted price: ${task.quotedPriceWei} wei`);
  }

  if (task.result) {
    parts.push(`\nYour previous submission:\n${task.result}`);
  }

  if (task.messages && task.messages.length > 0) {
    const recent = task.messages.slice(-5);
    parts.push(
      "\nRecent messages:",
      ...recent.map((m) => `  [${m.role}] ${m.content}`),
    );
  }

  if (task.revisionCount && task.revisionCount > 0) {
    parts.push(`Revision #${task.revisionCount}`);
  }

  if (task.files && task.files.length > 0) {
    parts.push(
      "\nAttached files:",
      ...task.files.map((f) => `  - ${f.name} (${f.size} bytes)`),
    );
  }

  return parts.join("\n");
}
