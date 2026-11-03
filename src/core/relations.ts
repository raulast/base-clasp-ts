import type { CellValue, Row } from './sheet-adapter';
import type { Model, ModelQuery } from './model.ts';

/**
 * Ids read from Sheets come back as numbers while ids from JSON bodies or
 * path params are strings; every relation helper compares through this.
 */
const isMissing = (value: CellValue | undefined): boolean => value === null || value === undefined || value === '';

// Ids read from Sheets are numbers while ids from JSON or paths are strings; a missing id never matches.
export function sameId(a: CellValue | undefined, b: CellValue | undefined): boolean {
  if (isMissing(a) || isMissing(b)) {
    return false;
  }
  return String(a) === String(b);
}

function uniqueIds(ids: CellValue[]): CellValue[] {
  return ids.filter((id, index) => !isMissing(id) && ids.findIndex((other) => sameId(other, id)) === index);
}

export function hasMany(related: Model, foreignKey: string, ownerId: CellValue, query: ModelQuery = {}): Row[] {
  const where = query.where;
  return related.all({
    ...query,
    where: (row) => sameId(row[foreignKey], ownerId) && (where ? where(row) : true),
  });
}

export function belongsTo(related: Model, foreignKeyValue: CellValue): Row | null {
  return related.all().find((row) => sameId(row.id, foreignKeyValue)) ?? null;
}

export interface BelongsToMany {
  get(ownerId: CellValue): Row[];
  attach(ownerId: CellValue, ids: CellValue[]): void;
  detach(ownerId: CellValue, ids?: CellValue[]): void;
  sync(ownerId: CellValue, ids: CellValue[]): void;
}

export function belongsToMany(pivot: Model, related: Model, ownKey: string, relatedKey: string): BelongsToMany {
  const pivotRowsFor = (ownerId: CellValue): Row[] => pivot.all({ where: (row) => sameId(row[ownKey], ownerId) });

  return {
    get(ownerId: CellValue): Row[] {
      const relatedRows = related.all();
      return pivotRowsFor(ownerId)
        .map((pivotRow) => relatedRows.find((row) => sameId(row.id, pivotRow[relatedKey])) ?? null)
        .filter((row): row is Row => row !== null);
    },

    attach(ownerId: CellValue, ids: CellValue[]): void {
      pivot.withLock(() => {
        const existingIds = pivotRowsFor(ownerId).map((row) => row[relatedKey]);
        for (const id of uniqueIds(ids)) {
          if (!existingIds.some((existing) => sameId(existing, id))) {
            pivot.create({ [ownKey]: ownerId, [relatedKey]: id });
          }
        }
      });
    },

    detach(ownerId: CellValue, ids?: CellValue[]): void {
      pivot.withLock(() => {
        for (const pivotRow of pivotRowsFor(ownerId)) {
          if (!ids || ids.some((id) => sameId(pivotRow[relatedKey], id))) {
            pivot.delete(pivotRow.id);
          }
        }
      });
    },

    sync(ownerId: CellValue, ids: CellValue[]): void {
      pivot.withLock(() => {
        const existing = pivotRowsFor(ownerId);
        for (const pivotRow of existing) {
          if (!ids.some((id) => sameId(pivotRow[relatedKey], id))) {
            pivot.delete(pivotRow.id);
          }
        }
        for (const id of uniqueIds(ids)) {
          if (!existing.some((pivotRow) => sameId(pivotRow[relatedKey], id))) {
            pivot.create({ [ownKey]: ownerId, [relatedKey]: id });
          }
        }
      });
    },
  };
}
