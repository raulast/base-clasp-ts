/**
 * Spreadsheet-structure operations (sheets and columns), separate from
 * SheetAdapter's row-level operations. Both GasSheetAdapter and
 * InMemorySheetAdapter implement this too, against the same backing state.
 */
export interface SchemaAdapter {
  sheetExists(sheetName: string): boolean;
  createSheet(sheetName: string, headers: string[]): void;
  dropSheet(sheetName: string): void;
  addColumn(sheetName: string, column: string): void;
  dropColumn(sheetName: string, column: string): void;
}
