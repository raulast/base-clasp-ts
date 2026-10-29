import type { Row, SheetAdapter } from '../sheet-adapter';
import type { SchemaAdapter } from '../schema-adapter';

export class InMemorySheetAdapter implements SheetAdapter, SchemaAdapter {
  private readonly sheets = new Map<string, { headers: string[]; rows: Row[] }>();

  seed(sheetName: string, headers: string[], rows: Row[] = []): void {
    this.sheets.set(sheetName, { headers, rows: rows.map((row) => ({ ...row })) });
  }

  private sheet(sheetName: string): { headers: string[]; rows: Row[] } {
    const sheet = this.sheets.get(sheetName);
    if (!sheet) {
      throw new Error(`Unknown sheet: ${sheetName}`);
    }
    return sheet;
  }

  getHeaders(sheetName: string): string[] {
    return [...this.sheet(sheetName).headers];
  }

  getRows(sheetName: string): Row[] {
    return this.sheet(sheetName).rows.map((row) => ({ ...row }));
  }

  findRowIndex(sheetName: string, predicate: (row: Row) => boolean): number {
    return this.sheet(sheetName).rows.findIndex(predicate);
  }

  appendRow(sheetName: string, row: Row): void {
    this.sheet(sheetName).rows.push({ ...row });
  }

  updateRow(sheetName: string, rowIndex: number, row: Row): void {
    const sheet = this.sheet(sheetName);
    if (rowIndex < 0 || rowIndex >= sheet.rows.length) {
      throw new RangeError(`Row index out of range: ${rowIndex}`);
    }
    sheet.rows[rowIndex] = { ...row };
  }

  deleteRow(sheetName: string, rowIndex: number): void {
    const sheet = this.sheet(sheetName);
    if (rowIndex < 0 || rowIndex >= sheet.rows.length) {
      throw new RangeError(`Row index out of range: ${rowIndex}`);
    }
    sheet.rows.splice(rowIndex, 1);
  }

  sheetExists(sheetName: string): boolean {
    return this.sheets.has(sheetName);
  }

  createSheet(sheetName: string, headers: string[]): void {
    if (this.sheets.has(sheetName)) {
      throw new Error(`Sheet already exists: ${sheetName}`);
    }
    this.sheets.set(sheetName, { headers, rows: [] });
  }

  dropSheet(sheetName: string): void {
    this.sheet(sheetName);
    this.sheets.delete(sheetName);
  }
}
