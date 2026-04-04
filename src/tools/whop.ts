/**
 * Whop product management tools — let Melista create and manage
 * products autonomously based on market demand.
 */
import type { Tool } from "./types.js";
import {
  createWhopProduct,
  createWhopPlan,
  listWhopProducts,
  listWhopPayments,
} from "../marketplaces/whop.js";

export const whopCreateProduct: Tool = {
  definition: {
    name: "whop_create_product",
    description: "Create a new product on Whop to sell. Use after researching what's trending. Include a compelling title and description that sells. The product will be listed on Whop for customers to buy, and Melista auto-delivers when purchased.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Product title (compelling, clear value prop)" },
        description: { type: "string", description: "Product description (what the buyer gets, benefits, deliverables)" },
        price_usd: { type: "number", description: "Price in USD (e.g. 25, 50, 99)" },
      },
      required: ["title", "description", "price_usd"],
    },
  },
  async execute(input, ctx) {
    const title = input.title as string;
    const description = input.description as string;
    const price = input.price_usd as number;

    const whopConfig = ctx.config.marketplaces?.whop;
    if (!whopConfig?.apiKey) {
      return { success: false, data: "Whop not configured. Add API key in Settings." };
    }

    try {
      const productId = await createWhopProduct(whopConfig, title, description);
      const planId = await createWhopPlan(whopConfig, productId, price);

      return {
        success: true,
        data: `Product created on Whop!\n- Title: ${title}\n- Price: $${price}\n- Product ID: ${productId}\n- Plan ID: ${planId}\n- URL: https://whop.com/checkout/${planId}\n\nCustomers can now purchase this product. Melista will auto-deliver when orders come in.`,
      };
    } catch (err) {
      return { success: false, data: `Failed to create product: ${err instanceof Error ? err.message : err}` };
    }
  },
};

export const whopListProducts: Tool = {
  definition: {
    name: "whop_list_products",
    description: "List all products currently on Whop. Use to see what you're selling and identify gaps in your product lineup.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  async execute(_input, ctx) {
    const whopConfig = ctx.config.marketplaces?.whop;
    if (!whopConfig?.apiKey) {
      return { success: false, data: "Whop not configured." };
    }

    try {
      const products = await listWhopProducts(whopConfig);
      if (products.length === 0) {
        return { success: true, data: "No products on Whop yet. Create some based on trending demand!" };
      }
      const list = products.map((p) => `- ${p.title} (${p.id}) — ${p.visibility}`).join("\n");
      return { success: true, data: `Your Whop products (${products.length}):\n${list}` };
    } catch (err) {
      return { success: false, data: `Failed to list products: ${err instanceof Error ? err.message : err}` };
    }
  },
};

export const whopCheckRevenue: Tool = {
  definition: {
    name: "whop_check_revenue",
    description: "Check Whop payment history and revenue. Use to track passive income from product sales.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  async execute(_input, ctx) {
    const whopConfig = ctx.config.marketplaces?.whop;
    if (!whopConfig?.apiKey) {
      return { success: false, data: "Whop not configured." };
    }

    try {
      const payments = await listWhopPayments(whopConfig);
      const completed = payments.filter((p) => p.status === "succeeded" || p.status === "paid");
      const totalRevenue = completed.reduce((sum, p) => sum + p.amount / 100, 0);

      return {
        success: true,
        data: `Whop Revenue:\n- Total payments: ${payments.length}\n- Completed: ${completed.length}\n- Revenue: $${totalRevenue.toFixed(2)}`,
      };
    } catch (err) {
      return { success: false, data: `Failed to check revenue: ${err instanceof Error ? err.message : err}` };
    }
  },
};
