import { sql } from "drizzle-orm";
import { pgTable, text, varchar, real, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const botConfigurations = pgTable("bot_configurations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  contractAddress: text("contract_address").notNull(),
  rpcUrl: text("rpc_url").notNull(),
  minHealthFactor: real("min_health_factor").notNull(),
  maxHealthFactor: real("max_health_factor").notNull(),
  privateKey: text("private_key").notNull(),
  maxGasPrice: integer("max_gas_price").notNull(),
  scanInterval: integer("scan_interval").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const liquidationPositions = pgTable("liquidation_positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userAddress: text("user_address").notNull(),
  healthFactor: real("health_factor").notNull(),
  collateralAsset: text("collateral_asset").notNull(),
  collateralAmount: text("collateral_amount").notNull(),
  debtAsset: text("debt_asset").notNull(),
  debtAmount: text("debt_amount").notNull(),
  estimatedProfit: real("estimated_profit").notNull(),
  status: text("status").notNull(), // 'monitoring', 'in_range', 'executed'
  firstSeen: timestamp("first_seen").defaultNow(),
  lastUpdated: timestamp("last_updated").defaultNow(),
});

export const liquidationExecutions = pgTable("liquidation_executions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  positionId: varchar("position_id").references(() => liquidationPositions.id),
  txHash: text("tx_hash").notNull(),
  gasUsed: integer("gas_used"),
  gasPrice: integer("gas_price"),
  actualProfit: real("actual_profit"),
  executedAt: timestamp("executed_at").defaultNow(),
});

export const activityLogs = pgTable("activity_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  message: text("message").notNull(),
  type: text("type").notNull(), // 'info', 'success', 'warning', 'error'
  timestamp: timestamp("timestamp").defaultNow(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertBotConfigurationSchema = createInsertSchema(botConfigurations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLiquidationPositionSchema = createInsertSchema(liquidationPositions).omit({
  id: true,
  firstSeen: true,
  lastUpdated: true,
});

export const insertLiquidationExecutionSchema = createInsertSchema(liquidationExecutions).omit({
  id: true,
  executedAt: true,
});

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({
  id: true,
  timestamp: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type BotConfiguration = typeof botConfigurations.$inferSelect;
export type InsertBotConfiguration = z.infer<typeof insertBotConfigurationSchema>;

export type LiquidationPosition = typeof liquidationPositions.$inferSelect;
export type InsertLiquidationPosition = z.infer<typeof insertLiquidationPositionSchema>;

export type LiquidationExecution = typeof liquidationExecutions.$inferSelect;
export type InsertLiquidationExecution = z.infer<typeof insertLiquidationExecutionSchema>;

export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
