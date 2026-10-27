import { eq, desc, and } from 'drizzle-orm';
import { getDatabaseContext } from '../../db/connection.js';
import {
  tipPools,
  tipPoolDistributions,
  users,
  type TipPool,
  type TipPoolDistribution
} from '../../db/schema.js';
import crypto from 'node:crypto';

export interface ParticipantInput {
  userId: string;
  hoursWorked?: number;
}

export interface ClosePoolInput {
  tipPoolId: string;
  closedByUserId: string;
  splitMode: 'EQUAL' | 'HOURS';
  participants: ParticipantInput[];
}

export interface AddTipInput {
  tipPoolId?: string;
  locationId: string;
  jornadaId: string;
  amountUsdCents: number;
  amountBsCents: number;
}

const getDb = () => getDatabaseContext().db;

export class TipsService {
  /**
   * Obtiene o crea el pool de propinas abierto para la jornada y sede indicada.
   */
  static async getOrCreateOpenPool(locationId: string, jornadaId: string): Promise<TipPool> {
    const existing = await getDb()
      .select()
      .from(tipPools)
      .where(
        and(
          eq(tipPools.locationId, locationId),
          eq(tipPools.jornadaId, jornadaId),
          eq(tipPools.status, 'OPEN')
        )
      )
      .limit(1);

    if (existing[0]) {
      return existing[0];
    }

    const newPool: TipPool = {
      id: crypto.randomUUID(),
      locationId,
      jornadaId,
      splitMode: 'EQUAL',
      totalCollectedUsdCents: 0,
      totalCollectedBsCents: 0,
      status: 'OPEN',
      closedByUserId: null,
      closedAtMs: null,
      createdAtMs: Date.now()
    };

    await getDb().insert(tipPools).values(newPool);
    return newPool;
  }

  /**
   * Agrega propina acumulada al pool abierto.
   */
  static async addTip(input: AddTipInput): Promise<TipPool> {
    let pool: TipPool;
    if (input.tipPoolId) {
      const found = await getDb().select().from(tipPools).where(eq(tipPools.id, input.tipPoolId)).limit(1);
      if (!found[0]) throw new Error('Pool de propinas no encontrado');
      if (found[0].status === 'CLOSED') throw new Error('El pool de propinas ya está cerrado');
      pool = found[0];
    } else {
      pool = await this.getOrCreateOpenPool(input.locationId, input.jornadaId);
    }

    const updatedUsd = pool.totalCollectedUsdCents + Math.max(0, input.amountUsdCents || 0);
    const updatedBs = pool.totalCollectedBsCents + Math.max(0, input.amountBsCents || 0);

    await getDb()
      .update(tipPools)
      .set({
        totalCollectedUsdCents: updatedUsd,
        totalCollectedBsCents: updatedBs
      })
      .where(eq(tipPools.id, pool.id));

    return {
      ...pool,
      totalCollectedUsdCents: updatedUsd,
      totalCollectedBsCents: updatedBs
    };
  }

  /**
   * Cierra el pool y calcula el reparto (EQUAL o HOURS) entre los meseros del turno.
   */
  static async closeAndDistributePool(input: ClosePoolInput): Promise<{
    pool: TipPool;
    distributions: (TipPoolDistribution & { userName: string })[];
  }> {
    const poolRows = await getDb().select().from(tipPools).where(eq(tipPools.id, input.tipPoolId)).limit(1);
    if (!poolRows[0]) throw new Error('Pool de propinas no encontrado');
    const pool = poolRows[0];

    if (pool.status === 'CLOSED') {
      throw new Error('El pool de propinas ya ha sido cerrado');
    }

    if (!input.participants || input.participants.length === 0) {
      throw new Error('Debe especificar al menos un mesero/participante para distribuir el pool');
    }

    const totalUsd = pool.totalCollectedUsdCents;
    const totalBs = pool.totalCollectedBsCents;
    const splitMode = input.splitMode;
    const now = Date.now();

    let totalWeight = 0;
    const cleanedParticipants = input.participants.map((p) => {
      const hours = p.hoursWorked && p.hoursWorked > 0 ? p.hoursWorked : 1.0;
      const weight = splitMode === 'HOURS' ? hours : 1.0;
      totalWeight += weight;
      return {
        userId: p.userId,
        hoursWorked: hours,
        weight
      };
    });

    if (totalWeight <= 0) totalWeight = 1;

    let distributedUsd = 0;
    let distributedBs = 0;

    const distributionRecords: TipPoolDistribution[] = [];

    for (let i = 0; i < cleanedParticipants.length; i++) {
      const p = cleanedParticipants[i];
      const isLast = i === cleanedParticipants.length - 1;
      const shareFraction = p.weight / totalWeight;

      let partUsd: number;
      let partBs: number;

      if (isLast) {
        partUsd = Math.max(0, totalUsd - distributedUsd);
        partBs = Math.max(0, totalBs - distributedBs);
      } else {
        partUsd = Math.round(totalUsd * shareFraction);
        partBs = Math.round(totalBs * shareFraction);
        distributedUsd += partUsd;
        distributedBs += partBs;
      }

      distributionRecords.push({
        id: crypto.randomUUID(),
        tipPoolId: pool.id,
        userId: p.userId,
        hoursWorked: p.hoursWorked,
        sharePercentage: Math.round(shareFraction * 10000) / 100,
        amountUsdCents: partUsd,
        amountBsCents: partBs,
        status: 'PENDIENTE',
        createdAtMs: now
      });
    }

    const rawDb = getDatabaseContext().rawDb;
    const tx = rawDb.transaction(() => {
      rawDb.prepare(`
        UPDATE tip_pools
        SET split_mode = ?, status = 'CLOSED', closed_by_user_id = ?, closed_at_ms = ?
        WHERE id = ?
      `).run(splitMode, input.closedByUserId, now, pool.id);

      const insertDist = rawDb.prepare(`
        INSERT INTO tip_pool_distributions (
          id, tip_pool_id, user_id, hours_worked, share_percentage,
          amount_usd_cents, amount_bs_cents, status, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const dist of distributionRecords) {
        insertDist.run(
          dist.id,
          dist.tipPoolId,
          dist.userId,
          dist.hoursWorked,
          dist.sharePercentage,
          dist.amountUsdCents,
          dist.amountBsCents,
          dist.status,
          dist.createdAtMs
        );
      }
    });

    tx();

    const enriched = await this.getDistributionsForPool(pool.id);

    return {
      pool: {
        ...pool,
        splitMode,
        status: 'CLOSED',
        closedByUserId: input.closedByUserId,
        closedAtMs: now
      },
      distributions: enriched
    };
  }

  /**
   * Obtiene las distribuciones de un pool con nombre de usuario.
   */
  static async getDistributionsForPool(tipPoolId: string): Promise<(TipPoolDistribution & { userName: string })[]> {
    const distRows = await getDb()
      .select({
        dist: tipPoolDistributions,
        userName: users.name
      })
      .from(tipPoolDistributions)
      .leftJoin(users, eq(tipPoolDistributions.userId, users.id))
      .where(eq(tipPoolDistributions.tipPoolId, tipPoolId));

    return distRows.map((r: any) => ({
      ...r.dist,
      userName: r.userName || 'Usuario'
    }));
  }

  /**
   * Lista los pools de propinas recientes para una sede.
   */
  static async listPools(locationId: string, limit: number = 20): Promise<TipPool[]> {
    return await getDb()
      .select()
      .from(tipPools)
      .where(eq(tipPools.locationId, locationId))
      .orderBy(desc(tipPools.createdAtMs))
      .limit(limit);
  }

  /**
   * Marca una distribución como PAGADO.
   */
  static async markDistributionPaid(distributionId: string): Promise<void> {
    await getDb()
      .update(tipPoolDistributions)
      .set({ status: 'PAGADO' })
      .where(eq(tipPoolDistributions.id, distributionId));
  }
}
