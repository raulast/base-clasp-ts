/**
 * Spreadsheet-structure operations (create/drop a sheet), separate from
 * SheetAdapter's row-level operations. Both GasSheetAdapter and
 * InMemorySheetAdapter implement this too, against the same backing state.
 */
export interface SchemaAdapter {
  sheetExists(sheetName: string): boolean;
  createSheet(sheetName: string, headers: string[]): void;
  dropSheet(sheetName: string): void;
}
