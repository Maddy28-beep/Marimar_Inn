import type { Worksheet } from "exceljs";

export type ColumnFormat = "text" | "integer" | "currency" | "percent" | "auto";

export interface ExportColumn {
  header: string;
  key: string;
  width?: number;
  format?: ColumnFormat;
}

export interface ExportTable {
  heading?: string;
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
  emphasizeLastRow?: boolean;
}

export interface ExportSheet {
  name: string;
  title: string;
  subtitle?: string;
  /** e.g. "Front desk: ___   Housekeeping: ___   Time: ___" — a blank line
   * for whoever's on duty to fill in, matching the paper form this replaced. */
  dutyInfo?: string;
  /**
   * Rendered top to bottom. A nested array places its tables side by side
   * (same starting row, one after another in columns) instead of stacked.
   */
  tables: (ExportTable | ExportTable[])[];
}

const TEAL = "FF0F3D3E";
const GRID = "FFD4C9B8";

const THIN = { style: "thin" as const, color: { argb: GRID } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

function pesoFormat() {
  return '"₱"#,##0.00';
}

function cellFormat(
  format: ColumnFormat | undefined,
  row: Record<string, unknown>,
  value: unknown
): ColumnFormat {
  if (format && format !== "auto") return format;
  if (typeof value !== "number") return "text";
  const metric = String(row.metric ?? "");
  if (/revenue|total|amount/i.test(metric)) return "currency";
  if (/percent|occupancy/i.test(metric)) return "percent";
  return "integer";
}

function applyNumberFormat(cell: { numFmt?: string; alignment?: object }, format: ColumnFormat) {
  cell.alignment = { vertical: "middle", horizontal: "center" };
  if (format === "currency") cell.numFmt = pesoFormat();
  else if (format === "integer") cell.numFmt = "#,##0";
  else if (format === "percent") cell.numFmt = '0.0"%"';
}

/** How many columns an entry occupies — a side-by-side group is the sum of
 * its tables' widths plus a one-column gap between each. */
function entryWidth(entry: ExportTable | ExportTable[]): number {
  if (!Array.isArray(entry)) return entry.columns.length;
  return entry.reduce((sum, t) => sum + t.columns.length, 0) + Math.max(0, entry.length - 1);
}

/** Renders one table starting at (startRow, startCol) and returns the next
 * free row below it (including its trailing blank-row gap). */
function renderTable(worksheet: Worksheet, table: ExportTable, startRow: number, startCol: number): number {
  let rowNumber = startRow;
  const lastCol = startCol + table.columns.length - 1;

  const widths = table.columns.map((column) => column.width ?? 16);
  widths.forEach((width, index) => {
    const col = worksheet.getColumn(startCol + index);
    col.width = Math.max(col.width ?? 0, width);
  });

  if (table.heading) {
    worksheet.mergeCells(rowNumber, startCol, rowNumber, lastCol);
    const heading = worksheet.getCell(rowNumber, startCol);
    heading.value = table.heading;
    heading.font = { name: "Calibri", size: 12, bold: true, color: { argb: TEAL } };
    heading.alignment = { vertical: "middle", horizontal: "left" };
    worksheet.getRow(rowNumber).height = 20;
    rowNumber += 1;
  }

  const headerRow = worksheet.getRow(rowNumber);
  table.columns.forEach((column, index) => {
    const cell = headerRow.getCell(startCol + index);
    cell.value = column.header;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: TEAL } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = BORDER;
  });
  headerRow.height = 20;
  rowNumber += 1;

  if (table.rows.length === 0) {
    worksheet.mergeCells(rowNumber, startCol, rowNumber, lastCol);
    const empty = worksheet.getCell(rowNumber, startCol);
    empty.value = "No data for this period.";
    empty.font = { name: "Calibri", size: 11, italic: true, color: { argb: "FF6B7280" } };
    return rowNumber + 2;
  }

  table.rows.forEach((row, rowIndex) => {
    const excelRow = worksheet.getRow(rowNumber);
    const emphasize = table.emphasizeLastRow && rowIndex === table.rows.length - 1;

    table.columns.forEach((column, colIndex) => {
      const cell = excelRow.getCell(startCol + colIndex);
      const value = row[column.key];
      cell.value = (value ?? "") as string | number | Date;
      cell.font = { name: "Calibri", size: 11, bold: emphasize, color: { argb: TEAL } };
      cell.border = BORDER;
      cell.alignment = { vertical: "middle", horizontal: "center" };

      const resolved = cellFormat(column.format, row, value);
      if (typeof value === "number") {
        applyNumberFormat(cell, resolved);
        if (emphasize && resolved === "currency") {
          cell.font = { name: "Calibri", size: 12, bold: true, color: { argb: TEAL } };
        }
      }
    });
    excelRow.height = emphasize ? 22 : 18;
    rowNumber += 1;
  });

  return rowNumber + 1;
}

/**
 * Dynamically imported — ExcelJS is a fairly large library only needed when
 * an Owner actually clicks "Export," so it shouldn't bloat the initial
 * /reports bundle.
 */
export async function exportToExcel(filename: string, sheets: ExportSheet[]) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Marimar Inn";
  workbook.created = new Date();

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name, {
      views: [{ showGridLines: false }],
      pageSetup: {
        // No paperSize = ExcelJS's own default, Letter (8.5x11 — "short"
        // bond paper), not A4 or "long"/legal.
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.2, footer: 0.2 },
      },
    });

    const colCount = Math.max(2, ...sheet.tables.map(entryWidth));

    worksheet.mergeCells(1, 1, 1, colCount);
    const brand = worksheet.getCell(1, 1);
    brand.value = "Marimar Inn";
    brand.font = { name: "Calibri", size: 20, bold: true, color: { argb: TEAL } };
    brand.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    worksheet.getRow(1).height = 32;

    worksheet.mergeCells(2, 1, 2, colCount);
    const title = worksheet.getCell(2, 1);
    title.value = sheet.title;
    title.font = { name: "Calibri", size: 13, bold: true, color: { argb: TEAL } };
    title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    worksheet.getRow(2).height = 22;

    worksheet.mergeCells(3, 1, 3, colCount);
    const generated = worksheet.getCell(3, 1);
    generated.value = sheet.subtitle
      ? `${sheet.subtitle}  ·  Generated ${new Date().toLocaleString("en-PH")}`
      : `Generated ${new Date().toLocaleString("en-PH")}`;
    generated.font = { name: "Calibri", size: 10, italic: true, color: { argb: TEAL } };
    generated.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    worksheet.getRow(3).height = 18;

    let rowNumber = 5;

    if (sheet.dutyInfo) {
      worksheet.mergeCells(4, 1, 4, colCount);
      const duty = worksheet.getCell(4, 1);
      duty.value = sheet.dutyInfo;
      duty.font = { name: "Calibri", size: 10, bold: true, color: { argb: TEAL } };
      duty.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      worksheet.getRow(4).height = 18;
      rowNumber = 6;
    }

    for (const entry of sheet.tables) {
      if (Array.isArray(entry)) {
        let col = 1;
        let nextRow = rowNumber;
        for (const table of entry) {
          nextRow = Math.max(nextRow, renderTable(worksheet, table, rowNumber, col));
          col += table.columns.length + 1;
        }
        rowNumber = nextRow;
      } else {
        rowNumber = renderTable(worksheet, entry, rowNumber, 1);
      }
    }

    worksheet.headerFooter.oddFooter = "&LMarimar Inn — Confidential&C&P of &N&RFront desk report";

    // Locks every cell (the default) so the generated report can't be edited
    // after the fact — Owner still needs to be able to spot a report that's
    // been tampered with. Like the drawer PIN, this is a deterrent against
    // casual edits, not real security: Excel protection can be stripped by
    // anyone who goes looking for how.
    await worksheet.protect("marimar-inn-report", {
      selectLockedCells: true,
      selectUnlockedCells: true,
      formatCells: false,
      formatColumns: false,
      formatRows: false,
      insertRows: false,
      insertColumns: false,
      deleteRows: false,
      deleteColumns: false,
      sort: false,
      autoFilter: false,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function formatReportDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-PH", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatReportMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
  });
}
