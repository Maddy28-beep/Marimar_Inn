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
  tables: ExportTable[];
}

const TEAL = "FF0F3D3E";
const TEAL_SOFT = "FF1A5C5E";
const CREAM = "FFF6F1EA";
const CREAM_ALT = "FFEEE7DC";
const WHITE = "FFFFFFFF";
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
  cell.alignment = { vertical: "middle", horizontal: "right" };
  if (format === "currency") cell.numFmt = pesoFormat();
  else if (format === "integer") cell.numFmt = "#,##0";
  else if (format === "percent") cell.numFmt = '0.0"%"';
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
        paperSize: 9,
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.2, footer: 0.2 },
      },
    });

    const colCount = Math.max(
      2,
      ...sheet.tables.map((table) => table.columns.length)
    );

    worksheet.mergeCells(1, 1, 1, colCount);
    const brand = worksheet.getCell(1, 1);
    brand.value = "Marimar Inn";
    brand.font = { name: "Calibri", size: 20, bold: true, color: { argb: WHITE } };
    brand.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    brand.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    worksheet.getRow(1).height = 32;

    worksheet.mergeCells(2, 1, 2, colCount);
    const title = worksheet.getCell(2, 1);
    title.value = sheet.title;
    title.font = { name: "Calibri", size: 13, bold: true, color: { argb: WHITE } };
    title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_SOFT } };
    title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    worksheet.getRow(2).height = 22;

    worksheet.mergeCells(3, 1, 3, colCount);
    const generated = worksheet.getCell(3, 1);
    generated.value = sheet.subtitle
      ? `${sheet.subtitle}  ·  Generated ${new Date().toLocaleString("en-PH")}`
      : `Generated ${new Date().toLocaleString("en-PH")}`;
    generated.font = { name: "Calibri", size: 10, italic: true, color: { argb: TEAL } };
    generated.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CREAM } };
    generated.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    worksheet.getRow(3).height = 18;

    let rowNumber = 5;

    for (const table of sheet.tables) {
      const widths = table.columns.map((column) => column.width ?? 16);
      widths.forEach((width, index) => {
        const col = worksheet.getColumn(index + 1);
        col.width = Math.max(col.width ?? 0, width);
      });

      if (table.heading) {
        worksheet.mergeCells(rowNumber, 1, rowNumber, table.columns.length);
        const heading = worksheet.getCell(rowNumber, 1);
        heading.value = table.heading;
        heading.font = { name: "Calibri", size: 12, bold: true, color: { argb: TEAL } };
        heading.alignment = { vertical: "middle", horizontal: "left" };
        worksheet.getRow(rowNumber).height = 20;
        rowNumber += 1;
      }

      const headerRow = worksheet.getRow(rowNumber);
      table.columns.forEach((column, index) => {
        const cell = headerRow.getCell(index + 1);
        cell.value = column.header;
        cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: WHITE } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
        cell.alignment = { vertical: "middle", horizontal: "left" };
        cell.border = BORDER;
      });
      headerRow.height = 20;
      rowNumber += 1;

      if (table.rows.length === 0) {
        worksheet.mergeCells(rowNumber, 1, rowNumber, table.columns.length);
        const empty = worksheet.getCell(rowNumber, 1);
        empty.value = "No data for this period.";
        empty.font = { name: "Calibri", size: 11, italic: true, color: { argb: "FF6B7280" } };
        empty.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CREAM } };
        rowNumber += 2;
        continue;
      }

      table.rows.forEach((row, rowIndex) => {
        const excelRow = worksheet.getRow(rowNumber);
        const emphasize =
          table.emphasizeLastRow && rowIndex === table.rows.length - 1;
        const fillColor = emphasize ? TEAL : rowIndex % 2 === 0 ? CREAM : CREAM_ALT;
        const fontColor = emphasize ? WHITE : TEAL;

        table.columns.forEach((column, colIndex) => {
          const cell = excelRow.getCell(colIndex + 1);
          const value = row[column.key];
          cell.value = (value ?? "") as string | number | Date;
          cell.font = {
            name: "Calibri",
            size: 11,
            bold: emphasize,
            color: { argb: emphasize && column.key === "value" ? "FFFFE7C2" : fontColor },
          };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
          cell.border = BORDER;
          cell.alignment = { vertical: "middle", horizontal: "left" };

          const resolved = cellFormat(column.format, row, value);
          if (typeof value === "number") {
            applyNumberFormat(cell, resolved);
            if (emphasize && resolved === "currency") {
              cell.font = { name: "Calibri", size: 12, bold: true, color: { argb: WHITE } };
            }
          }
        });
        excelRow.height = emphasize ? 22 : 18;
        rowNumber += 1;
      });

      rowNumber += 1;
    }

    worksheet.headerFooter.oddFooter = "&LMarimar Inn — Confidential&C&P of &N&RFront desk report";
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
