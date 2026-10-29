export type CellValue = string | number | boolean | Date | null;
export type Row = Record<string, CellValue>;

/**
 * Raw, dumb access to a single sheet's rows. All business logic (filtering,
 * pagination, soft delete, id generation) lives in core/model.ts, never here.
 * findRowIndex is its own contract method, not left to callers scanning
 * getRows(), so an adapter backed by something smarter than a flat array
 * (a cached index, a real database) can implement it without model.ts changing.
 */
export interface SheetAdapter {
  getHeaders(sheetName: string): string[];
  getRows(sheetName: string): Row[];
  findRowIndex(sheetName: string, predicate: (row: Row) => boolean): number;
  appendRow(sheetName: string, row: Row): void;
  updateRow(sheetName: string, rowIndex: number, row: Row): void;
  deleteRow(sheetName: string, rowIndex: number): void;
}
