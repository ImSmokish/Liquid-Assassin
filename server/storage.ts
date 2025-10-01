import { type User, type InsertUser, type BotConfiguration, type InsertBotConfiguration, type LiquidationPosition, type InsertLiquidationPosition, type LiquidationExecution, type InsertLiquidationExecution, type ActivityLog, type InsertActivityLog } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Bot configuration methods
  getBotConfiguration(userId: string): Promise<BotConfiguration | undefined>;
  saveBotConfiguration(config: InsertBotConfiguration): Promise<BotConfiguration>;
  updateBotConfiguration(userId: string, config: Partial<InsertBotConfiguration>): Promise<BotConfiguration | undefined>;
  
  // Liquidation position methods
  getLiquidationPositions(): Promise<LiquidationPosition[]>;
  addLiquidationPosition(position: InsertLiquidationPosition): Promise<LiquidationPosition>;
  updateLiquidationPosition(id: string, updates: Partial<LiquidationPosition>): Promise<LiquidationPosition | undefined>;
  removeLiquidationPosition(id: string): Promise<void>;
  
  // Liquidation execution methods
  addLiquidationExecution(execution: InsertLiquidationExecution): Promise<LiquidationExecution>;
  getLiquidationExecutions(): Promise<LiquidationExecution[]>;
  
  // Activity log methods
  addActivityLog(log: InsertActivityLog): Promise<ActivityLog>;
  getActivityLogs(limit?: number): Promise<ActivityLog[]>;
  clearActivityLogs(): Promise<void>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private botConfigurations: Map<string, BotConfiguration>;
  private liquidationPositions: Map<string, LiquidationPosition>;
  private liquidationExecutions: Map<string, LiquidationExecution>;
  private activityLogs: ActivityLog[];

  constructor() {
    this.users = new Map();
    this.botConfigurations = new Map();
    this.liquidationPositions = new Map();
    this.liquidationExecutions = new Map();
    this.activityLogs = [];
  }

  // User methods
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  // Bot configuration methods
  async getBotConfiguration(userId: string): Promise<BotConfiguration | undefined> {
    return Array.from(this.botConfigurations.values()).find(config => config.userId === userId);
  }

  async saveBotConfiguration(config: InsertBotConfiguration): Promise<BotConfiguration> {
    const id = randomUUID();
    const now = new Date();
    const botConfig: BotConfiguration = { 
      ...config,
      userId: config.userId ?? null,
      id, 
      createdAt: now, 
      updatedAt: now 
    };
    this.botConfigurations.set(id, botConfig);
    return botConfig;
  }

  async updateBotConfiguration(userId: string, updates: Partial<InsertBotConfiguration>): Promise<BotConfiguration | undefined> {
    const existing = await this.getBotConfiguration(userId);
    if (existing) {
      const updated: BotConfiguration = {
        ...existing,
        ...updates,
        updatedAt: new Date()
      };
      this.botConfigurations.set(existing.id, updated);
      return updated;
    }
    return undefined;
  }

  // Liquidation position methods
  async getLiquidationPositions(): Promise<LiquidationPosition[]> {
    return Array.from(this.liquidationPositions.values());
  }

  async addLiquidationPosition(position: InsertLiquidationPosition): Promise<LiquidationPosition> {
    const id = randomUUID();
    const now = new Date();
    const liquidationPosition: LiquidationPosition = {
      ...position,
      id,
      firstSeen: now,
      lastUpdated: now
    };
    this.liquidationPositions.set(id, liquidationPosition);
    return liquidationPosition;
  }

  async updateLiquidationPosition(id: string, updates: Partial<LiquidationPosition>): Promise<LiquidationPosition | undefined> {
    const existing = this.liquidationPositions.get(id);
    if (existing) {
      const updated: LiquidationPosition = {
        ...existing,
        ...updates,
        lastUpdated: new Date()
      };
      this.liquidationPositions.set(id, updated);
      return updated;
    }
    return undefined;
  }

  async removeLiquidationPosition(id: string): Promise<void> {
    this.liquidationPositions.delete(id);
  }

  // Liquidation execution methods
  async addLiquidationExecution(execution: InsertLiquidationExecution): Promise<LiquidationExecution> {
    const id = randomUUID();
    const liquidationExecution: LiquidationExecution = {
      ...execution,
      positionId: execution.positionId ?? null,
      gasUsed: execution.gasUsed ?? null,
      gasPrice: execution.gasPrice ?? null,
      actualProfit: execution.actualProfit ?? null,
      id,
      executedAt: new Date()
    };
    this.liquidationExecutions.set(id, liquidationExecution);
    return liquidationExecution;
  }

  async getLiquidationExecutions(): Promise<LiquidationExecution[]> {
    return Array.from(this.liquidationExecutions.values());
  }

  // Activity log methods
  async addActivityLog(log: InsertActivityLog): Promise<ActivityLog> {
    const id = randomUUID();
    const activityLog: ActivityLog = {
      ...log,
      id,
      timestamp: new Date()
    };
    this.activityLogs.push(activityLog);
    
    // Keep only last 1000 entries
    if (this.activityLogs.length > 1000) {
      this.activityLogs = this.activityLogs.slice(-1000);
    }
    
    return activityLog;
  }

  async getActivityLogs(limit = 100): Promise<ActivityLog[]> {
    return this.activityLogs.slice(-limit).reverse();
  }

  async clearActivityLogs(): Promise<void> {
    this.activityLogs = [];
  }
}

export const storage = new MemStorage();
