/**
 * svg-to-pdfkit ships no types. Declaring only the single call signature we
 * use, rather than pulling in a broad `any`, so a wrong argument still fails
 * the build.
 */
declare module 'svg-to-pdfkit' {
  import type PDFDocument from 'pdfkit';

  function SVGtoPDF(
    doc: typeof PDFDocument.prototype,
    svg: string,
    x?: number,
    y?: number,
    options?: {
      width?: number;
      height?: number;
      preserveAspectRatio?: string;
      assumePt?: boolean;
    },
  ): void;

  export default SVGtoPDF;
}
