import type { Row, SheetAdapter } from './sheet-adapter';
import type { SchemaAdapter } from './schema-adapter';

/**
 * One SpreadsheetApp read/write per call, matching the documented Apps
 * Script performance guidance (batch getValues/setValues, avoid per-cell
 * calls). rowIndex here is a 0-based data-row position (as returned by
 * getRows), translated to a real sheet row by adding 2: 1 for the header
 * row, 1 because Sheets ranges are 1-indexed.
 */
export class GasSheetAdapter implements SheetAdapter, SchemaAdapter {
  private readonly spreadsheetId?: string;

  constructor(spreadsheetId?: string) {
    this.spreadsheetId = spreadsheetId;
  }

  private spreadsheet(): GoogleAppsScript.Spreadsheet.Spreadsheet {
    return this.spreadsheetId
      ? SpreadsheetApp.openById(this.spreadsheetId)
      : SpreadsheetApp.getActiveSpreadsheet();
  }

  private sheet(sheetName: string): GoogleAppsScript.Spreadsheet.Sheet {
    const sheet = this.spreadsheet().getSheetByName(sheetName);
    if (!sheet) {
      throw new Error(`Unknown sheet: ${sheetName}`);
    }
    return sheet;
  }

  private readAll(sheetName: string): { headers: string[]; rows: Row[] } {
    const sheet = this.sheet(sheetName);
    const values = sheet.getDataRange().getValues();
    const [headers, ...dataRows] = values;
    const rows = dataRows.map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? null])),
    );
    return { headers, rows };
  }

  getHeaders(sheetName: string): string[] {
    return this.readAll(sheetName).headers;
  }

  getRows(sheetName: string): Row[] {
    return this.readAll(sheetName).rows;
  }

  findRowIndex(sheetName: string, predicate: (row: Row) => boolean): number {
    return this.getRows(sheetName).findIndex(predicate);
  }

  appendRow(sheetName: string, row: Row): void {
    const { headers } = this.readAll(sheetName);
    this.sheet(sheetName).appendRow(headers.map((header) => row[header] ?? ''));
  }

  updateRow(sheetName: string, rowIndex: number, row: Row): void {
    const { headers, rows } = this.readAll(sheetName);
    if (rowIndex < 0 || rowIndex >= rows.length) {
      throw new RangeError(`Row index out of range: ${rowIndex}`);
    }
    const sheetRow = rowIndex + 2;
    this.sheet(sheetName)
      .getRange(sheetRow, 1, 1, headers.length)
      .setValues([headers.map((header) => row[header] ?? '')]);
  }

  deleteRow(sheetName: string, rowIndex: number): void {
    const { rows } = this.readAll(sheetName);
    if (rowIndex < 0 || rowIndex >= rows.length) {
      throw new RangeError(`Row index out of range: ${rowIndex}`);
    }
    this.sheet(sheetName).deleteRow(rowIndex + 2);
  }

  sheetExists(sheetName: string): boolean {
    return this.spreadsheet().getSheetByName(sheetName) !== null;
  }

  createSheet(sheetName: string, headers: string[]): void {
    const sheet = this.spreadsheet().insertSheet(sheetName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  dropSheet(sheetName: string): void {
    this.spreadsheet().deleteSheet(this.sheet(sheetName));
  }

  addColumn(sheetName: string, column: string): void {
    const { headers } = this.readAll(sheetName);
    if (headers.includes(column)) {
      throw new Error(`Column already exists: ${sheetName}.${column}`);
    }
    this.sheet(sheetName).getRange(1, headers.length + 1).setValue(column);
  }

  dropColumn(sheetName: string, column: string): void {
    const { headers } = this.readAll(sheetName);
    const index = headers.indexOf(column);
    if (index === -1) {
      throw new Error(`Unknown column: ${sheetName}.${column}`);
    }
    this.sheet(sheetName).deleteColumn(index + 1);
  }
}
