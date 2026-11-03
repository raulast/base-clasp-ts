import type { CellValue, Row, SheetAdapter } from './sheet-adapter';
import type { LockAdapter } from './lock-adapter.ts';
import { noopLock } from './lock-adapter.ts';
import { sameId } from './relations.ts';

export interface ModelQuery {
  where?: (row: Row) => boolean;
  includeDeleted?: boolean;
}

export interface Page {
  page: number;
  perPage: number;
  total: number;
  pages: number;
  data: Row[];
}

/**
 * Generic CRUD on top of a SheetAdapter: filtering, pagination, soft delete
 * and id generation live here as plain TS, replacing the old approach of
 * building ad-hoc QUERY formulas against temporary sheets.
 */
export class Model {
  private readonly sheetName: string;
  private readonly adapter: SheetAdapter;
  private readonly now: () => Date;
  private readonly lock: LockAdapter;

  constructor(sheetName: string, adapter: SheetAdapter, now: () => Date = () => new Date(), lock: LockAdapter = noopLock) {
    this.sheetName = sheetName;
    this.adapter = adapter;
    this.now = now;
    this.lock = lock;
  }

  withLock<T>(fn: () => T): T {
    return this.lock.withLock(fn);
  }

  private headers(): string[] {
    return this.adapter.getHeaders(this.sheetName);
  }

  private supportsSoftDelete(): boolean {
    return this.headers().includes('deleted_at');
  }

  private isVisible(row: Row, includeDeleted: boolean): boolean {
    if (includeDeleted || !this.supportsSoftDelete()) {
      return true;
    }
    return row.deleted_at === null || row.deleted_at === undefined || row.deleted_at === '';
  }

  all(query: ModelQuery = {}): Row[] {
    const includeDeleted = query.includeDeleted ?? false;
    return this.adapter
      .getRows(this.sheetName)
      .filter((row) => this.isVisible(row, includeDeleted))
      .filter((row) => (query.where ? query.where(row) : true));
  }

  find(id: CellValue, query: ModelQuery = {}): Row | null {
    const includeDeleted = query.includeDeleted ?? false;
    const row = this.adapter
      .getRows(this.sheetName)
      .find((candidate) => sameId(candidate.id, id) && this.isVisible(candidate, includeDeleted));
    return row ?? null;
  }

  create(data: Row): Row {
    return this.lock.withLock(() => {
      const headers = this.headers();
      const ids = this.adapter.getRows(this.sheetName).map((row) => Number(row.id) || 0);
      const nextId = (ids.length ? Math.max(...ids) : 0) + 1;
      const row: Row = { ...data, id: nextId };
      const timestamp = this.now().getTime();
      if (headers.includes('created_at')) row.created_at = timestamp;
      if (headers.includes('updated_at')) row.updated_at = timestamp;
      this.adapter.appendRow(this.sheetName, row);
      return row;
    });
  }

  update(id: CellValue, data: Partial<Row>): Row | null {
    return this.lock.withLock(() => {
      const index = this.adapter.findRowIndex(this.sheetName, (row) => sameId(row.id, id));
      if (index === -1) return null;
      const existing = this.adapter.getRows(this.sheetName)[index];
      const updated: Row = { ...existing, ...data, id: existing.id };
      if (this.headers().includes('updated_at')) {
        updated.updated_at = this.now().getTime();
      }
      this.adapter.updateRow(this.sheetName, index, updated);
      return updated;
    });
  }

  delete(id: CellValue): boolean {
    return this.lock.withLock(() => {
      const index = this.adapter.findRowIndex(this.sheetName, (row) => sameId(row.id, id));
      if (index === -1) return false;
      if (this.supportsSoftDelete()) {
        const existing = this.adapter.getRows(this.sheetName)[index];
        this.adapter.updateRow(this.sheetName, index, { ...existing, deleted_at: this.now().getTime() });
      } else {
        this.adapter.deleteRow(this.sheetName, index);
      }
      return true;
    });
  }

  firstOrCreate(match: Row, defaults: Row = {}): { row: Row; created: boolean } {
    return this.lock.withLock(() => {
      const existing = this.all().find((row) =>
        Object.entries(match).every(([key, value]) => sameId(row[key], value)),
      );
      if (existing) {
        return { row: existing, created: false };
      }
      return { row: this.create({ ...defaults, ...match }), created: true };
    });
  }

  paginate(page: number, perPage: number, query: ModelQuery = {}): Page {
    const rows = this.all(query);
    const start = (page - 1) * perPage;
    return {
      page,
      perPage,
      total: rows.length,
      pages: Math.ceil(rows.length / perPage),
      data: rows.slice(start, start + perPage),
    };
  }
}
